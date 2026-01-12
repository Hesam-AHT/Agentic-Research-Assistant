import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

// Lazy initialization of OpenAI client to avoid errors if API key is missing
let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is required. Please set it in .env file or environment variables.\n" +
        "Create a .env file in the project root with: OPENAI_API_KEY=your_key_here"
      );
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

// TYPES (matching A0's expectations)
export interface TextLocation {
  paragraph: number;
  line: number;
  start_sentence: string;
  end_sentence?: string;
  char_start?: number;
  char_end?: number;
}

export interface Evidence {
  doi?: string;
  title: string;
  authors: string[];
  year: string;
  journal: string;
  arxiv_id?: string;
  text?: string;
  source_type?: "pdf" | "abstract" | "metadata_only";
  is_main_paper?: boolean;
  locations?: TextLocation[];
  pdf_path?: string;

  // Section metadata for frontend highlighting
  section?: string;
  page?: number;
  chunk_id?: string;
}

export interface A2Task {
  agent: "A2";
  action: "reason";
  inputs: {
    query: string;
    evidence: Evidence[];
    expertise: string;
    format: string;
  };
}

export interface A2Result {
  agent: "A2";
  status: "success" | "error";
  answer: string;
  citations: any[];
  confidence?: string;
  metadata?: Record<string, any>;
  error?: string;
}

// AGENT STATE
class AgentState {
  private evidence: Evidence[] = [];
  private query: string = "";
  private expertise: string = "intermediate";
  private format: string = "markdown";
  private synthesisResult: any = null;
  private formattedCitations: any[] = [];  // NEW: Store formatted citations

  setTask(task: A2Task) {
    this.evidence = task.inputs.evidence || [];
    this.query = task.inputs.query;
    this.expertise = task.inputs.expertise || "intermediate";
    this.format = task.inputs.format || "markdown";
  }

  getEvidence(): Evidence[] {
    return this.evidence;
  }

  getQuery(): string {
    return this.query;
  }

  getExpertise(): string {
    return this.expertise;
  }

  getFormat(): string {
    return this.format;
  }

  setSynthesisResult(result: any) {
    this.synthesisResult = result;
  }

  getSynthesisResult(): any {
    return this.synthesisResult;
  }

  setFormattedCitations(citations: any[]) {  // NEW
    this.formattedCitations = citations;
  }

  getFormattedCitations(): any[] {  // NEW
    return this.formattedCitations;
  }

  reset() {
    this.evidence = [];
    this.query = "";
    this.expertise = "intermediate";
    this.format = "markdown";
    this.synthesisResult = null;
    this.formattedCitations = [];  // NEW
  }
}

const agentState = new AgentState();

// TOOLS
const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_evidence",
      description:
        "List all available evidence chunks with metadata (0-based indices). " +
        "Returns: { success:boolean, count:number, evidence:Array<{index:number,title:string,is_main_paper:boolean,section?:string,page?:number,chunk_id?:string,source_type?:string,doi?:string,arxiv_id?:string,preview_text:string}> }",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_evidence",
      description:
        "Return full text + metadata for selected evidence indices. " +
        "Returns: { success:boolean, analyzed:Array<{index:number,title:string,full_text:string,quality:string,metadata:any}> }",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          indices: {
            type: "array",
            items: { type: "integer" },
            description: "Evidence indices to analyze",
          },
          max_chars: {
            type: "integer",
            minimum: 500,
            maximum: 50000,
            default: 4000,
            description: "Max characters of full_text per evidence item",
          },
        },
        required: ["indices"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "synthesize_answer",
      description:
        "Write the final answer with inline citations using 0-based evidence indices from get_evidence (e.g., [0], [3]). " +
        "Rules: every marker like [3] must refer to a valid evidence index. cited_indices must include every marker used. " +
        "Returns: { success:boolean, message:string, confidence:'high'|'medium'|'low' }",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          answer_text: {
            type: "string",
            description: "Complete answer with citation markers [0], [1], [2] using EXACTLY the index numbers from get_evidence.",
          },
          cited_indices: {
            type: "array",
            items: { type: "integer" },
            description: "List of 0-based evidence indices cited (matching get_evidence indices: 0, 1, 2, etc.)",
          },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "Confidence in the answer",
          },
        },
        required: ["answer_text", "cited_indices", "confidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "format_citations",
      description:
        "Format the citations list for the cited evidence and prepare UI metadata. " +
        "Returns: { success:boolean, citations:any[], style:string }",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          cited_indices: {
            type: "array",
            items: { type: "integer" },
            description: "Evidence indices that were cited",
          },
          style: {
            type: "string",
            enum: ["APA", "IEEE", "MLA"],
            description: "Citation style",
            default: "APA",
          },
          text_max_chars: {
            type: "integer",
            minimum: 0,
            maximum: 20000,
            default: 500,
            description: "Max text length to include per citation item for UI payload",
          },
        },
        required: ["cited_indices"],
      },
    },
  },
];

