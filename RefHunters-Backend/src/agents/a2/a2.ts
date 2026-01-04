import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// TYPES (matching A0's expectations)
export interface Evidence {
  doi?: string;
  title: string;
  authors: string[];
  year: string;
  journal: string;
  arxiv_id?: string;
  text?: string;
  source_type?: "pdf" | "abstract" | "metadata_only";
  section?: string;        // Section name (e.g., "Introduction", "Methods")
  chunk_id?: string;       // Unique chunk identifier (e.g., "main_1", "ref_0_2")
  page?: number;           // Page number
  is_main_paper?: boolean; // True if from main paper, false if reference
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

  reset() {
    this.evidence = [];
    this.query = "";
    this.expertise = "intermediate";
    this.format = "markdown";
    this.synthesisResult = null;
  }
}

const agentState = new AgentState();

// TOOLS
const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_evidence",
      description: "Get all evidence items to analyze.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_evidence",
      description: "Analyze specific evidence items deeply.",
      parameters: {
        type: "object",
        properties: {
          indices: {
            type: "array",
            items: { type: "number" },
            description: "Evidence indices to analyze",
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
      description: "Create final answer with INLINE citations. CRITICAL: Place [0], [1], [2] citations immediately after EACH claim/fact, NOT at the end of paragraphs. Every sentence with a fact must have its own citation.",
      parameters: {
        type: "object",
        properties: {
          answer_text: {
            type: "string",
            description: "Complete answer with citation markers [0], [1], [2] placed INLINE after each claim. Example: 'MagNet uses multi-scale processing [0]. It has two modules [1].' NOT 'MagNet uses multi-scale processing. It has two modules. [0][1]'",
          },
          cited_indices: {
            type: "array",
            items: { type: "number" },
            description: "List of evidence indices cited",
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
      description: "Format the citations list for the cited evidence.",
      parameters: {
        type: "object",
        properties: {
          cited_indices: {
            type: "array",
            items: { type: "number" },
            description: "Evidence indices that were cited",
          },
          style: {
            type: "string",
            enum: ["APA", "IEEE", "MLA"],
            description: "Citation style",
            default: "APA",
          },
        },
        required: ["cited_indices"],
      },
    },
  },
];

// TOOL EXECUTION
async function executeFunction(
  name: string,
  args: Record<string, any>
): Promise<any> {
  console.log(`\n[A2 TOOL] ${name}`);

  switch (name) {
    case "get_evidence": {
      const evidence = agentState.getEvidence();
      return {
        success: true,
        count: evidence.length,
        evidence: evidence.map((e, i) => ({
          index: i,
          title: e.title,
          authors: e.authors.slice(0, 3).join(", ") + (e.authors.length > 3 ? " et al." : ""),
          year: e.year,
          source_type: e.source_type,
          text_preview: e.text?.substring(0, 300) + "..." || "No text",
        })),
      };
    }

    case "analyze_evidence": {
      const { indices } = args;
      const evidence = agentState.getEvidence();

      const analyzed = indices.map((idx: number) => {
        if (idx < 0 || idx >= evidence.length) {
          return { index: idx, error: "Invalid index" };
        }
        const e = evidence[idx];
        return {
          index: idx,
          title: e.title,
          authors: e.authors,
          year: e.year,
          quality: e.source_type === "pdf" ? "high" : e.source_type === "abstract" ? "medium" : "low",
          full_text: e.text || "No content",
          metadata: {
            journal: e.journal,
            doi: e.doi,
            arxiv_id: e.arxiv_id,
          },
        };
      });

      return {
        success: true,
        analyzed,
      };
    }

    case "synthesize_answer": {
      const { answer_text, cited_indices, confidence } = args;

      const result = {
        answer: answer_text,
        cited_indices,
        confidence,
        timestamp: new Date().toISOString(),
      };

      agentState.setSynthesisResult(result);

      return {
        success: true,
        message: "Answer synthesized",
        confidence,
        citations_count: cited_indices.length,
      };
    }

    case "format_citations": {
      const { cited_indices, style = "APA" } = args;
      const evidence = agentState.getEvidence();

      // Create mapping from original indices to display indices
      const indexMapping: Map<number, number> = new Map();

      const citations = cited_indices
        .filter((idx: number) => idx >= 0 && idx < evidence.length)
        .map((idx: number, displayIdx: number) => {
          // Store mapping: original index -> display index (1-based)
          indexMapping.set(idx, displayIdx + 1);
          const e = evidence[idx];
          const authors = e.authors.slice(0, 3).join(", ") + (e.authors.length > 3 ? " et al." : "");

          // Show section if available (for both main paper and references)
          const displayInfo = e.section
            ? `Section: "${e.section}"`
            : e.journal;

          let formatted = "";
          switch (style) {
            case "APA":
              formatted = `[${displayIdx + 1}] ${authors} (${e.year}). ${e.title}. ${displayInfo}.`;
              if (e.doi) formatted += ` https://doi.org/${e.doi}`;
              break;
            case "IEEE":
              formatted = `[${displayIdx + 1}] ${authors}, "${e.title}," ${displayInfo}, ${e.year}.`;
              break;
            case "MLA":
              formatted = `[${displayIdx + 1}] ${authors}. "${e.title}." ${displayInfo}, ${e.year}.`;
              break;
            default:
              formatted = `[${displayIdx + 1}] ${e.title}. ${authors} (${e.year}).`;
          }

          return {
            index: displayIdx + 1,
            formatted,
            title: e.title,
            authors: e.authors,
            year: e.year,
            doi: e.doi,
            arxiv_id: e.arxiv_id,
            journal: displayInfo,
            section: e.section,  // Section name

            // Include evidence chunk for frontend citation interaction
            evidenceChunk: {
              text: e.text,
              section: e.section || 'Unknown',
              page: e.page,
              is_main_paper: e.is_main_paper || false,  // Flag for PDF highlighting
            },
          };
        });

      // Update answer text to use display indices instead of original indices
      const synthesisResult = agentState.getSynthesisResult();
      if (synthesisResult?.answer) {
        let updatedAnswer = synthesisResult.answer;

        // Replace all citation numbers with mapped display numbers
        // Sort by index descending to avoid replacing shorter numbers first (e.g., [1] before [10])
        const sortedIndices = Array.from(indexMapping.keys()).sort((a, b) => b - a);
        for (const originalIdx of sortedIndices) {
          const displayIdx = indexMapping.get(originalIdx)!;
          // Replace [originalIdx] with [displayIdx]
          updatedAnswer = updatedAnswer.replace(
            new RegExp(`\\[${originalIdx}\\]`, 'g'),
            `[${displayIdx}]`
          );
        }

        // Update answer in synthesisResult
        synthesisResult.answer = updatedAnswer;
        agentState.setSynthesisResult(synthesisResult);
      }

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
async function runAgent(maxIterations: number = 7): Promise<any> {
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
      content: `You are A2, the Answer Writer. Synthesize evidence into clear, cited answers.

WORKFLOW:
1. get_evidence (see all chunks, index 0 = most relevant)
2. analyze_evidence (examine relevant indices)
3. synthesize_answer (REQUIRED - write answer with citations)
4. format_citations (optional - format citation list)

EVIDENCE RULES:
- Evidence is pre-sorted by relevance: [0] = MOST relevant
- Prioritize high-ranked evidence (indices 0, 1, 2)
- Match section types to answer structure:
  • Abstract → Introduction/overview
  • Methods/Architecture → Main explanation
  • Experiments → Results/validation
  • Conclusions → Summary (use sparingly)

CITATION RULES:
- Cite inline: "MagNet uses multi-scale processing [0]."
- NOT at end: "MagNet uses multi-scale processing. [0]"
- Multiple sources: "claim [0][1]"
- Every fact needs a citation immediately after

GROUNDING:
- ONLY use provided evidence, no external knowledge
- If insufficient evidence: "I could not find sufficient information..."
- Every claim MUST have citation [0], [1], [2]

CRITICAL: You MUST call synthesize_answer before stopping!

Query: "${query}"
Evidence: ${evidence.length} items (sorted by relevance)
Expertise: ${mappedExpertise}
Format: ${format}

Language for ${mappedExpertise}:
${mappedExpertise === "beginner" ? "- Simple language, explain terms, use examples" : ""}
${mappedExpertise === "intermediate" ? "- Moderate technical language, assume basic knowledge" : ""}
${mappedExpertise === "expert" ? "- Technical language, assume deep knowledge, focus on nuances" : ""}`,
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

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
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

    // Format citations
    const citationsResult = await executeFunction("format_citations", {
      cited_indices: synthesis.cited_indices,
      style: "APA",
    });

    return {
      agent: "A2",
      status: "success",
      answer: synthesis.answer,
      citations: citationsResult.citations || [],
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

