import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import dotenv from "dotenv";

dotenv.config();

const OPENAI_KEY = process.env.OPENAI_API_KEY;

// LLM via LangChain
const llm = new ChatOpenAI({
  apiKey: OPENAI_KEY,
  model: "gpt-4o",
  temperature: 0,
});

// Types
export type A1Task =
  | { agent: "A1"; action: "ingest_parse"; inputs: { sources: any[] } }
  | { agent: "A1"; action: "retrieve"; inputs: { query: string; topN: number; topK: number; filters?: any; penalties?: any } };

interface Citation {
  title: string;
  authors: string[];
  year: string;
  journal: string;
  doi: string;
}

interface Evidence {
  doi?: string;
  title: string;
  authors: string[];
  year: string;
  journal: string;
  arxiv_id?: string;
  text?: string;
}

interface IngestParseResponse {
  status: string;
  ingested_count: number;
  citations?: Citation[];
}

interface RetrieveResponse {
  status: string;
  query: string;
  evidence: Evidence[];
}

// 1) Extract citations using GROBID
async function extractReferencesGrobid(pdfPath: string): Promise<string[]> {
  // Note: This assumes grobid-client is available via Node.js binding
  // You may need to use child_process to call the grobid CLI or HTTP API instead
  
  // For now, using HTTP API approach (recommended):
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

// 2) Convert XML citations → JSON via LLM
async function citationsToJson(citationBlocks: string[]): Promise<Citation[]> {
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
    const response = await llm.invoke([new HumanMessage(msg)]);
    const content =
      typeof response.content === "string"
        ? response.content
        : String(response.content);
    return JSON.parse(content);
  } catch (error) {
    console.error("\n[LLM BAD JSON OUTPUT]\n", error);
    return [];
  }
}

// 3) Search arXiv
async function searchArxiv(title: string): Promise<string | null> {
  try {
    const url = `https://export.arxiv.org/api/query?search_query=ti:"${title}"&max_results=1`;
    const response = await axios.get(url);
    const xml = response.data;

    const match = xml.match(/<id>https:\/\/arxiv\.org\/abs\/(.+?)<\/id>/);
    return match ? match[1] : null;
  } catch (error) {
    console.error("arXiv search failed:", error);
    return null;
  }
}

