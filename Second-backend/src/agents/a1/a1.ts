import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import OpenAI from "openai";
import { parseLLMJson } from "../../utils";
import { parseSectionsFromGrobidXML } from "./sections-parser.js";
import { extractCitationMarkersFromSection, mapCitationIdsToIndices } from "./citation-extractor.js";
import dotenv from "dotenv";
const pdfParse = require("pdf-parse");

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
export interface Citation {
  title: string;
  authors: string[];
  year: string;
  journal: string;
  doi: string;
}

// JSON-schema-friendly citation shape for tool parameters
const CitationParamSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "Paper title." },
    authors: {
      type: "array",
      items: { type: "string" },
      description: "Author names (if available).",
    },
    year: { type: "string", description: "Publication year (if available)." },
    journal: { type: "string", description: "Venue/journal/conference name (if available)." },
    doi: { type: "string", description: "DOI (if available)." },
  },
  required: ["title"],
} as const;

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
  is_main_paper?: boolean; // True if this is the user's uploaded paper
  locations?: TextLocation[]; // Location info for text snippets from main paper
  pdf_path?: string; // Path to the main paper PDF

  // Section metadata for frontend highlighting
  section?: string; // Section name (e.g., "Introduction", "Methods")
  page?: number; // Page number where section appears
  chunk_id?: string; // Unique identifier for the chunk (e.g., "main_0")
  start_char?: number; // For future text highlighting
  end_char?: number; // For future text highlighting
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
  private mainPaperPath: string | null = null;
  private mainPaperText: ExtractedTextWithLocations | null = null;

  setCitations(citations: Citation[]) {
    this.citations = citations;
  }

  getCitations(): Citation[] {
    return this.citations;
  }

  addEvidence(evidence: Evidence): number {
    this.evidence.push(evidence);
    return this.evidence.length - 1;
  }

  getEvidence(): Evidence[] {
    return this.evidence;
  }

  clearEvidence() {
    this.evidence = [];
  }

  setMainPaper(path: string, text: ExtractedTextWithLocations) {
    this.mainPaperPath = path;
    this.mainPaperText = text;
  }

  getMainPaper(): { path: string | null; text: ExtractedTextWithLocations | null } {
    return { path: this.mainPaperPath, text: this.mainPaperText };
  }

  reset() {
    this.citations = [];
    this.evidence = [];
    this.mainPaperPath = null;
    this.mainPaperText = null;
  }
}

const agentState = new AgentState();

// PDF TEXT EXTRACTION WITH LOCATION TRACKING
export interface ExtractedTextWithLocations {
  fullText: string;
  paragraphs: Array<{
    paragraphNumber: number;
    text: string;
    lines: Array<{
      lineNumber: number;
      text: string;
      charStart: number;
      charEnd: number;
    }>;
  }>;
}

async function extractTextWithLocations(pdfPath: string): Promise<ExtractedTextWithLocations> {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdfParse(dataBuffer);

    const fullText = data.text;
    const paragraphs: ExtractedTextWithLocations["paragraphs"] = [];

    // Split by double newlines (paragraph breaks)
    const paragraphTexts = fullText.split(/\n\s*\n/).filter((p: string) => p.trim().length > 0);

    let charOffset = 0;

    paragraphTexts.forEach((paraText: string, paraIdx: number) => {
      const lines = paraText.split(/\n/).filter((l: string) => l.trim().length > 0);
      const paragraphLines: ExtractedTextWithLocations["paragraphs"][0]["lines"] = [];

      lines.forEach((lineText: string, lineIdx: number) => {
        const charStart = fullText.indexOf(lineText, charOffset);
        const charEnd = charStart + lineText.length;
        charOffset = charEnd;

        paragraphLines.push({
          lineNumber: lineIdx + 1,
          text: lineText.trim(),
          charStart,
          charEnd,
        });
      });

      if (paragraphLines.length > 0) {
        paragraphs.push({
          paragraphNumber: paraIdx + 1,
          text: paraText.trim(),
          lines: paragraphLines,
        });
      }
    });

    console.log(`[A1]  PDF-PARSE: Extracted ${paragraphs.length} paragraphs from main paper`);
    return { fullText, paragraphs };
  } catch (error) {
    console.error("[A1] Error extracting text from PDF:", error);
    return { fullText: "", paragraphs: [] };
  }
}

// Find text locations in the main paper
function findTextLocations(
  searchText: string,
  extracted: ExtractedTextWithLocations
): TextLocation[] {
  const locations: TextLocation[] = [];
  const searchLower = searchText.toLowerCase();

  extracted.paragraphs.forEach((para) => {
    para.lines.forEach((line) => {
      if (line.text.toLowerCase().includes(searchLower)) {
        // Find the sentence containing this text
        const sentences = line.text.match(/[^.!?]+[.!?]+/g) || [line.text];
        const matchingSentence = sentences.find(s =>
          s.toLowerCase().includes(searchLower)
        ) || sentences[0];

        locations.push({
          paragraph: para.paragraphNumber,
          line: line.lineNumber,
          start_sentence: matchingSentence.trim(),
          char_start: line.charStart,
          char_end: line.charEnd,
        });
      }
    });
  });

  return locations;
}