// TOOL EXECUTION
// TOOL EXECUTION
async function executeFunction(
  name: string,
  args: Record<string, any>
): Promise<any> {
  console.log(`\n[A2 TOOL] ${name}`);

  switch (name) {
    case "get_evidence": {
      const evidence = agentState.getEvidence();
      console.log(`[A2] Retrieved ${evidence.length} evidence items`);
      // CHANGED BY DATE: 2026-01-03 - Show 0-based indices and preview text to verify grounding
      evidence.forEach((e, i) => {
        console.log(`   [${i}] ${e.title} (${e.is_main_paper ? "Main Paper" : "External"})`);
        // Log first 300 chars of text to verify what LLM is actually receiving
        const textPreview = (e.text || "").substring(0, 300).replace(/\n/g, " ");
        console.log(`       Text preview: "${textPreview}..."`);
      });

      return {
        success: true,
        count: evidence.length,
        evidence: evidence.map((e, idx) => {
          const raw = (e.text || "");
          const preview = raw
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 1200);

          const authorsList = e.authors || [];
          const authors_preview =
            authorsList.slice(0, 3).join(", ") + (authorsList.length > 3 ? " et al." : "");

          return {
            index: idx,
            title: e.title,
            is_main_paper: e.is_main_paper || false,
            section: e.section,
            page: e.page,
            chunk_id: e.chunk_id,
            source_type: e.source_type,
            doi: e.doi,
            arxiv_id: e.arxiv_id,
            year: e.year,
            journal: e.journal,
            authors_preview,
            preview_text: preview,
          };
        }),
      };
    }

    case "analyze_evidence": {
      const indices: number[] = Array.isArray(args.indices) ? args.indices.map((n: any) => Math.floor(Number(n))) : [];
      const max_chars: number = Number.isFinite(args.max_chars) ? Math.floor(args.max_chars) : 4000;
      const evidence = agentState.getEvidence();

      const analyzed = indices.map((idx: number) => {
        if (idx < 0 || idx >= evidence.length) {
          return { index: idx, error: "Invalid index" };
        }
        const e = evidence[idx];
        const full = (e.text || "No content");
        const truncated = full.length > max_chars ? full.slice(0, max_chars) + "\n[... truncated ...]" : full;
        return {
          index: idx,
          title: e.title,
          authors: e.authors,
          year: e.year,
          quality: e.source_type === "pdf" ? "high" : e.source_type === "abstract" ? "medium" : "low",
          full_text: truncated,
          metadata: {
            journal: e.journal,
            doi: e.doi,
            arxiv_id: e.arxiv_id,
            section: e.section,
            page: e.page,
            chunk_id: e.chunk_id,
            source_type: e.source_type,
          },
        };
      });

      return {
        success: true,
        analyzed,
      };
    }

    case "synthesize_answer": {
      const evidence = agentState.getEvidence();
      let answer_text: string = (args.answer_text ?? "").toString();
      const confidence: string = (args.confidence ?? "medium").toString();
      const provided_indices: number[] = Array.isArray(args.cited_indices)
        ? args.cited_indices.map((n: any) => Math.floor(Number(n))).filter((n: any) => Number.isFinite(n))
        : [];

      console.log(`\n${"=".repeat(80)}`);
      console.log(`[A2 SYNTHESIZE] Answer generated by LLM`);
      console.log(`${"=".repeat(80)}`);
      console.log(`[A2 SYNTHESIZE] Answer length: ${answer_text.length} chars`);
      console.log(`[A2 SYNTHESIZE] LLM cited indices (provided): ${JSON.stringify(provided_indices)}`);
      console.log(`[A2 SYNTHESIZE] Confidence: ${confidence}`);

      console.log(`\n[A2 SYNTHESIZE] Answer text (BEFORE cleanup):`);
      console.log(`${answer_text}`);
      console.log(`${"=".repeat(80)}\n`);

      // 1) Parse citation markers in order of appearance
      const markerRegex = /\[(\d+)\]/g;
      const seen = new Set<number>();
      const markerOrder: number[] = [];
      let m: RegExpExecArray | null;

      while ((m = markerRegex.exec(answer_text)) !== null) {
        const idx = parseInt(m[1], 10);
        if (!Number.isFinite(idx)) continue;
        if (idx < 0 || idx >= evidence.length) continue;
        if (!seen.has(idx)) {
          seen.add(idx);
          markerOrder.push(idx);
        }
      }

      // 2) Remove invalid markers (outside evidence range) from answer text
      answer_text = answer_text.replace(/\[(\d+)\]/g, (full, g1) => {
        const idx = parseInt(g1, 10);
        if (!Number.isFinite(idx)) return "";
        return idx >= 0 && idx < evidence.length ? full : "";
      });

      // 3) Reconcile cited_indices with what appears in the answer
      const validProvided = provided_indices.filter((idx) => idx >= 0 && idx < evidence.length);
      const finalCitedIndices = markerOrder.length
        ? markerOrder
        : Array.from(new Set(validProvided)).sort((a, b) => a - b);

      // Log mismatches for debugging
      const providedSet = new Set(validProvided);
      const inTextSet = new Set(markerOrder);
      const missingInProvided = markerOrder.filter((idx) => !providedSet.has(idx));
      const extraProvided = validProvided.filter((idx) => !inTextSet.has(idx));
      if (missingInProvided.length > 0) {
        console.log(`[A2 SYNTHESIZE] NOTE: Markers in text but not in provided cited_indices: ${missingInProvided.join(", ")}`);
      }
      if (extraProvided.length > 0) {
        console.log(`[A2 SYNTHESIZE] NOTE: Provided cited_indices not present in answer text: ${extraProvided.join(", ")}`);
      }

      const result = {
        answer: answer_text, // remapping done later in format_citations
        cited_indices: finalCitedIndices,
        confidence,
        timestamp: new Date().toISOString(),
      };

      agentState.setSynthesisResult(result);

      return {
        success: true,
        message: "Answer synthesized",
        confidence,
        citations_count: finalCitedIndices.length,
        cited_indices: finalCitedIndices,
      };
    }

    case "format_citations": {
      const style: string = (args.style ?? "APA").toString();
      const text_max_chars: number = Number.isFinite(args.text_max_chars) ? Math.floor(args.text_max_chars) : 500;
      const evidence = agentState.getEvidence();

      // Prefer indices that actually appear in the synthesized answer (order of appearance)
      const synthesisResult = agentState.getSynthesisResult();
      const requested_indices: number[] = Array.isArray(args.cited_indices)
        ? args.cited_indices.map((n: any) => Math.floor(Number(n))).filter((n: any) => Number.isFinite(n))
        : [];

      const indicesFromAnswer: number[] = [];
      if (synthesisResult?.answer) {
        const r = /\[(\d+)\]/g;
        const seen = new Set<number>();
        let mm: RegExpExecArray | null;
        while ((mm = r.exec(synthesisResult.answer)) !== null) {
          const idx = parseInt(mm[1], 10);
          if (!Number.isFinite(idx)) continue;
          if (idx < 0 || idx >= evidence.length) continue;
          if (!seen.has(idx)) {
            seen.add(idx);
            indicesFromAnswer.push(idx);
          }
        }
      }

      const effective_indices = (indicesFromAnswer.length ? indicesFromAnswer : requested_indices)
        .filter((idx) => idx >= 0 && idx < evidence.length);

      console.log(`[A2] format_citations: Indices requested: ${JSON.stringify(requested_indices)}`);
      console.log(`[A2] format_citations: Indices used (effective): ${JSON.stringify(effective_indices)}`);
      console.log(`[A2] Evidence length: ${evidence.length}`);

      // Create mapping from original indices to display indices
      const indexMapping: Map<number, number> = new Map();

      const citations = effective_indices
        .filter((idx: number) => {
          const valid = idx >= 0 && idx < evidence.length;
          if (!valid) console.log(`[A2] Invalid index: ${idx} (Max: ${evidence.length - 1})`);
          return valid;
        })
        .map((idx: number, displayIdx: number) => {
          // Store mapping: original evidence index → display index (1-based)
          indexMapping.set(idx, displayIdx + 1);

          const e = evidence[idx];
          const authorsList = e.authors || [];
          const authors = authorsList.slice(0, 3).join(", ") + (authorsList.length > 3 ? " et al." : "");

          let formatted = "";
          switch (style) {
            case "APA":
              formatted = `[${displayIdx + 1}] ${authors} (${e.year}). ${e.title}. ${e.journal}.`;
              if (e.section) formatted += ` Section: ${e.section}.`;  // NEW: Show section
              if (e.doi) formatted += ` https://doi.org/${e.doi}`;
              break;
            case "IEEE":
              formatted = `[${displayIdx + 1}] ${authors}, "${e.title}," ${e.journal}, ${e.year}.`;
              if (e.section) formatted += ` (${e.section})`;  // NEW: Show section
              break;
            case "MLA":
              formatted = `[${displayIdx + 1}] ${authors}. "${e.title}." ${e.journal}, ${e.year}.`;
              if (e.section) formatted += ` ${e.section}.`;  // NEW: Show section
              break;
            default:
              formatted = `[${displayIdx + 1}] ${e.title}. ${authors} (${e.year}).`;
              if (e.section) formatted += ` - ${e.section}`;  // NEW: Show section
          }

          // Add location details for main paper
          let locationDetails = null;
          if (e.is_main_paper && e.locations && e.locations.length > 0) {
            locationDetails = e.locations.map(loc => ({
              paragraph: loc.paragraph,
              line: loc.line,
              start_sentence: loc.start_sentence,
            }));
          }

          return {
            index: displayIdx + 1,  // Sequential numbering for display [1], [2], [3]
            formatted,
            title: e.title,
            authors: e.authors,
            year: e.year,
            doi: e.doi,
            arxiv_id: e.arxiv_id,
            journal: e.journal,
            is_main_paper: e.is_main_paper || false,
            locations: locationDetails,
            pdf_path: e.pdf_path,
            section: e.section,  // NEW: Section name for highlighting
            page: e.page,        // NEW: Page number
            chunk_id: e.chunk_id, // NEW: Chunk identifier
            text: (e.text || "").slice(0, text_max_chars),
            evidence_index: idx  // NEW: Store original evidence index for mapping
          };
        });

      // Update answer text to use display indices instead of original indices
      if (synthesisResult?.answer) {
        let updatedAnswer = synthesisResult.answer;

        console.log(`\n${'='.repeat(80)}`);
        console.log(`[A2 REMAP] Citation number remapping`);
        console.log(`${'='.repeat(80)}`);
        console.log(`[A2 REMAP] Index mapping (evidence → display):`, Object.fromEntries(indexMapping));

        // Replace all citation numbers using a SINGLE PASS to avoid double-replacement
        // (e.g. replacing [22] with [9] and then replacing [9] with [4] in the same for-loop)
        console.log(`[A2 REMAP] Performing single-pass remapping...`);
        updatedAnswer = updatedAnswer.replace(/\[(\d+)\]/g, (match: string, g1: string) => {
          const originalIdx = parseInt(g1, 10);
          const displayIdx = indexMapping.get(originalIdx);
          if (displayIdx !== undefined) {
            console.log(`[A2 REMAP]   - Match [${originalIdx}] maps to [${displayIdx}]`);
            return `[${displayIdx}]`;
          }
          return match;
        });

        console.log(`\n[A2 REMAP] Answer text (AFTER remapping):`);
        console.log(`${updatedAnswer}`);

        // Find which display indices are actually in the answer
        const citationsInAnswer = new Set<number>();
        for (let i = 1; i <= citations.length; i++) {
          if (updatedAnswer.includes(`[${i}]`)) {
            citationsInAnswer.add(i);
          }
        }

        const missingCitations = [];
        for (let i = 1; i <= citations.length; i++) {
          if (!citationsInAnswer.has(i)) {
            missingCitations.push(i);
          }
        }

        console.log(`\n[A2 REMAP] Citations actually used in answer: ${Array.from(citationsInAnswer).sort((a, b) => a - b).join(', ')}`);
        if (missingCitations.length > 0) {
          console.log(`[A2 REMAP] ⚠️  WARNING: Citations in reference list but NOT in answer: ${missingCitations.join(', ')}`);
        }
        console.log(`${'='.repeat(80)}\n`);

        // Update answer in synthesisResult
        synthesisResult.answer = updatedAnswer;
        agentState.setSynthesisResult(synthesisResult);
      }

      console.log(`[A2] Formatted ${citations.length} citations for UI.`);
      if (citations.length > 0) {
        console.log(`[A2] First citation: ${JSON.stringify(citations[0], null, 2)}`);
      } else {
        console.log(`[A2] ⚠️ No citations formatted! Check indices vs evidence.`);
      }

      // Store citations in agent state so they can be retrieved later
      agentState.setFormattedCitations(citations);

      return {
        success: true,
        citations,
        style,
      };
    }

    default:
      return { success: false, error: `Unknown function: ${name}` };
  }
}

