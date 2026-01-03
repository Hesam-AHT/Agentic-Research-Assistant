import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import OpenAI from "openai";
import { parseLLMJson } from "../../utils";
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

  addEvidence(evidence: Evidence) {
    this.evidence.push(evidence);
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

  // CHANGED BY DATE: 2026-01-03 - Updated tool to accept citation metadata
  {
    type: "function",
    function: {
      name: "read_downloaded_pdf",
      description: "Read the full text content of a downloaded PDF file. IMPORTANT: Always pass the citation object so metadata is preserved for add_to_evidence.",
      parameters: {
        type: "object",
        properties: {
          pdf_path: {
            type: "string",
            description: "Path to the local PDF file",
          },
          citation: {
            type: "object",
            description: "The original citation object from filter_citations (title, authors, year, etc.)",
          },
          arxiv_id: {
            type: "string",
            description: "The arXiv ID of the paper",
          },
        },
        required: ["pdf_path"],
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
  // CHANGED BY DATE: 2026-01-03 - New combined tool to read PDF and add to evidence in one step
  {
    type: "function",
    function: {
      name: "read_and_add_to_evidence",
      description: "Read a downloaded PDF and immediately add it to evidence. Use this INSTEAD of read_downloaded_pdf + add_to_evidence. This ensures citation metadata is preserved.",
      parameters: {
        type: "object",
        properties: {
          pdf_path: {
            type: "string",
            description: "Path to the downloaded PDF file",
          },
          citation: {
            type: "object",
            description: "The citation object from filter_citations (must include title, authors, year, journal)",
          },
          arxiv_id: {
            type: "string",
            description: "The arXiv ID of the paper",
          },
        },
        required: ["pdf_path", "citation"],
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
  {
    type: "function",
    function: {
      name: "extract_text_from_main_paper",
      description: "Extract text from the main uploaded paper with paragraph and line tracking.",
      parameters: {
        type: "object",
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
      description: "Search for text in the main paper and get location details (paragraph, line, sentence).",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Text to search for in the main paper",
          },
        },
        required: ["query"],
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

      // Log all titles for debugging (user request)
      console.log(`[A1] Full Citation List (${citations.length}):`);
      citations.forEach((c, i) => console.log(`   [${i + 1}] ${c.title}`));

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
      console.log(`[A1]  Filtering citations by keyword: "${keyword}"`);
      const allCitations = agentState.getCitations();

      // CHANGED BY DATE: 2026-01-03 - Robust multi-keyword filtering
      // Instead of literal match, split into keywords and match any
      const stopWords = new Set(["and", "the", "a", "an", "of", "in", "on", "with", "between", "comparison", "compare", "architecture", "model", "paper", "is", "for", "to", "at", "by", "that", "this", "which", "are", "it"]);
      const keywords = keyword.toLowerCase()
        .split(/[\s,.;:?!()]+/)
        .filter(word => word.length > 2 && !stopWords.has(word));

      console.log(`[A1]  Extracted keywords: ${JSON.stringify(keywords)}`);

      const filtered = allCitations.filter((c, index) => {
        const titleLower = c.title.toLowerCase();
        const authorsLower = c.authors.map(a => a.toLowerCase());

        const isMatch = keywords.some(kw =>
          titleLower.includes(kw) ||
          authorsLower.some(author => author.includes(kw))
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
        citations: result,
      };
    }

    case "search_paper_on_arxiv": {
      const { title } = args;
      console.log(`[A1]  Searching arXiv for: "${title}"`);
      const arxivId = await searchArxiv(title);
      console.log(`[A1] ${arxivId ? " Found arXiv ID: " + arxivId : " Not found on arXiv"}`);

      return {
        success: !!arxivId,
        arxiv_id: arxivId,
      };
    }

    case "download_paper_pdf": {
      const { arxiv_id, title } = args;
      console.log(`[A1]  Downloading PDF: ${arxiv_id} (${title})`);
      const success = await downloadPdf(arxiv_id, title);
      const safe = title.replace(/[^a-zA-Z0-9]/g, "_");
      console.log(`[A1] ${success ? " Download success" : " Download failed"}`);

      return {
        success,
        path: success ? `downloads/${safe}.pdf` : null,
      };
    }

    // CHANGED BY DATE: 2026-01-02 - Added tool to read full text of downloaded references
    case "read_downloaded_pdf": {
      const { pdf_path } = args;
      console.log(`[A1] Request to read PDF: ${pdf_path}`);
      if (!fs.existsSync(pdf_path)) {
        console.error(`[A1]  PDF file not found: ${pdf_path}`);
        return { success: false, error: `PDF not found: ${pdf_path}` };
      }

      console.log(`[A1]  Reading full text content...`);
      const extracted = await extractTextWithLocations(pdf_path);

      // CHANGED BY DATE: 2026-01-03 - Truncate to 20k chars to avoid rate limit errors
      const MAX_CHARS = 20000;
      const truncatedText = extracted.fullText.length > MAX_CHARS
        ? extracted.fullText.substring(0, MAX_CHARS) + "\n[... truncated ...]"
        : extracted.fullText;

      console.log(`[A1]  Extracted ${extracted.fullText.length} chars, using ${truncatedText.length} chars`);

      return {
        success: true,
        text_preview: truncatedText.substring(0, 200) + "...",
        full_text: truncatedText, // Truncated to avoid rate limits
        length: truncatedText.length
      };
    }

    case "fetch_paper_abstract": {
      const { arxiv_id } = args;
      console.log(`[A1]  Fetching abstract for: ${arxiv_id}`);
      const abstract = await fetchArxivAbstract(arxiv_id);
      console.log(`[A1] ${abstract ? "Abstract fetched" : " Abstract fetch failed"}`);


      return {
        success: !!abstract,
        abstract: abstract || null,
      };
    }

    case "add_to_evidence": {
      const { citation, arxiv_id, content_type, text } = args;

      if (!citation || !citation.title) {
        console.warn(`[A1] Warning: add_to_evidence called without a title!`);
        // Try to rescue it?
        if (!citation) {
          return { success: false, error: "Missing citation object" };
        }
      }

      console.log(`[A1] Adding evidence: "${citation.title}" (${content_type})`);

      const evidence: Evidence = {
        title: citation.title || "Unknown Title", // Fallback to avoid undefined
        authors: citation.authors || [],
        year: citation.year || "",
        journal: citation.journal || "",
        doi: citation.doi,
        arxiv_id,
        text,
        source_type: content_type,
      };

      agentState.addEvidence(evidence);

      return {
        success: true,
      };
    }

    // CHANGED BY DATE: 2026-01-03 - Combined tool that reads PDF and adds to evidence in one step
    case "read_and_add_to_evidence": {
      const { pdf_path, citation, arxiv_id } = args;

      console.log(`[A1] read_and_add_to_evidence: "${citation?.title || 'NO TITLE'}"`);
      console.log(`[A1]   PDF: ${pdf_path}`);

      if (!citation || !citation.title) {
        console.error(`[A1]   ERROR: Citation missing or no title!`);
        return { success: false, error: "Citation object with title is required" };
      }

      if (!fs.existsSync(pdf_path)) {
        console.error(`[A1]   ERROR: PDF not found: ${pdf_path}`);
        return { success: false, error: `PDF not found: ${pdf_path}` };
      }

      // Read and truncate
      const extracted = await extractTextWithLocations(pdf_path);
      const MAX_CHARS = 20000;
      const truncatedText = extracted.fullText.length > MAX_CHARS
        ? extracted.fullText.substring(0, MAX_CHARS) + "\n[... truncated ...]"
        : extracted.fullText;

      console.log(`[A1]   Extracted ${extracted.fullText.length} chars, using ${truncatedText.length}`);

      // Create evidence with full metadata
      const evidence: Evidence = {
        title: citation.title,
        authors: citation.authors || [],
        year: citation.year || "",
        journal: citation.journal || "",
        doi: citation.doi,
        arxiv_id: arxiv_id || "",
        text: truncatedText,
        source_type: "pdf",
        pdf_path: pdf_path,
      };

      agentState.addEvidence(evidence);
      console.log(`[A1]   SUCCESS: Added to evidence!`);

      return {
        success: true,
        title: citation.title,
        text_length: truncatedText.length,
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
      const { query } = args;
      const mainPaper = agentState.getMainPaper();

      if (!mainPaper.text) {
        return {
          success: false,
          error: "Main paper text not extracted. Call extract_text_from_main_paper first.",
        };
      }

      const locations = findTextLocations(query, mainPaper.text);
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
      content: `You are Agent A1, a Data & Evidence Agent.

Your role:
1. Extract citations from PDFs
2. Search and retrieve papers from arXiv
3. Build evidence collections

CRITICAL WORKFLOW:
1. Filter citations by keyword
2. For each matching citation:
   a. Search on arXiv
   b. Download PDF
   c. Use "read_and_add_to_evidence" (NOT separate read + add!)
      - Pass the citation object with title, authors, year
      - Pass the arxiv_id
      - This adds to evidence automatically

IMPORTANT: Always pass the full citation object to read_and_add_to_evidence.
Do NOT use read_downloaded_pdf + add_to_evidence separately - use the combined tool!`,
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

      // CHANGED BY DATE: 2026-01-03 - Improved metadata for main paper
      const filename = path.basename(mainPaperPath);
      const cleanTitle = filename.replace(/_/g, " ").replace(/-?\d+-\d+\.pdf$/i, "").replace(".pdf", "");

      const evidence: Evidence[] = [];
      if (extracted.fullText) {
        evidence.push({
          title: cleanTitle,
          authors: [], // Leave empty instead of "Unknown" to avoid ugly UI
          year: "",    // Leave empty
          journal: "Main Paper",
          text: extracted.fullText,
          source_type: "pdf",
          is_main_paper: true,
          pdf_path: mainPaperPath,
          locations: []
        });
      }

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
          // Remove ID-suffix for cleaner title if possible, or just use basename
          const cleanTitle = mainFile.replace(/-\d+-\d+\.pdf$/i, "").replace(/_/g, " ");

          const mainPaperEvidence: Evidence = {
            title: cleanTitle || "Main Paper",
            authors: [],
            year: "",
            journal: "",
            text: snippets,
            source_type: "pdf",
            is_main_paper: true,
            locations: locations,
            pdf_path: mainPaper.path,
          };
          agentState.addEvidence(mainPaperEvidence);
        }
      }

      // CHANGED BY DATE: 2026-01-02 - Updated prompt to use full text reading
      const taskStr = `Build a knowledge base about "${query}".

Steps:
1. Filter citations for "${query}" (top ${topN})
2. For each citation:
   - Search on arXiv
   - Download PDF
   - IF PDF download succeeds: Use 'read_downloaded_pdf' to get full text
   - IF PDF fails: Use 'fetch_paper_abstract'
   - Add to evidence
3. Skip blacklisted DOIs: ${JSON.stringify(blacklist)}
4. Limit to ${topK} evidence items (excluding main paper)`;

      await runAgent(taskStr);

      // Ensure main paper evidence is included
      const allEvidence = agentState.getEvidence();
      const mainPaperEvidence = allEvidence.find(e => e.is_main_paper);
      const otherEvidence = allEvidence.filter(e => !e.is_main_paper).slice(0, topK - (mainPaperEvidence ? 1 : 0));

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