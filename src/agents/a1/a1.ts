import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// TYPES (matching A0's expectations)
export interface Citation {
  title: string;
  authors: string[];
  year: string;
  journal: string;
  doi: string;
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
}

export type A1Task =
  | { agent: "A1"; action: "ingest_parse"; inputs: { sources: any[] } }
  | { agent: "A1"; action: "retrieve"; inputs: { query: string; topN: number; topK: number; filters?: any; penalties?: any } };

export interface A1Result {
  agent: "A1";
  status: "success" | "error";
  citations?: Citation[];
  evidence?: Evidence[];
  error?: string;
}

// STATE MANAGEMENT
class AgentState {
  private citations: Citation[] = [];
  private evidence: Evidence[] = [];

  setCitations(citations: Citation[]) {
    this.citations = citations;
  }

  getCitations(): Citation[] {
    return this.citations;
  }

  addEvidence(evidence: Evidence) {
    this.evidence.push(evidence);
  }

  getEvidence(): Evidence[] {
    return this.evidence;
  }

  clearEvidence() {
    this.evidence = [];
  }

  reset() {
    this.citations = [];
    this.evidence = [];
  }
}

const agentState = new AgentState();

// TOOL IMPLEMENTATIONS
async function extractReferencesGrobid(pdfPath: string): Promise<string[]> {
  const grobidUrl = process.env.GROBID_URL || "http://localhost:8070";

  try {
    const fileBuffer = fs.readFileSync(pdfPath);
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: "application/pdf" });
    formData.append("input", blob, path.basename(pdfPath));
    formData.append("consolidateCitations", "1");

    const response = await axios.post(
      `${grobidUrl}/api/processFulltextDocument`,
      formData
    );

    const xmlText = response.data;
    const bibs = xmlText.match(/<biblStruct(.+?)<\/biblStruct>/gs) || [];
    return bibs.map((b: string) => `<biblStruct${b.slice(11)}`);
  } catch (error) {
    console.error("GROBID extraction failed:", error);
    return [];
  }
}

async function citationsToJson(citationBlocks: string[]): Promise<Citation[]> {
  if (citationBlocks.length === 0) return [];

  const blob = citationBlocks.join("\n\n");

  const msg = `Parse the following GROBID <biblStruct> XML citations.
Return ONLY valid JSON array with:

[
  {
    "title": "",
    "authors": [],
    "year": "",
    "journal": "",
    "doi": ""
  }
]

CITATIONS:
${blob}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: msg }],
      temperature: 0,
    });

    const content = response.choices[0].message.content || "[]";
    return JSON.parse(content);
  } catch (error) {
    console.error("\n[LLM BAD JSON OUTPUT]\n", error);
    return [];
  }
}

async function searchArxiv(title: string): Promise<string | null> {
  try {
    const url = `https://export.arxiv.org/api/query?search_query=ti:"${encodeURIComponent(title)}"&max_results=1`;
    const response = await axios.get(url);
    const xml = response.data;

    const match = xml.match(/<id>https?:\/\/arxiv\.org\/abs\/(.+?)<\/id>/);
    return match ? match[1] : null;
  } catch (error) {
    console.error("arXiv search failed:", error);
    return null;
  }
}

async function downloadPdf(arxivId: string, title: string): Promise<boolean> {
  try {
    const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
    const response = await axios.get(pdfUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
    });

    if (response.status !== 200) {
      return false;
    }

    const safe = title.replace(/[^a-zA-Z0-9]/g, "_") || "untitled";
    const downloadDir = "downloads";

    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    fs.writeFileSync(path.join(downloadDir, `${safe}.pdf`), response.data);
    return true;
  } catch (error) {
    console.error("PDF download failed:", error);
    return false;
  }
}

async function fetchArxivAbstract(arxivId: string): Promise<string | null> {
  try {
    const url = `https://export.arxiv.org/api/query?id_list=${arxivId}`;
    const response = await axios.get(url);
    const xml = response.data;

    const match = xml.match(/<summary>(.*?)<\/summary>/s);
    if (!match) {
      return null;
    }

    let abstract = match[1].trim();
    abstract = abstract.replace(/\s+/g, " ");
    return abstract;
  } catch (error) {
    console.error("Abstract fetch failed:", error);
    return null;
  }
}