// AGENT LOOP
async function runAgent(maxIterations: number = 10): Promise<any> {
  const query = agentState.getQuery();
  const evidence = agentState.getEvidence();
  const expertise = agentState.getExpertise();
  const format = agentState.getFormat();

  // Map expertise levels
  const expertiseMap: Record<string, string> = {
    novice: "beginner",
    intermediate: "intermediate",
    expert: "expert",
    unknown: "intermediate",
  };
  const mappedExpertise = expertiseMap[expertise] || "intermediate";

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You are A2 (Answer Writer). Your job is to write a helpful answer that is strictly grounded in the provided evidence chunks.

Required workflow:
1) get_evidence (inspect what evidence exists and what each chunk contains)
2) analyze_evidence for the specific indices you plan to cite (read the full text)
3) synthesize_answer (write answer with inline citations like [0])
4) format_citations (build the UI reference list AND remap citation numbers)

Evidence guidance:
- Evidence indices are 0-based and come from get_evidence.
- A comparison always has two sides: the main paper and external research.
- Use 'is_main_paper=true' chunks for details about the paper under study (Side A).
- Use 'is_main_paper=false' chunks for details about other methods/papers (Side B).
- For comparison questions: Perform a clear, side-by-side comparison. Do not prioritize one side over the other; represent both fairly using their respective evidence chunks.
- Always cite the most specific source. If information about the main paper is in a main paper chunk, cite that chunk. If information about an external paper is in an external chunk, cite that external chunk.
- Use section/page/chunk_id metadata when available to anchor your explanation (e.g., "Methods", "Introduction").

