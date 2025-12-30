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
      description: "Create final answer with citations [1], [2], etc.",
      parameters: {
        type: "object",
        properties: {
          answer_text: {
            type: "string",
            description: "Complete answer with citation markers like [1], [2]",
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
      
      const citations = cited_indices
        .filter((idx: number) => idx >= 0 && idx < evidence.length)
        .map((idx: number, displayIdx: number) => {
          const e = evidence[idx];
          const authors = e.authors.slice(0, 3).join(", ") + (e.authors.length > 3 ? " et al." : "");
          
          let formatted = "";
          switch (style) {
            case "APA":
              formatted = `[${displayIdx + 1}] ${authors} (${e.year}). ${e.title}. ${e.journal}.`;
              if (e.doi) formatted += ` https://doi.org/${e.doi}`;
              break;
            case "IEEE":
              formatted = `[${displayIdx + 1}] ${authors}, "${e.title}," ${e.journal}, ${e.year}.`;
              break;
            case "MLA":
              formatted = `[${displayIdx + 1}] ${authors}. "${e.title}." ${e.journal}, ${e.year}.`;
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
            journal: e.journal,
          };
        });

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
      content: `You are Agent A2, a research synthesis agent.

Your task: Analyze evidence and synthesize a comprehensive answer.

Query: "${query}"
Evidence available: ${evidence.length} items
Expertise level: ${mappedExpertise}
Output format: ${format}

Instructions:
1. Use get_evidence to see all available evidence
2. Analyze relevant evidence items deeply
3. Synthesize a clear, well-reasoned answer
4. Cite sources with [1], [2] notation
5. Format citations properly
6. Adapt language complexity to ${mappedExpertise} level

For ${mappedExpertise} level:
${mappedExpertise === "beginner" ? "- Use simple language\n- Explain technical terms\n- Provide examples" : ""}
${mappedExpertise === "intermediate" ? "- Use moderate technical language\n- Assume basic knowledge\n- Be concise" : ""}
${mappedExpertise === "expert" ? "- Use technical language\n- Assume deep knowledge\n- Focus on nuances" : ""}

When done, synthesize the answer and format citations.`,
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