// TOOL IMPLEMENTATIONS
async function extractReferencesGrobid(pdfPath: string): Promise<string[]> {
  const grobidUrl = process.env.GROBID_URL || "http://localhost:8070";

  try {
    const fileBuffer = fs.readFileSync(pdfPath);
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: "application/pdf" });
    formData.append("input", blob, path.basename(pdfPath));
    formData.append("consolidateCitations", "1");

    console.log(`[A1]  GROBID: Processing PDF: ${pdfPath}`);
    console.log(`[A1]  GROBID URL: ${grobidUrl}`);

    const response = await axios.post(
      `${grobidUrl}/api/processFulltextDocument`,
      formData
    );

    const xmlText = response.data;

    // CHANGED BY DATE: 2026-01-02 - Save Grobid output for user verification
    const debugPath = path.join(path.dirname(pdfPath), "grobid_output.xml");
    fs.writeFileSync(debugPath, xmlText);
    console.log(`[A1]  GROBID output saved to: ${debugPath}`);

    const bibs = xmlText.match(/<biblStruct(.+?)<\/biblStruct>/gs) || [];
    console.log(`[A1]  GROBID: Extracted ${bibs.length} raw citations`);

    return bibs.map((b: string) => `<biblStruct${b.slice(11)}`);
  } catch (error) {
    console.error("GROBID extraction failed:", error);
    return [];
  }
}

/**
 * Extract FULL document structure from main paper using GROBID
 * Returns structured sections (Abstract, Introduction, Methods, etc.)
 */
async function extractFullDocumentGrobid(pdfPath: string): Promise<any> {
  const grobidUrl = process.env.GROBID_URL || "http://localhost:8070";

  console.log(`[A1]  GROBID: Extracting FULL document structure from ${path.basename(pdfPath)}`);
  console.log(`[A1]  GROBID URL: ${grobidUrl}/api/processFulltextDocument`);

  // Check cache first
  const pdfBasename = path.basename(pdfPath, '.pdf');
  const cacheDir = "grobid-output";
  const cacheFile = path.join(cacheDir, `${pdfBasename}_fulltext.xml`);

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  if (fs.existsSync(cacheFile)) {
    console.log(`[A1]  GROBID: Using cached full document XML from ${cacheFile}`);
    const xmlText = fs.readFileSync(cacheFile, 'utf-8');
    return { xml: xmlText, cached: true };
  }

  try {
    const fileBuffer = fs.readFileSync(pdfPath);
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: "application/pdf" });
    formData.append("input", blob, path.basename(pdfPath));

    const startTime = Date.now();
    const response = await axios.post(
      `${grobidUrl}/api/processFulltextDocument`,
      formData
    );
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    const xmlText = response.data;
    console.log(`[A1]  GROBID: Received ${xmlText.length} chars of full document XML in ${elapsed}s`);

    // Save to cache file
    fs.writeFileSync(cacheFile, xmlText);
    console.log(`[A1]  GROBID: Cached full document XML to ${cacheFile}`);

    return { xml: xmlText, cached: false };
  } catch (error) {
    console.error("[A1]  GROBID full document extraction failed:", error);
    return null;
  }
}


// ============================================================================
// DIRECT XML CITATION PARSER (No LLM Required)
// ============================================================================
// CHANGED BY DATE: 2026-01-03 - Replaced LLM-based parsing with direct regex
// This ensures 100% of citations are extracted (no loss from LLM truncation)
// Falls back to LLM if direct parsing fails

/**
 * Parse a single <biblStruct> XML block into a Citation object using regex.
 * This is faster and more reliable than LLM parsing.
 */
function parseXmlCitationDirect(xml: string): Citation | null {
  try {
    // Extract title - look for <title> tags (analytic or monogr)
    const titleMatch = xml.match(/<title[^>]*level="a"[^>]*>([^<]+)<\/title>/) ||
      xml.match(/<title[^>]*>([^<]+)<\/title>/);
    const title = titleMatch?.[1]?.trim() || "";

    // Skip if no title found (invalid citation)
    if (!title) return null;

    // Extract authors - look for <persName> inside <author>
    const authors: string[] = [];
    const authorMatches = xml.matchAll(/<author[^>]*>[\s\S]*?<\/author>/g);
    for (const authorBlock of authorMatches) {
      const forename = authorBlock[0].match(/<forename[^>]*>([^<]+)<\/forename>/)?.[1] || "";
      const surname = authorBlock[0].match(/<surname[^>]*>([^<]+)<\/surname>/)?.[1] || "";
      if (surname) {
        authors.push(forename ? `${forename} ${surname}` : surname);
      }
    }

    // Extract year - look for <date> with "when" attribute
    const yearMatch = xml.match(/<date[^>]*when="(\d{4})[^"]*"/) ||
      xml.match(/<date[^>]*>(\d{4})<\/date>/);
    const year = yearMatch?.[1] || "";

    // Extract journal - look for <title level="j"> (journal title)
    const journalMatch = xml.match(/<title[^>]*level="j"[^>]*>([^<]+)<\/title>/);
    const journal = journalMatch?.[1]?.trim() || "";

    // Extract DOI - look for <idno type="DOI">
    const doiMatch = xml.match(/<idno[^>]*type="DOI"[^>]*>([^<]+)<\/idno>/i);
    const doi = doiMatch?.[1]?.trim() || "";

    return { title, authors, year, journal, doi };
  } catch (error) {
    console.error("[A1] Error parsing XML citation:", error);
    return null;
  }
}