Citation rules:
- Put citations immediately after the supported claim: "... [3]" (not as a dangling sentence).
- Multiple sources can be stacked: "... [0][4]".
- Every bracket marker must be a valid evidence index from get_evidence.

Grounding:
- Use ONLY the provided evidence. If a detail isn't supported, say so.

Length & style rules (MUST follow):
- beginner: 120–220 words, minimal jargon, define key terms, max 4 bullets, include 1 short example.
- intermediate: 250–450 words, moderate technical detail, include 2–5 bullet takeaways.
- expert: 700–1200 words, scientific/technical tone, include assumptions, limitations, and nuanced trade-offs.

CRITICAL: You MUST call synthesize_answer AND format_citations before stopping.

Query: "${query}"
Evidence count: ${evidence.length}
Expertise: ${mappedExpertise}
Format: ${format}

Language:
${mappedExpertise === "beginner" ? "- Short and simple. Define terms. One small example." : ""}
${mappedExpertise === "intermediate" ? "- Medium length. Moderate technical detail." : ""}
${mappedExpertise === "expert" ? "- Comprehensive and scientific. Include nuances, assumptions, limitations." : ""}`,
    },
    {
      role: "user",
      content: `Please answer this question using the available evidence: "${query}"`,
    },
  ];

  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`\n[A2 ITERATION ${iteration}/${maxIterations}]`);

    const response = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.3,
    });

    const message = response.choices[0].message;
    messages.push(message);

    // Check if done
    if (!message.tool_calls || message.tool_calls.length === 0) {
      console.log("\n[A2 COMPLETE]");
      return {
        status: "complete",
        final_message: message.content,
        iterations: iteration,
      };
    }

    // Execute tool calls
    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== "function") continue;
      const functionName = toolCall.function.name;
      const functionArgs = JSON.parse(toolCall.function.arguments);

      const result = await executeFunction(functionName, functionArgs);

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    status: "max_iterations",
    iterations: iteration,
  };
}

// PUBLIC API (matching A0's interface)
export async function run(task: A2Task): Promise<A2Result> {
  try {
    console.log("\n" + "=".repeat(60));
    console.log("[A2 RECEIVED TASK FROM A0]");
    console.log(`Query: ${task.inputs.query}`);
    console.log(`Evidence: ${task.inputs.evidence?.length || 0} items`);
    console.log(`Expertise: ${task.inputs.expertise}`);
    console.log(`Format: ${task.inputs.format}`);
    console.log("=".repeat(60));

    // Validate inputs
    if (!task.inputs.evidence || task.inputs.evidence.length === 0) {
      return {
        agent: "A2",
        status: "error",
        answer: "",
        citations: [],
        error: "No evidence provided",
      };
    }

    // Reset and set state
    agentState.reset();
    agentState.setTask(task);

    // Run agent
    const result = await runAgent();

    // Get synthesis result
    const synthesis = agentState.getSynthesisResult();

    if (!synthesis) {
      return {
        agent: "A2",
        status: "error",
        answer: "",
        citations: [],
        error: "Failed to synthesize answer",
      };
    }

    // REMOVED: Don't call format_citations here - LLM already calls it during agent loop!
    // Calling it twice causes answer to be remapped twice, leading to wrong citation numbers

    // Get citations from agentState (set by LLM's format_citations call)
    const formattedCitations = agentState.getFormattedCitations();
    console.log(`[A2 RUN] Retrieved ${formattedCitations.length} formatted citations from agent state`);

    return {
      agent: "A2",
      status: "success",
      answer: synthesis.answer,
      citations: formattedCitations,  // Get from agent state instead of calling format_citations again
      confidence: synthesis.confidence,
      metadata: {
        iterations: result.iterations,
        evidence_count: task.inputs.evidence.length,
        citations_count: synthesis.cited_indices.length,
        expertise: task.inputs.expertise,
        format: task.inputs.format,
      },
    };
  } catch (error) {
    console.error("[A2 ERROR]", error);
    return {
      agent: "A2",
      status: "error",
      answer: "",
      citations: [],
      error: String(error),
    };
  }
}

// TESTING
if (require.main === module) {
  (async () => {
    const mockEvidence: Evidence[] = [
      {
        title: "Attention Is All You Need",
        authors: ["Vaswani, A.", "Shazeer, N.", "Parmar, N."],
        year: "2017",
        journal: "NeurIPS",
        doi: "10.5555/3295222.3295349",
        arxiv_id: "1706.03762",
        text: "The Transformer model architecture relies entirely on self-attention mechanisms to compute representations of its input and output without using sequence-aligned RNNs or convolution. The attention mechanism allows the model to focus on different parts of the input sequence when producing each element of the output.",
        source_type: "abstract",
      },
      {
        title: "BERT: Pre-training of Deep Bidirectional Transformers",
        authors: ["Devlin, J.", "Chang, M.", "Lee, K.", "Toutanova, K."],
        year: "2019",
        journal: "NAACL",
        doi: "10.18653/v1/N19-1423",
        arxiv_id: "1810.04805",
        text: "BERT is designed to pre-train deep bidirectional representations from unlabeled text by jointly conditioning on both left and right context in all layers. The pre-trained BERT model can be fine-tuned with just one additional output layer.",
        source_type: "abstract",
      },
    ];

    const task: A2Task = {
      agent: "A2",
      action: "reason",
      inputs: {
        query: "What are transformer models in NLP?",
        evidence: mockEvidence,
        expertise: "intermediate",
        format: "markdown",
      },
    };

    const result = await run(task);

    console.log("\n\n=== RESULT ===");
    console.log("Status:", result.status);
    console.log("\nAnswer:");
    console.log(result.answer);
    console.log("\nCitations:");
    result.citations.forEach((c: any) => {
      console.log(c.formatted);
    });
    console.log("\nMetadata:", JSON.stringify(result.metadata, null, 2));
  })();
}