// 4) Download arXiv PDF
async function downloadPdf(arxivId: string, title: string): Promise<boolean> {
  try {
    const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
    const response = await axios.get(pdfUrl, {
      responseType: "arraybuffer",
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

// 5) Fetch abstract if PDF isn't available
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

// 6) Agent1 — executes tasks from Agent0
// Store extracted citations in memory for retrieve to access
let extractedCitations: Citation[] = [];

// Helper to manually set citations for testing
function setMockCitations(citations: Citation[]) {
  extractedCitations = citations;
  console.log(`[TEST] Set ${citations.length} mock citations`);
}

async function ingestParse(sources: any[]): Promise<IngestParseResponse> {
  console.log(`\n[INGEST] Processing ${sources.length} sources…`);
  
  const allCitations: Citation[] = [];
  
  for (const source of sources) {
    const pdfPath = source.path || source;
    
    if (!fs.existsSync(pdfPath)) {
      console.warn(`  ⚠ Source not found: ${pdfPath}`);
      continue;
    }

    console.log(`  → Extracting from ${pdfPath}`);
    const xmlRefs = await extractReferencesGrobid(pdfPath);
    const citations = await citationsToJson(xmlRefs);
    allCitations.push(...citations);
  }

  // Store for retrieve to use
  extractedCitations = allCitations;

  return {
    status: "ingested",
    ingested_count: sources.length,
    citations: allCitations,
  };
}

async function retrieve(
  query: string,
  topN: number,
  topK: number,
  filters?: any,
  penalties?: any
): Promise<RetrieveResponse> {
  console.log(`\n[RETRIEVE] Building KB for query: "${query}"`);
  
  const blacklist = penalties?.blacklist ?? [];

  // Filter extracted citations by query relevance
  const filtered = extractedCitations.filter((c) =>
    query.toLowerCase().includes(c.title.toLowerCase()) ||
    c.title.toLowerCase().includes(query.toLowerCase())
  );

  console.log(`  → Found ${filtered.length} matching citations`);

  const evidence: Evidence[] = [];
  const safe = (title: string) => title.replace(/[^a-zA-Z0-9]/g, "_");

  // Build KB: search arXiv for each citation, try to get PDF/abstract
  for (const citation of filtered.slice(0, topN)) {
    const title = citation.title || "untitled";
    console.log(`  → Processing: ${title}`);

    // Skip if blacklisted
    if (citation.doi && blacklist.includes(citation.doi)) {
      console.log(`    ✗ Blacklisted`);
      continue;
    }

    // Search arXiv for this citation
    const arxivId = await searchArxiv(title);
    if (!arxivId) {
      console.log(`    ⚠ Not found on arXiv`);
      evidence.push({
        ...citation,
        text: "[Citation found in paper but not available on arXiv]",
      });
      continue;
    }

    console.log(`    ✓ Found arXiv ID: ${arxivId}`);

    // Try to download PDF
    if (await downloadPdf(arxivId, title)) {
      console.log(`    ✓ PDF downloaded`);
      evidence.push({
        ...citation,
        arxiv_id: arxivId,
        text: `[PDF downloaded to downloads/${safe(title)}.pdf]`,
      });
    } else {
      // Fallback to abstract
      const abstract = await fetchArxivAbstract(arxivId);
      if (abstract) {
        const abstractDir = "abstracts";
        if (!fs.existsSync(abstractDir)) {
          fs.mkdirSync(abstractDir, { recursive: true });
        }
        fs.writeFileSync(path.join(abstractDir, `${safe(title)}.txt`), abstract, "utf-8");
        
        console.log(`    ✓ Abstract saved`);
        evidence.push({
          ...citation,
          arxiv_id: arxivId,
          text: abstract,
        });
      } else {
        console.log(`    ⚠ No abstract available`);
        evidence.push({
          ...citation,
          arxiv_id: arxivId,
          text: "[No content available]",
        });
      }
    }
  }

  return {
    status: "retrieved",
    query,
    evidence: evidence.slice(0, topK),
  };
}

async function run(task: A1Task): Promise<any> {
  try {
    const action = (task as any).action;
    if (action === "ingest_parse") {
      return await ingestParse((task as any).inputs.sources);
    } else if (action === "retrieve") {
      const { query, topN, topK, filters, penalties } = (task as any).inputs;
      return await retrieve(query, topN, topK, filters, penalties);
    } else {
      return { error: `Unknown action: ${action}`, status: "error" };
    }
  } catch (error) {
    console.error(`[A1 ERROR] ${error}`);
    return { error: String(error), status: "error" };
  }
}

// Export types and functions
export { run, setMockCitations, ingestParse, retrieve, extractReferencesGrobid, citationsToJson, searchArxiv, downloadPdf, fetchArxivAbstract };
export type { Citation, Evidence, IngestParseResponse, RetrieveResponse };

// Manual test (simulate Agent0)
if (require.main === module) {
  // Test ingest_parse
  run({
    agent: "A1",
    action: "ingest_parse",
    inputs: { sources: ["paper.pdf"] },
  }).then((result) => {
    console.log("INGEST RESULT:", JSON.stringify(result, null, 2));
  });

  // Test retrieve
  run({
    agent: "A1",
    action: "retrieve",
    inputs: {
      query: "transformer",
      topN: 40,
      topK: 8,
      penalties: { blacklist: [] },
    },
  }).then((result) => {
    console.log("RETRIEVE RESULT:", JSON.stringify(result, null, 2));
  });
}