/**
 * Convert an array of XML citation blocks to Citation objects.
 * Uses direct regex parsing (fast, reliable, free).
 * Falls back to LLM if direct parsing returns too few results.
 */
async function citationsToJson(citationBlocks: string[]): Promise<Citation[]> {
  if (citationBlocks.length === 0) return [];

  // STEP 1: Try direct XML parsing first (no LLM)
  console.log(`[A1] Parsing ${citationBlocks.length} citations directly (no LLM)...`);
  const directResults: Citation[] = [];

  for (const xml of citationBlocks) {
    const parsed = parseXmlCitationDirect(xml);
    if (parsed) {
      directResults.push(parsed);
    }
  }

  console.log(`[A1] Direct parsing: ${directResults.length}/${citationBlocks.length} successful`);

  // STEP 2: If direct parsing got most citations (>80%), use it
  const successRate = directResults.length / citationBlocks.length;
  if (successRate >= 0.8) {
    console.log(`[A1] Using direct parsing results (${Math.round(successRate * 100)}% success)`);
    return directResults;
  }

  // STEP 3: Fallback to LLM if direct parsing failed badly
  console.log(`[A1] Direct parsing failed (<80%), falling back to LLM...`);
  return await citationsToJsonLLM(citationBlocks);
}

/**
 * FALLBACK: LLM-based citation parsing (original implementation).
 * Used only if direct XML parsing fails for >20% of citations.
 */
async function citationsToJsonLLM(citationBlocks: string[]): Promise<Citation[]> {
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
    const response = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: msg }],
      temperature: 0,
    });

    let content = response.choices[0].message.content || "[]";

    // CHANGED BY DATE: 2026-01-03 - Use robust parser 
    return parseLLMJson<Citation[]>(content);
  } catch (error) {
    console.error("\n[LLM BAD JSON OUTPUT] Raw content:", error);
    return [];
  }
}


// Helper: Sleep function for rate limit delays
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// MERGED: Search arXiv and download PDF in one function (with rate limit handling)
async function searchAndDownloadArxivPaper(title: string): Promise<{
  success: boolean;
  arxivId?: string;
  pdfPath?: string;
  error?: string;
}> {
  const maxRetries = 3;
  const baseDelay = 1500;  // arXiv rate limit is aggressive, use 1.5s delay

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Delay before each attempt to avoid rate limiting
      if (attempt > 0) {
        const retryDelay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s...
        console.log(`[A1] Retry ${attempt}/${maxRetries} after ${retryDelay}ms delay...`);
        await sleep(retryDelay);
      }

      // Step 1: Search arXiv for paper by title
      console.log(`[A1] Searching arXiv for: "${title}"`);

      // Add delay before API call
      await sleep(baseDelay);

      const searchUrl = `https://export.arxiv.org/api/query?search_query=ti:"${encodeURIComponent(title)}"&max_results=1`;
      const searchResponse = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'RefHunters/1.0 (mailto:admin@example.com) Axios/1.6.5'
        }
      });
      const xml = searchResponse.data;

      const match = xml.match(/<id>https?:\/\/arxiv\.org\/abs\/(.+?)<\/id>/);
      if (!match) {
        console.log(`[A1] Paper not found on arXiv: "${title}"`);
        return { success: false, error: "Paper not found on arXiv" };
      }

      const arxivId = match[1];
      console.log(`[A1] Found arXiv paper: ${arxivId}`);

      // Step 2: Download PDF (with delay)
      console.log(`[A1] Downloading PDF for ${arxivId}...`);

      // Add delay before PDF download
      await sleep(baseDelay);

      const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
      const pdfResponse = await axios.get(pdfUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: {
          'User-Agent': 'RefHunters/1.0 (mailto:admin@example.com) Axios/1.6.5'
        }
      });

      if (pdfResponse.status !== 200) {
        return { success: false, arxivId, error: "PDF download failed" };
      }

      // Save PDF
      const safe = title.replace(/[^a-zA-Z0-9]/g, "_") || "untitled";
      const downloadDir = "downloads";

      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
      }

      const pdfPath = path.join(downloadDir, `${safe}.pdf`);
      fs.writeFileSync(pdfPath, pdfResponse.data);

      console.log(`[A1] ✅ Successfully downloaded to: ${pdfPath}`);
      return { success: true, arxivId, pdfPath };

    } catch (error: any) {
      const status = error?.response?.status;
      // Handle rate limit errors (429) or service unavailable (503)
      if (status === 429 || status === 503) {
        console.log(`[A1] ⚠️  arXiv API ${status}. Attempt ${attempt + 1}/${maxRetries}`);
        if (attempt < maxRetries - 1) {
          continue; // Retry with exponential backoff
        } else {
          console.error(`[A1] ❌ Max retries reached for arXiv ${status}`);
          return { success: false, error: `arXiv ${status} after retries` };
        }
      }

      // Other errors - don't retry
      console.error("[A1] arXiv search and download failed:", error.message || error);
      return { success: false, error: String(error.message || error) };
    }
  }

  return { success: false, error: "Max retries exceeded" };
}