// TOOL DEFINITIONS
const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "extract_citations_from_pdf",
      description: "Extract all citations from a research paper PDF using GROBID.",
      parameters: {
        type: "object",
        properties: {
          pdf_path: {
            type: "string",
            description: "Path to the PDF file",
          },
        },
        required: ["pdf_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_available_citations",
      description: "Get all currently extracted citations in memory.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "filter_citations",
      description: "Filter extracted citations based on keywords.",
      parameters: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description: "Search term to filter citations",
          },
          max_results: {
            type: "number",
            description: "Maximum number of results",
            default: 40,
          },
        },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_paper_on_arxiv",
      description: "Search for a paper on arXiv by title.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Paper title",
          },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "download_paper_pdf",
      description: "Download PDF from arXiv.",
      parameters: {
        type: "object",
        properties: {
          arxiv_id: {
            type: "string",
            description: "arXiv ID",
          },
          title: {
            type: "string",
            description: "Paper title",
          },
        },
        required: ["arxiv_id", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_paper_abstract",
      description: "Fetch abstract from arXiv.",
      parameters: {
        type: "object",
        properties: {
          arxiv_id: {
            type: "string",
            description: "arXiv ID",
          },
        },
        required: ["arxiv_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_to_evidence",
      description: "Add citation with content to evidence collection.",
      parameters: {
        type: "object",
        properties: {
          citation: {
            type: "object",
            description: "Citation object",
          },
          arxiv_id: {
            type: "string",
            description: "arXiv ID",
          },
          content_type: {
            type: "string",
            enum: ["pdf", "abstract", "metadata_only"],
            description: "Content type",
          },
          text: {
            type: "string",
            description: "Content text",
          },
        },
        required: ["citation", "content_type", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_if_blacklisted",
      description: "Check if DOI is blacklisted.",
      parameters: {
        type: "object",
        properties: {
          doi: {
            type: "string",
            description: "DOI to check",
          },
          blacklist: {
            type: "array",
            items: { type: "string" },
            description: "Blacklist array",
          },
        },
        required: ["doi", "blacklist"],
      },
    },
  },
];

// TOOL EXECUTION
async function executeFunction(
  name: string,
  args: Record<string, any>
): Promise<any> {
  console.log(`\n[A1 TOOL] ${name}`);

  switch (name) {
    case "extract_citations_from_pdf": {
      const { pdf_path } = args;
      if (!fs.existsSync(pdf_path)) {
        return { success: false, error: `PDF not found: ${pdf_path}` };
      }

      const xmlRefs = await extractReferencesGrobid(pdf_path);
      const citations = await citationsToJson(xmlRefs);
      agentState.setCitations(citations);

      return {
        success: true,
        count: citations.length,
        sample: citations.slice(0, 3).map((c) => c.title),
      };
    }

    case "get_available_citations": {
      const citations = agentState.getCitations();
      return {
        success: true,
        count: citations.length,
        citations: citations.map((c, i) => ({
          index: i,
          title: c.title,
          year: c.year,
          doi: c.doi,
        })),
      };
    }

    case "filter_citations": {
      const { keyword, max_results = 40 } = args;
      const allCitations = agentState.getCitations();

      const filtered = allCitations.filter(
        (c) =>
          c.title.toLowerCase().includes(keyword.toLowerCase()) ||
          c.authors.some((a) => a.toLowerCase().includes(keyword.toLowerCase()))
      );

      const result = filtered.slice(0, max_results);

      return {
        success: true,
        count: result.length,
        citations: result,
      };
    }

    case "search_paper_on_arxiv": {
      const { title } = args;
      const arxivId = await searchArxiv(title);

      return {
        success: !!arxivId,
        arxiv_id: arxivId,
      };
    }

    case "download_paper_pdf": {
      const { arxiv_id, title } = args;
      const success = await downloadPdf(arxiv_id, title);
      const safe = title.replace(/[^a-zA-Z0-9]/g, "_");

      return {
        success,
        path: success ? `downloads/${safe}.pdf` : null,
      };
    }

    case "fetch_paper_abstract": {
      const { arxiv_id } = args;
      const abstract = await fetchArxivAbstract(arxiv_id);

      return {
        success: !!abstract,
        abstract: abstract || null,
      };
    }

    case "add_to_evidence": {
      const { citation, arxiv_id, content_type, text } = args;

      const evidence: Evidence = {
        ...citation,
        arxiv_id,
        text,
        source_type: content_type,
      };

      agentState.addEvidence(evidence);

      return {
        success: true,
      };
    }

    case "check_if_blacklisted": {
      const { doi, blacklist } = args;
      const isBlacklisted = blacklist.includes(doi);

      return {
        success: true,
        blacklisted: isBlacklisted,
      };
    }

    default:
      return { success: false, error: `Unknown function: ${name}` };
  }
}

// AGENT LOOP
async function runAgent(
  userTask: string,
  maxIterations: number = 15
): Promise<any> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You are Agent A1, a Data & Evidence Agent.

Your role:
1. Extract citations from PDFs
2. Search and retrieve papers from arXiv
3. Build evidence collections

Guidelines:
- Extract citations first if working with PDFs
- Filter by keywords
- Get PDFs first, fallback to abstracts
- Skip blacklisted DOIs
- Add everything to evidence

Complete the task systematically.`,
    },
    {
      role: "user",
      content: userTask,
    },
  ];

  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`\n[A1 ITERATION ${iteration}/${maxIterations}]`);

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0,
    });

    const message = response.choices[0].message;
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      console.log("\n[A1 COMPLETE]");
      return {
        status: "complete",
        iterations: iteration,
      };
    }

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
export async function run(task: A1Task): Promise<A1Result> {
  try {
    console.log("\n" + "=".repeat(60));
    console.log("[A1 RECEIVED TASK FROM A0]");
    console.log(`Action: ${task.action}`);
    console.log("=".repeat(60));

    agentState.reset();

    if (task.action === "ingest_parse") {
      // Extract citations from PDFs
      const sources = task.inputs.sources || [];
      
      if (sources.length === 0) {
        return {
          agent: "A1",
          status: "error",
          error: "No sources provided",
        };
      }

      const taskStr = `Extract all citations from these PDF files: ${sources.join(", ")}. Store them in memory.`;
      await runAgent(taskStr);

      return {
        agent: "A1",
        status: "success",
        citations: agentState.getCitations(),
      };

    } else if (task.action === "retrieve") {
      // Build evidence from citations
      const { query, topN = 40, topK = 8, penalties = {} } = task.inputs;
      const blacklist = penalties?.blacklist || [];

      const taskStr = `Build a knowledge base about "${query}".

Steps:
1. Filter citations for "${query}" (top ${topN})
2. For each citation:
   - Search on arXiv
   - Download PDF or get abstract
   - Add to evidence
3. Skip blacklisted DOIs: ${JSON.stringify(blacklist)}
4. Limit to ${topK} evidence items`;

      await runAgent(taskStr);

      return {
        agent: "A1",
        status: "success",
        evidence: agentState.getEvidence().slice(0, topK),
      };

    } else {
      return {
        agent: "A1",
        status: "error",
        error: `Unknown action: ${(task as any).action}`,
      };
    }
  } catch (error) {
    console.error("[A1 ERROR]", error);
    return {
      agent: "A1",
      status: "error",
      error: String(error),
    };
  }
}

export { agentState };

// TESTING
if (require.main === module) {
  (async () => {
    // Test ingest_parse
    const task1: A1Task = {
      agent: "A1",
      action: "ingest_parse",
      inputs: {
        sources: ["paper.pdf"],
      },
    };

    const result1 = await run(task1);
    console.log(JSON.stringify(result1, null, 2));

    // Test retrieve
    const task2: A1Task = {
      agent: "A1",
      action: "retrieve",
      inputs: {
        query: "transformer attention",
        topN: 10,
        topK: 5,
        penalties: { blacklist: [] },
      },
    };

    const result2 = await run(task2);
    console.log(JSON.stringify(result2, null, 2));
  })();
}