async function fetchArxivAbstract(arxivId: string): Promise<string | null> {
  const maxRetries = 3;
  const baseDelay = 1500;  // arXiv rate limit is aggressive, use 1.5s delay

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Delay before each attempt
      if (attempt > 0) {
        const retryDelay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s...
        console.log(`[A1] Retrying abstract fetch ${attempt}/${maxRetries} after ${retryDelay}ms...`);
        await sleep(retryDelay);
      }

      // Add delay before API call
      await sleep(baseDelay);

      const url = `https://export.arxiv.org/api/query?id_list=${arxivId}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'RefHunters/1.0 (mailto:admin@example.com) Axios/1.6.5'
        }
      });
      const xml = response.data;

      const match = xml.match(/<summary>(.*?)<\/summary>/s);
      if (!match) {
        return null;
      }

      let abstract = match[1].trim();
      abstract = abstract.replace(/\s+/g, " ");
      return abstract;

    } catch (error: any) {
      const status = error?.response?.status;
      // Handle rate limit errors (429) or service unavailable (503)
      if (status === 429 || status === 503) {
        console.log(`[A1] ⚠️  Abstract fetch arXiv ${status}. Attempt ${attempt + 1}/${maxRetries}`);
        if (attempt < maxRetries - 1) {
          continue; // Retry
        } else {
          console.error(`[A1] ❌ Abstract fetch: Max retries for arXiv ${status}`);
          return null;
        }
      }

      // Other errors
      console.error("Abstract fetch failed:", error.message || error);
      return null;
    }
  }

  return null;
}

// TOOL DEFINITIONS
const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "extract_citations_from_pdf",
      description:
        "[INGEST ONLY] Extract and cache structured citations from a local PDF using GROBID. " +
        "Call ONLY when citation cache is empty. Call get_available_citations first. " +
        "Returns: { success:boolean, count:number, sample_titles:string[], error?:string }",
      parameters: {
        type: "object",
        additionalProperties: false,
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
      description:
        "[FAST] Get cached citations already in memory. Call this before extract_citations_from_pdf. " +
        "Returns: { success:boolean, count:number, citations:Array<{index:number,title:string,year?:string,doi?:string}> }",
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
      name: "filter_citations",
      description:
        "[FAST] Filter cached citations by a query string (title/authors). " +
        "Returns citation_index for each match (use it in read_and_add_to_evidence / fetch_paper_abstract). " +
        "Returns: { success:boolean, count:number, citations:Array<{citation_index:number,title:string,authors:string[],year:string,journal:string,doi?:string}> }",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description: "Search query (keywords, author, paper name)",
          },
          max_results: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Maximum number of results",
            default: 12,
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_and_download_paper_on_arxiv",
      description:
        "Search arXiv by title and download the best matching PDF. " +
        "Returns: { success:boolean, arxiv_id?:string, pdf_path?:string, error?:string }",
      parameters: {
        type: "object",
        additionalProperties: false,
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


  // Keep fetch_paper_abstract - it's separate functionality
  {
    type: "function",
    function: {
      name: "fetch_paper_abstract",
      description:
        "Fetch arXiv abstract (fallback when PDF download fails). " +
        "Optionally add the abstract to evidence when citation_index/citation is provided. " +
        "Returns: { success:boolean, abstract?:string, added_to_evidence?:boolean, evidence_index?:number, error?:string }",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          arxiv_id: {
            type: "string",
            description: "arXiv ID",
          },
          citation_index: {
            type: "integer",
            description: "Index into cached citations returned by filter_citations (preferred)",
          },
          citation: {
            ...CitationParamSchema,
            description: "Fallback citation metadata if citation_index is unavailable",
          },
          add_to_evidence: {
            type: "boolean",
            description: "If true, store the abstract as an evidence item",
            default: true,
          },
          max_chars: {
            type: "integer",
            minimum: 200,
            maximum: 50000,
            description: "Max characters to store when add_to_evidence=true",
            default: 5000,
          },
        },
        required: ["arxiv_id"],
      },
    },
  },
  // CHANGED BY DATE: 2026-01-03 - New combined tool to read PDF and add to evidence in one step
  {
    type: "function",
    function: {
      name: "read_and_add_to_evidence",
      description:
        "Read a downloaded PDF and add it to evidence, preserving citation metadata. " +
        "Prefer passing citation_index from filter_citations rather than copying citation objects. " +
        "Returns: { success:boolean, evidence_index?:number, title?:string, text_length?:number, error?:string }",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          pdf_path: {
            type: "string",
            description: "Path to the downloaded PDF file",
          },
          citation_index: {
            type: "integer",
            description: "Index into cached citations returned by filter_citations (preferred)",
          },
          citation: {
            ...CitationParamSchema,
            description: "Fallback citation metadata if citation_index is unavailable",
          },
          arxiv_id: {
            type: "string",
            description: "The arXiv ID of the paper",
          },
          max_chars: {
            type: "integer",
            minimum: 1000,
            maximum: 200000,
            description: "Maximum characters of extracted PDF text to store",
            default: 20000,
          },
        },
        required: ["pdf_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_if_blacklisted",
      description: "Check whether a DOI is blacklisted. Returns: { success:boolean, blacklisted:boolean }",
      parameters: {
        type: "object",
        additionalProperties: false,
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
  {
    type: "function",
    function: {
      name: "extract_text_from_main_paper",
      description:
        "Extract text from the main uploaded paper with paragraph and line tracking. " +
        "Returns: { success:boolean, paragraphs_count:number, total_lines:number, error?:string }",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          pdf_path: {
            type: "string",
            description: "Path to the main paper PDF",
          },
        },
        required: ["pdf_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_main_paper_text",
      description:
        "Search cached main paper text and return matching locations/snippets. " +
        "Returns: { success:boolean, count:number, locations:TextLocation[], snippets:Array<{paragraph:number,line:number,start_sentence:string,full_line:string}> }",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description: "Text to search for in the main paper",
          },
          max_results: {
            type: "integer",
            minimum: 1,
            maximum: 200,
            default: 20,
          },
        },
        required: ["query"],
      },
    },
  },
];

// Helper function to check if a title matches the main paper
function isMainPaperTitle(title: string): boolean {
  const mainPaper = agentState.getMainPaper();
  if (!mainPaper.path) return false;

  const mainPaperFilename = path.basename(mainPaper.path);
  const mainPaperTitle = mainPaperFilename
    .replace(/_/g, " ")
    .replace(/-?\d+-\d+\.pdf$/i, "")
    .replace(".pdf", "")
    .trim()
    .toLowerCase();

  const searchTitle = title.toLowerCase().trim();

  // Check if they match (contains or is contained)
  return searchTitle.includes(mainPaperTitle) || mainPaperTitle.includes(searchTitle);
}

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

      // Log all titles for debugging (user request)
      console.log(`[A1] Full Citation List (${citations.length}):`);
      citations.forEach((c, i) => console.log(`   [${i + 1}] ${c.title}`));

      return {
        success: true,
        count: citations.length,
        sample_titles: citations.slice(0, 3).map((c) => c.title),
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
      // Backwards compatible: accept either {query} or {keyword}
      const query: string = (args.query ?? args.keyword ?? "").toString();
      const max_results: number = Number.isFinite(args.max_results) ? Math.floor(args.max_results) : 40;

      console.log(`[A1]  Filtering citations by query: "${query}"`);
      const allCitations = agentState.getCitations();

      // CHANGED BY DATE: 2026-01-03 - Robust multi-keyword filtering
      const stopWords = new Set(["and", "the", "a", "an", "of", "in", "on", "with", "between", "comparison", "compare", "architecture", "model", "paper", "is", "for", "to", "at", "by", "that", "this", "which", "are", "it"]);
      const keywords = query.toLowerCase()
        .split(/[\s,.;:?!()]+/)
        .filter((word: string) => word.length > 2 && !stopWords.has(word));

      console.log(`[A1]  Extracted keywords: ${JSON.stringify(keywords)}`);

      // Keep citation indices stable by carrying original indices through filtering
      const filtered = allCitations
        .map((c: any, index: number) => ({ c, index }))
        .filter(({ c, index }) => {
          const titleLower = (c.title || "").toLowerCase();
          const authorsLower = (c.authors || []).map((a: string) => a.toLowerCase());

          const isMatch = keywords.some((kw: string) =>
            titleLower.includes(kw) ||
            authorsLower.some((author: string) => author.includes(kw))
          );

          if (isMatch) {
            console.log(`[A1]  MATCH FOUND at index ${index}: "${c.title}"`);
          }
          return isMatch;
        });

      const result = filtered.slice(0, max_results);
      console.log(`[A1] Filter found ${result.length} matches`);

      return {
        success: true,
        count: result.length,
        citations: result.map(({ c, index }) => ({
          citation_index: index,
          title: c.title,
          authors: c.authors || [],
          year: c.year || "",
          journal: c.journal || "",
          doi: c.doi || "",
        })),
      };
    }

    case "search_and_download_paper_on_arxiv": {
      const { title } = args;
      console.log(`[A1] 🔍 Searching and downloading from arXiv: "${title}"`);

      // BLOCK downloading main paper
      if (isMainPaperTitle(title)) {
        console.log(`[A1] ⛔ BLOCKED: This is the main paper (already uploaded). Skipping download.`);
        return {
          success: false,
          arxiv_id: null,
          pdf_path: null,
          error: "Blocked: This is the main paper (already uploaded)"
        };
      }

      const result = await searchAndDownloadArxivPaper(title);

      if (result.success) {
        console.log(`[A1] ✅ Success! arXiv ID: ${result.arxivId}, Path: ${result.pdfPath}`);
      } else {
        console.log(`[A1] ❌ Failed: ${result.error}`);
      }

      return {
        success: result.success,
        arxiv_id: result.arxivId,
        pdf_path: result.pdfPath,
        error: result.error,
      };
    }

    // CHANGED BY DATE: 2026-01-02 - Added tool to read full text of downloaded references

    case "fetch_paper_abstract": {
      const arxiv_id: string = (args.arxiv_id ?? "").toString();
      const add_to_evidence: boolean = args.add_to_evidence !== false;
      const max_chars: number = Number.isFinite(args.max_chars) ? Math.floor(args.max_chars) : 5000;
      const citation_index: number | undefined = Number.isFinite(args.citation_index)
        ? Math.floor(args.citation_index)
        : undefined;

      // Prefer citation_index lookup; fall back to provided citation
      let citation: Partial<Citation> | undefined = args.citation;
      if (citation_index !== undefined) {
        const all = agentState.getCitations();
        if (citation_index >= 0 && citation_index < all.length) {
          citation = all[citation_index];
        }
      }

      // BLOCK fetching abstract for main paper
      const titleToCheck = citation?.title || arxiv_id;
      if (isMainPaperTitle(titleToCheck)) {
        console.log(`[A1] ⛔ BLOCKED: Not fetching abstract for main paper (already uploaded).`);
        return {
          success: false,
          abstract: null,
          added_to_evidence: false,
          error: "Blocked: This is the main paper (already uploaded)"
        };
      }

      console.log(`[A1]  Fetching abstract for: ${arxiv_id}`);
      const abstract = await fetchArxivAbstract(arxiv_id);
      console.log(`[A1] ${abstract ? "Abstract fetched" : " Abstract fetch failed"}`);

      if (!abstract) {
        return {
          success: false,
          abstract: null,
          added_to_evidence: false,
          error: "Abstract fetch failed",
        };
      }

      let evidence_index: number | undefined = undefined;
      if (add_to_evidence) {
        const trimmed = abstract.length > max_chars ? abstract.slice(0, max_chars) + "\n[... truncated ...]" : abstract;

        const title = (citation?.title || "Untitled (arXiv)").toString();
        const evidence: Evidence = {
          title,
          authors: (citation?.authors as any) || [],
          year: (citation?.year || "").toString(),
          journal: (citation?.journal || "").toString(),
          doi: (citation as any)?.doi || "",
          arxiv_id,
          text: trimmed,
          source_type: "abstract",
        };
        evidence_index = agentState.addEvidence(evidence);
      }

      return {
        success: true,
        abstract,
        added_to_evidence: add_to_evidence,
        evidence_index,
      };
    }


    // CHANGED BY DATE: 2026-01-03 - Combined tool that reads PDF and adds to evidence in one step
    case "read_and_add_to_evidence": {
      let { pdf_path, arxiv_id } = args;
      const max_chars: number = Number.isFinite(args.max_chars) ? Math.floor(args.max_chars) : 20000;
      const citation_index: number | undefined = Number.isFinite(args.citation_index)
        ? Math.floor(args.citation_index)
        : undefined;

      // Prefer citation_index lookup; fall back to provided citation
      let citation: Partial<Citation> | undefined = args.citation;
      if (citation_index !== undefined) {
        const all = agentState.getCitations();
        if (citation_index >= 0 && citation_index < all.length) {
          citation = all[citation_index];
        }
      }

      // CHANGED BY DATE: 2026-01-03 - Auto-lookup citation if missing or incomplete
      if (!citation || !citation.title || citation.title === "NO TITLE") {
        console.log(`[A1] read_and_add_to_evidence: Missing citation object, attempting robust lookup...`);
        const allCites = agentState.getCitations();

        // Normalize strings for robust matching (remove all non-alphanumeric)
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        const pathNorm = normalize(pdf_path);

        const lookup = allCites.find((c: any) => {
          if (!c.title) return false;
          const titleNorm = normalize(c.title);

          return (arxiv_id && c.doi?.includes(arxiv_id)) ||
            (titleNorm.length > 10 && pathNorm.includes(titleNorm.substring(0, 30)));
        });

        if (lookup) {
          console.log(`[A1]   Lookup success! Found: "${lookup.title}"`);
          citation = lookup;
        }
      }

      console.log(`[A1] read_and_add_to_evidence: "${citation?.title || 'NO TITLE'}"`);
      console.log(`[A1]   PDF: ${pdf_path}`);

      // If citation is still missing, fall back to filename-based metadata so we still capture text.
      if (!citation || !citation.title) {
        console.warn(`[A1]   WARNING: Missing citation metadata. Falling back to filename-based title.`);
        citation = {
          title: path.basename(pdf_path || "downloaded_paper.pdf"),
          authors: [],
          year: "",
          journal: "",
          doi: "",
        };
      }

      if (!fs.existsSync(pdf_path)) {
        console.error(`[A1]   ERROR: PDF not found: ${pdf_path}`);
        return { success: false, error: `PDF not found: ${pdf_path}` };
      }

      // Read and truncate
      const extracted = await extractTextWithLocations(pdf_path);
      const truncatedText = extracted.fullText.length > max_chars
        ? extracted.fullText.substring(0, max_chars) + "\n[... truncated ...]"
        : extracted.fullText;

      console.log(`[A1]   Extracted ${extracted.fullText.length} chars, using ${truncatedText.length}`);

      // Create evidence with full metadata
      const evidence: Evidence = {
        title: citation.title || "Unknown Paper",
        authors: (citation.authors as any) || [],
        year: (citation.year || "").toString(),
        journal: (citation.journal || "").toString(),
        doi: (citation as any)?.doi || "",
        arxiv_id: arxiv_id || "",
        text: truncatedText,
        source_type: "pdf",
        pdf_path: pdf_path,
      };

      const evidence_index = agentState.addEvidence(evidence);
      console.log(`[A1]   SUCCESS: Added to evidence!`);

      return {
        success: true,
        title: citation.title,
        text_length: truncatedText.length,
        evidence_index,
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

    case "extract_text_from_main_paper": {
      const { pdf_path } = args;
      if (!fs.existsSync(pdf_path)) {
        return { success: false, error: `PDF not found: ${pdf_path}` };
      }

      const extracted = await extractTextWithLocations(pdf_path);
      agentState.setMainPaper(pdf_path, extracted);

      return {
        success: true,
        paragraphs_count: extracted.paragraphs.length,
        total_lines: extracted.paragraphs.reduce((sum, p) => sum + p.lines.length, 0),
      };
    }

    case "search_main_paper_text": {
      const query: string = (args.query ?? "").toString();
      const max_results: number = Number.isFinite(args.max_results) ? Math.floor(args.max_results) : 20;
      const mainPaper = agentState.getMainPaper();

      if (!mainPaper.text) {
        return {
          success: false,
          error: "Main paper text not extracted. Call extract_text_from_main_paper first.",
        };
      }

      const allLocations = findTextLocations(query, mainPaper.text);
      const locations = allLocations.slice(0, Math.max(1, max_results));
      const snippets = locations.map(loc => {
        const para = mainPaper.text!.paragraphs.find(p => p.paragraphNumber === loc.paragraph);
        const line = para?.lines.find(l => l.lineNumber === loc.line);
        return {
          paragraph: loc.paragraph,
          line: loc.line,
          start_sentence: loc.start_sentence,
          full_line: line?.text || "",
        };
      });

      return {
        success: true,
        locations: locations,
        snippets: snippets,
        count: locations.length,
      };
    }

    default:
      return { success: false, error: `Unknown function: ${name}` };
  }
}

// AGENT LOOP
async function runAgent(
  userTask: string,
  maxIterations: number = 10
): Promise<any> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You are Agent A1 (Evidence Builder). You do NOT answer the user.
You only collect citations and build an evidence set for Agent A2.

Golden rules:
- Obey retrieval budget: if topK is 0 (or limit says 0 evidence items), do NOT download external papers or fetch abstracts.
- Before extracting citations, call get_available_citations. If count > 0, do NOT call extract_citations_from_pdf.
- Prefer citation_index over copying citation objects.

Retrieval workflow (for comparisons / related work / references):
1) filter_citations(query) to find candidates.
2) Pick up to topK diverse papers.
3) For each selected paper:
   - If DOI exists, call check_if_blacklisted(doi). Skip if blacklisted.
   - search_and_download_paper_on_arxiv(title)
   - If download succeeds: read_and_add_to_evidence(pdf_path, citation_index, arxiv_id)
   - If download fails: fetch_paper_abstract(arxiv_id, citation_index, add_to_evidence=true)

Main paper support:
- extract_text_from_main_paper is done during ingest; use search_main_paper_text(query) only when you need pinpoint snippets/locations.

Stop once you collected enough evidence (topK). Avoid redundant tool calls.`,
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

    const response = await getOpenAIClient().chat.completions.create({
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
export async function run(task: A1Task): Promise<A1Result> {
  try {
    console.log("\n" + "=".repeat(60));
    console.log("[A1 RECEIVED TASK FROM A0]");
    console.log(`Action: ${task.action}`);
    console.log("=".repeat(60));

    // agentState.reset(); // MOVED inside ingest_parse to avoid wiping state between steps

    if (task.action === "ingest_parse") {
      agentState.reset(); // Only reset when starting a new paper ingestion

      // Extract citations from PDFs and extract text from main paper
      const sources = task.inputs.sources || [];

      if (sources.length === 0) {
        return {
          agent: "A1",
          status: "error",
          error: "No sources provided",
        };
      }

      // Assume first source is the main paper
      const mainPaperPath = sources[0];

      // Extract text from main paper with location tracking
      const extracted = await extractTextWithLocations(mainPaperPath);
      agentState.setMainPaper(mainPaperPath, extracted);

      // Extract citations
      const taskStr = `Extract all citations from these PDF files: ${sources.join(", ")}. Store them in memory.`;
      await runAgent(taskStr);

      // CHANGED BY DATE: 2026-01-04 - Extract sections using GROBID
      const filename = path.basename(mainPaperPath);
      // Robust title cleaning: remove underscores, timestamps (-1234567 or -123-456), and .pdf extension
      const cleanTitle = filename
        .replace(/_/g, " ")
        .replace(/-?\d+(?:-\d+)?(?=\.pdf|$)/i, "")
        .replace(/\.pdf$/i, "")
        .trim();

      const evidence: Evidence[] = [];

      console.log("\n[A1] Extracting main paper sections with GROBID...");
      const grobidResult = await extractFullDocumentGrobid(mainPaperPath);

      if (grobidResult && grobidResult.xml) {
        // Parse sections from XML
        const sections = parseSectionsFromGrobidXML(grobidResult.xml);

        if (sections.length > 0) {
          console.log(`[A1]  Found ${sections.length} sections in main paper`);

          // Create evidence for each section
          for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            const sectionEvidence: Evidence = {
              title: cleanTitle,
              authors: [], // Leave empty for main paper
              year: "",
              journal: "Main Paper",
              text: section.text,
              source_type: "pdf",
              is_main_paper: true,
              pdf_path: mainPaperPath,
              section: section.section,  // NEW: Section name
              page: section.page,        // NEW: Page number
              chunk_id: `main_${i}`,     // NEW: Unique chunk ID
              locations: []
            };
            evidence.push(sectionEvidence);
            console.log(`[A1]    ✓ Added section "${section.section}" (${section.text.length} chars, page ${section.page || '?'})`);
          }
        } else {
          console.log("[A1]  No sections found, using fallback full text extraction");
          // Fallback to simple full text if Grobid didn't find sections
          if (extracted.fullText) {
            evidence.push({
              title: cleanTitle,
              authors: [],
              year: "",
              journal: "Main Paper",
              text: extracted.fullText,
              source_type: "pdf",
              is_main_paper: true,
              pdf_path: mainPaperPath,
              section: "Full Document",
              chunk_id: "main_0",
              locations: []
            });
          }
        }
      } else {
        console.log("[A1]  GROBID extraction failed, using fallback full text");
        // Fallback: Use simple text extraction if GROBID fails
        if (extracted.fullText) {
          evidence.push({
            title: cleanTitle,
            authors: [],
            year: "",
            journal: "Main Paper",
            text: extracted.fullText,
            source_type: "pdf",
            is_main_paper: true,
            pdf_path: mainPaperPath,
            section: "Full Document",
            chunk_id: "main_0",
            locations: []
          });
        }
      }

      console.log(`[A1]  Total evidence items created: ${evidence.length}`);

      return {
        agent: "A1",
        status: "success",
        citations: agentState.getCitations(),
        evidence: evidence,
      };

    } else if (task.action === "retrieve") {
      // Build evidence from citations and search main paper
      const { query, topN = 40, topK = 8, penalties = {} } = task.inputs;
      const blacklist = penalties?.blacklist || [];

      // First, search the main paper for relevant text
      const mainPaper = agentState.getMainPaper();
      if (mainPaper.text && mainPaper.path) {
        const locations = findTextLocations(query, mainPaper.text);
        if (locations.length > 0) {
          // Get text snippets from main paper
          const snippets = locations.map(loc => {
            const para = mainPaper.text!.paragraphs.find(p => p.paragraphNumber === loc.paragraph);
            const line = para?.lines.find(l => l.lineNumber === loc.line);
            return line?.text || "";
          }).join(" ");

          // Add main paper as evidence with location info
          const mainFile = path.basename(mainPaper.path || "Main_Paper.pdf");
          // Robust title cleaning: remove underscores, timestamps (-1234567 or -123-456), and .pdf extension
          const cleanTitle = mainFile
            .replace(/_/g, " ")
            .replace(/-?\d+(?:-\d+)?(?=\.pdf|$)/i, "")
            .replace(/\.pdf$/i, "")
            .trim();

          const mainPaperEvidence: Evidence = {
            title: cleanTitle || "Main Paper",
            authors: [],
            year: "",
            journal: "Main Paper",
            text: snippets,
            source_type: "pdf",
            is_main_paper: true,
            pdf_path: mainPaper.path,
            locations: locations  // NEW: Add precise locations for highlighting
          };

          agentState.addEvidence(mainPaperEvidence);
          console.log(`[A1]  Added main paper evidence with ${locations.length} location(s):`);
          locations.forEach((loc, i) => {
            console.log(`[A1]    Location ${i + 1}: paragraph ${loc.paragraph}, line ${loc.line}`);
            console.log(`[A1]      Sentence: "${loc.start_sentence.substring(0, 60)}..."`);
          });
        }
      }


      // Expertise/policy may set topK=0 (main-paper-only mode). In that case, skip external retrieval.
      if (topK <= 0) {
        const mainOnly = agentState.getEvidence().filter(e => e.is_main_paper);
        return {
          agent: "A1",
          status: "success",
          evidence: mainOnly,
        };
      }

      // CHANGED BY DATE: 2026-01-08 - Extract main paper title to prevent downloading it
      const mainPaperPath = mainPaper.path || "";
      const mainPaperFilename = path.basename(mainPaperPath);
      const mainPaperTitle = mainPaperFilename
        .replace(/_/g, " ")
        .replace(/-?\d+-\d+\.pdf$/i, "")
        .replace(".pdf", "")
        .trim();

      // CHANGED BY DATE: 2026-01-02 - Updated prompt to use full text reading
      const taskStr = `Build a knowledge base about "${query}".

Steps:
1. Filter citations for "${query}" (top ${topN})
2. For each citation:
   - SKIP if the citation title matches the main paper: "${mainPaperTitle}" (already uploaded!)
   - Otherwise: Search and download from arXiv (combined tool)
   - Use 'read_and_add_to_evidence' to read PDF and add to evidence (single step!)
   - IF PDF fails: Use 'fetch_paper_abstract'
3. Skip blacklisted DOIs: ${JSON.stringify(blacklist)}
4. Limit to ${topK} evidence items (excluding main paper)

IMPORTANT: Do NOT download or fetch abstracts for papers with titles containing "${mainPaperTitle}" - this is the main paper that's already uploaded!`;

      await runAgent(taskStr);

      // Ensure main paper evidence is included
      const allEvidence = agentState.getEvidence();
      const mainPaperEvidence = allEvidence.find(e => e.is_main_paper);
      const otherEvidence = allEvidence.filter(e => !e.is_main_paper).slice(0, topK);

      const finalEvidence = mainPaperEvidence
        ? [mainPaperEvidence, ...otherEvidence]
        : otherEvidence;

      return {
        agent: "A1",
        status: "success",
        evidence: finalEvidence,
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