import fs from "fs";
import OpenAI from "openai";
import axios from "axios";
import path from "path";
import dotenv from "dotenv";
import { parseSectionsFromGrobidXML } from "./sections-parser.js";
import { extractCitationMarkersFromSection, mapCitationIdsToIndices } from "./citation-extractor.js";
import { processReferencePaper } from "./reference-processor.js";
import { GlobalMemory } from "../../memory/GlobalMemory.js";
import { findMatchingSection, findCitationsForKeywords } from "./citation-helpers.js";
dotenv.config();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


// Enhanced Evidence with section/chunk metadata for frontend highlighting
export interface Evidence extends Citation {
  text: string;
  arxiv_id?: string;
  source_type: "pdf" | "abstract" | "metadata_only";

  // Metadata for frontend highlighting and navigation
  section?: string;        // Section name (e.g., "Abstract", "Introduction", "Methods")
  page?: number;          // Page number in PDF
  chunk_id?: string;      // Unique chunk identifier
  start_char?: number;    // Character position in source document
  end_char?: number;      // End character position
  is_main_paper?: boolean; // true if from uploaded paper, false if from references
}

export interface Citation {
  title: string;
  authors: string[];
  year: string;
  journal: string;
  doi?: string;  // Make optional
}

export type A1Task =
  | { agent: "A1"; action: "ingest_parse"; inputs: { sources: any[] } }
  | {
    agent: "A1";
    action: "retrieve";
    inputs: {
      query: string;
      topN: number;
      topK: number;
      filters?: any;
      penalties?: any;
      // A0 Brain decisions (simplified to section OR keyword)
      filtering_strategy?: "section" | "keyword";
      keywords?: string[];
      focus_sections?: string[];
      skipReferences?: boolean;
      task_type?: "qa" | "summarize" | "compare" | "explain";
      complexity?: "simple" | "moderate" | "complex";
      sources?: string[];
    };
  };

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
  public grobidXmlCache: string | null = null;

  // A0 Brain decisions (simplified to section OR keyword, default keyword)
  public filteringStrategy: "section" | "keyword" = "keyword";
  public keywords: string[] = [];
  public focusSections: string[] = [];

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

  getActualSectionNames(): string[] {
    if (!this.grobidXmlCache) return [];

    try {
      const sectionMatches = this.grobidXmlCache.match(/<head[^>]*>([^<]+)</g) || [];
      const sections = sectionMatches.map(match => {
        const nameMatch = match.match(/<head[^>]*>([^<]+)/);
        return nameMatch ? nameMatch[1].trim() : '';
      }).filter(s => s.length > 0 && s.length < 100);

      return [...new Set(sections)];
    } catch (error) {
      console.error('[A1] Error extracting section names:', error);
      return [];
    }
  }
}

const agentState = new AgentState();

// TOOL IMPLEMENTATIONS
async function extractReferencesGrobid(pdfPath: string): Promise<string[]> {
  const grobidUrl = process.env.GROBID_URL || "http://localhost:8070";

  console.log(`[A1]  GROBID: Extracting references from ${path.basename(pdfPath)}`);
  console.log(`[A1]  GROBID URL: ${grobidUrl}/api/processReferences`);

  // CACHING: Check if we already processed this PDF
  const pdfBasename = path.basename(pdfPath, '.pdf');
  const cacheDir = "grobid-output";
  const cacheFile = path.join(cacheDir, `${pdfBasename}.xml`);

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // Use cached XML if exists
  if (fs.existsSync(cacheFile)) {
    console.log(`[A1]  GROBID: Using cached XML from ${cacheFile}`);
    const xmlText = fs.readFileSync(cacheFile, 'utf-8');
    const bibs = xmlText.match(/<biblStruct(.+?)<\/biblStruct>/gs) || [];
    console.log(`[A1]  GROBID: Found ${bibs.length} biblStruct elements (cached)`);
    return bibs.map((b: string) => `<biblStruct${b.slice(11)}`);
  }

  try {
    const fileBuffer = fs.readFileSync(pdfPath);
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: "application/pdf" });
    formData.append("input", blob, path.basename(pdfPath));

    // REMOVED: consolidateCitations=1 - This queries external APIs (CrossRef) making it 10x slower!
    // We don't need enriched citations, just the bibliography structure

    const startTime = Date.now();
    const response = await axios.post(
      `${grobidUrl}/api/processReferences`,
      formData
    );
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    const xmlText = response.data;
    console.log(`[A1]  GROBID: Received ${xmlText.length} chars of XML in ${elapsed}s`);

    // CACHE: Save XML to file for future use
    fs.writeFileSync(cacheFile, xmlText);
    console.log(`[A1]  GROBID: Cached XML to ${cacheFile}`);

    const bibs = xmlText.match(/<biblStruct(.+?)<\/biblStruct>/gs) || [];
    console.log(`[A1]  GROBID: Found ${bibs.length} biblStruct elements`);

    return bibs.map((b: string) => `<biblStruct${b.slice(11)}`);
  } catch (error) {
    console.error("[A1]  GROBID extraction failed:", error);
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

    // CRITICAL FIX: Cache XML in memory for citation mapping during retrieve
    agentState.grobidXmlCache = xmlText;
    console.log(`[A1]  Cached GROBID XML in agentState (${xmlText.length} chars)`);

    return { xml: xmlText, cached: false };
  } catch (error) {
    console.error("[A1]  GROBID full document extraction failed:", error);
    return null;
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
      model: "gpt-4o-mini", // Use mini for cost saving and rate limit avoidance
      messages: [{ role: "user", content: msg }],
      temperature: 0,
    });

    let content = response.choices[0].message.content || "[]";

    // Strip markdown code blocks if present
    content = content.replace(/^```json\s*/gm, '').replace(/^```\s*/gm, '').trim();

    return JSON.parse(content);
  } catch (error) {
    console.error("\n[LLM BAD JSON OUTPUT]", error);
    return [];
  }
}

/**
 * Extract PDF text content - simplified version
 * Using basic text extraction since pdf-parse has module issues
 */
async function extractPdfText(pdfPath: string): Promise<string> {
  console.log(`[A1]  Extracting text from PDF: ${path.basename(pdfPath)}`);

  try {
    // Import pdf-parse dynamically (with type assertion to handle ESM/CJS mismatch)
    const pdfParseModule = await import('pdf-parse');
    const pdfParse: any = pdfParseModule.default || pdfParseModule;
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdfParse(dataBuffer);

    const text = data.text;
    console.log(`[A1]  Extracted ${text.length} characters, ${data.numpages} pages`);

    // Return first 8000 chars to avoid token limits
    const truncated = text.substring(0, 8000);
    if (text.length > 8000) {
      console.log(`[A1]   Truncated to 8000 chars to fit context window`);
    }

    return truncated;
  } catch (error) {
    console.error(`[A1]  Failed to extract PDF text:`, error);
    // Fallback: return basic info
    return `PDF: ${path.basename(pdfPath)}. Full text extraction failed.`;
  }
}

/**
 * Extract PDF content using OpenAI - Simplified version
 * Note: File upload requires special API permissions, so we use a simpler approach
 * In production, consider using pdf-parse library or similar for better extraction
 */
async function extractPdfContentWithOpenAI(pdfPath: string): Promise<string> {
  console.log(`[A1]  Processing PDF: ${path.basename(pdfPath)}`);

  try {
    // For now, use a placeholder since file upload requires special permissions
    // In a real implementation, you'd use pdf-parse or similar library
    const placeholder = `This is a placeholder for PDF content extraction.
The paper appears to be about semantic segmentation in computer vision.
Key topics likely include: deep learning, neural networks, image segmentation methods.
    
For full PDF parsing, consider implementing:
1. pdf-parse library for text extraction
2. GROBID for structured extraction
3. OCR for scanned documents

Title: ${path.basename(pdfPath, '.pdf')}`;

    console.log(`[A1]  Generated placeholder content (${placeholder.length} chars)`);
    return placeholder;
  } catch (error) {
    console.error(`[A1]  Failed to extract PDF:`, error);
    return `Failed to extract PDF content: ${error}`;
  }
}

/**
 * Fast keyword-based citation filtering
 * Ranks citations by topical overlap with the query keywords
 */
async function smartFilterCitations(
  citations: Citation[],
  query: string,
  maxResults: number = 8
): Promise<Citation[]> {
  if (citations.length === 0) return [];

  console.log(`[A1]  Fast filtering ${citations.length} citations for query: "${query}"`);

  // SMART keyword extraction
  // 1. Extract capitalized terms (likely paper/method names): SegNet, DeepLab, U-Net
  // 2. Then extract other meaningful words
  const capitalizedTerms = query.match(/\b[A-Z][a-zA-Z0-9]*(?:[-_][A-Z][a-zA-Z0-9]*)*\b/g) || [];

  // Extract general keywords (lowercase, filter short words)
  const queryWords = query.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 3 && !['what', 'with', 'from', 'that', 'this', 'which', 'where', 'when', 'they', 'there', 'their'].includes(word));

  // Combine: prioritize capitalized terms
  const allKeywords = [...capitalizedTerms.map(t => t.toLowerCase()), ...queryWords];
  const uniqueKeywords = Array.from(new Set(allKeywords));

  console.log(`[A1]  Keywords extracted: [${uniqueKeywords.join(', ')}]`);

  // Score each citation based on keyword density in title and journal
  const scoredCitations = citations.map(cit => {
    let score = 0;
    const titleLower = cit.title.toLowerCase();
    const authorsLower = cit.authors.map(a => a.toLowerCase()).join(" ");

    for (const word of uniqueKeywords) {
      if (titleLower.includes(word)) score += 10;
      if (authorsLower.includes(word)) score += 2;
      if (cit.journal?.toLowerCase().includes(word)) score += 1;
    }

    // Slight boost for newer papers
    const yearNum = parseInt(cit.year);
    if (!isNaN(yearNum)) {
      score += (yearNum - 2000) * 0.1;
    }

    return { citation: cit, score };
  });

  // Sort by score and take top N
  const filtered = scoredCitations
    .sort((a, b) => b.score - a.score)
    .filter(item => {
      // STRICT MODE: Only return citations with strong matches
      // For exact title match: score >= 10
      // For partial word match: at least score >= 5
      const minScore = queryWords.length > 0 ? 5 : 0;
      return item.score >= minScore;
    })
    .slice(0, maxResults)
    .map(item => item.citation);

  console.log(`[A1]  Fast filter selected ${filtered.length} citations`);

  // DEBUG: Show top matches with scores
  scoredCitations.sort((a, b) => b.score - a.score).slice(0, 5).forEach((item, i) => {
    console.log(`[A1]   ${i + 1}. "${item.citation.title.substring(0, 50)}..." (score: ${item.score})`);
  });

  return filtered;
}

async function searchArxiv(title: string): Promise<string | null> {
  try {
    // Try exact title search first
    const exactUrl = `https://export.arxiv.org/api/query?search_query=ti:"${encodeURIComponent(title)}"&max_results=1`;
    const exactResponse = await axios.get(exactUrl);
    const exactXml = exactResponse.data;

    let match = exactXml.match(/<id>https?:\/\/arxiv\.org\/abs\/(.+?)<\/id>/);
    if (match) {
      console.log(`[A1]  arXiv found (exact match): ${match[1]}`);
      return match[1];
    }

    // Fallback: try relaxed search with key terms (first 5 significant words)
    console.log(`[A1]  Exact title not found, trying relaxed search...`);
    const keyWords = title
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !['with', 'from', 'this', 'that', 'into', 'using', 'based'].includes(w.toLowerCase()))
      .slice(0, 5)
      .join(' ');

    if (keyWords.length > 10) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Brief delay
      const relaxedUrl = `https://export.arxiv.org/api/query?search_query=ti:${encodeURIComponent(keyWords)}&max_results=3`;
      const relaxedResponse = await axios.get(relaxedUrl);
      const relaxedXml = relaxedResponse.data;

      match = relaxedXml.match(/<id>https?:\/\/arxiv\.org\/abs\/(.+?)<\/id>/);
      if (match) {
        console.log(`[A1]  arXiv found (relaxed search): ${match[1]}`);
        return match[1];
      }
    }

    console.log(`[A1]  Paper not found on arXiv: "${title.slice(0, 50)}..."`);
    return null;
  } catch (error) {
    console.error("arXiv search failed:", error);
    return null;
  }
}

async function downloadPdf(arxivId: string, title: string): Promise<boolean> {
  const safe = title.replace(/[^a-zA-Z0-9]/g, "_") || "untitled";
  const outputPath = path.join("downloads", `${safe}.pdf`);

  // Check if already downloaded (cached)
  if (fs.existsSync(outputPath)) {
    console.log(`[A1]  Using cached PDF: "${title}"`);
    return true;
  }

  console.log(`[A1]  Downloading: "${title}" (arXiv:${arxivId})...`);

  try {
    const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
    const response = await axios.get(pdfUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
    });

    if (response.status !== 200) {
      console.error(`[A1]  Download failed for "${title}": HTTP status ${response.status}`);
      return false;
    }

    const downloadDir = "downloads";

    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, response.data);
    console.log(`[A1]  Downloaded: "${title}"`);
    return true;
  } catch (error) {
    console.error(`[A1]  Download failed for "${title}":`, error);
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
      description: "Filter extracted citations based on keywords. IMPORTANT: Only return papers that are DIRECTLY relevant. For comparison queries (e.g., 'compare with SegFix'), filter for THAT specific paper only.",
      parameters: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description: "Search term to filter citations (e.g., 'SegFix', 'GLNet')",
          },
          max_results: {
            type: "number",
            description: "Maximum number of results (default 2 for focused queries)",
            default: 8,
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
      description: "Search arXiv using the complete paper title from citations. Use full title, not abbreviations.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "The FULL paper title exactly as written in the citation. Include subtitles if present.",
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
      description: "Add a paper with its content to the evidence collection. IMPORTANT: You MUST pass the citation object with title, authors, year from the citations you retrieved.",
      parameters: {
        type: "object",
        properties: {
          citation: {
            type: "object",
            description: "Citation object containing title, authors, year, etc. Get this from the citations list.",
            properties: {
              title: { type: "string", description: "Paper title" },
              authors: { type: "array", items: { type: "string" }, description: "Author names" },
              year: { type: "string", description: "Publication year" },
              doi: { type: "string", description: "DOI if available" },
              journal: { type: "string", description: "Journal/conference name" }
            },
            required: ["title"]
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
            description: "Content text (abstract or PDF excerpt)",
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
      const { keyword: agentKeyword, max_results = 5 } = args;
      const allCitations = agentState.getCitations();

      // Use A0 Brain keywords, filtering out generic comparison words
      const genericWords = ['comparison', 'compare', 'difference', 'similar', 'explain', 'describe'];
      const a0Keywords = agentState.keywords.filter(k => !genericWords.includes(k.toLowerCase()));

      const keywords = a0Keywords.length > 0 ? a0Keywords : [agentKeyword];
      const combinedQuery = keywords.join(' ');

      console.log(`[A1]  Filtering citations`);
      console.log(`[A1]    Strategy: ${agentState.filteringStrategy}`);
      console.log(`[A1]    Keywords: ${keywords.join(', ')}`);
      console.log(`[A1]    Total citations: ${allCitations.length}`);

      let result: Citation[];

      // SIMPLIFIED: Only two modes - section OR keyword (default)
      if (agentState.filteringStrategy === "section" &&
        agentState.focusSections.length > 0 &&
        agentState.grobidXmlCache) {

        // SECTION-based filtering
        const targetSection = agentState.focusSections[0];
        console.log(`[A1]    Target section: "${targetSection}"`);

        // Find matching section name (fuzzy matching)
        const actualSections = agentState.getActualSectionNames();
        const matchedSection = findMatchingSection(targetSection, actualSections);

        if (matchedSection) {
          const citationIds = extractCitationMarkersFromSection(
            agentState.grobidXmlCache,
            matchedSection
          );

          if (citationIds.length > 0) {
            const indices = mapCitationIdsToIndices(citationIds, agentState.grobidXmlCache);
            result = indices
              .map(i => allCitations[i])
              .filter(c => c !== undefined)
              .slice(0, max_results);
            console.log(`[A1]  ✓ Section filter: ${result.length} citations from "${matchedSection}"`);
          } else {
            console.log(`[A1]    No citations in "${matchedSection}", falling back to keyword filter`);
            result = await smartFilterCitations(allCitations, combinedQuery, max_results);
          }
        } else {
          console.log(`[A1]    Section "${targetSection}" not found, falling back to keyword filter`);
          result = await smartFilterCitations(allCitations, combinedQuery, max_results);
        }
      } else {
        // KEYWORD-based filtering (DEFAULT)
        console.log(`[A1]    Using keyword filter (default)`);
        result = await smartFilterCitations(allCitations, combinedQuery, max_results);
      }

      console.log(`[A1]  ✓ Filtered: ${result.length} citations`);

      return {
        success: true,
        count: result.length,
        citations: result,
      };
    }

    case "search_paper_on_arxiv": {
      const { title } = args;

      // Rate limiting: wait 2 seconds to avoid arXiv blocking
      console.log("[A1]   Rate limit: waiting 500ms before arXiv search...");
      await new Promise(resolve => setTimeout(resolve, 500));

      const arxivId = await searchArxiv(title);

      return {
        success: !!arxivId,
        arxiv_id: arxivId,
      };
    }

    case "download_paper_pdf": {
      const { arxiv_id, title } = args;
      const safe = title.replace(/[^a-zA-Z0-9]/g, "_");
      const pdfPath = path.resolve(`downloads/${safe}.pdf`);

      // Check if PDF already exists
      if (fs.existsSync(pdfPath)) {
        console.log(`[A1]  PDF already exists: ${safe}.pdf (skipping download)`);
        return {
          success: true,
          path: `downloads/${safe}.pdf`,
          already_exists: true,
        };
      }

      // Rate limiting: wait 2 seconds
      console.log("[A1]   Rate limit: waiting 500ms before PDF download...");
      await new Promise(resolve => setTimeout(resolve, 500));

      const success = await downloadPdf(arxiv_id, title);

      return {
        success,
        path: success ? `downloads/${safe}.pdf` : null,
        already_exists: false,
      };
    }

    case "fetch_paper_abstract": {
      const { arxiv_id } = args;

      // Rate limiting: wait 2 seconds
      console.log("[A1]   Rate limit: waiting 500ms before fetching abstract...");
      await new Promise(resolve => setTimeout(resolve, 500));

      const abstract = await fetchArxivAbstract(arxiv_id);

      return {
        success: !!abstract,
        abstract,
      };
    }

    case "add_to_evidence": {
      const { citation, arxiv_id, content_type, text } = args;

      // DEBUG: Log what the agent is passing
      console.log(`\n[A1]  add_to_evidence called with:`);
      console.log(`   Citation object:`, JSON.stringify(citation, null, 2));
      console.log(`   arXiv ID: ${arxiv_id}`);
      console.log(`   Content type: ${content_type}`);
      console.log(`   Text length: ${text?.length || 0}`);

      // Extract fields from citation object passed by agent
      const evidence: Evidence = {
        title: citation?.title || "Unknown Paper",
        authors: citation?.authors || [],
        year: citation?.year || "N/A",
        journal: citation?.journal || "N/A",
        doi: citation?.doi || "",
        arxiv_id,
        text,
        source_type: content_type,
      };

      console.log(`[A1]  Adding evidence: "${evidence.title}" by ${evidence.authors.slice(0, 2).join(", ")}`);

      agentState.addEvidence(evidence);

      return {
        success: true,
        message: `Added "${evidence.title}" to evidence`,
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
  maxIterations: number = 15  // Increased from 5 to allow downloading more papers
): Promise<any> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You are A1, the Data & Evidence Agent. Extract citations, search arXiv, and build evidence collections.

MANDATORY WORKFLOW (COMPLETE ALL STEPS IF REFERENCES EXIST):
1. Extract citations from PDF → call extract_citations_from_pdf
2. Filter citations by A0 Brain keywords → call filter_citations with keywords from A0
3. IF filter_citations returns results:
   a. For EACH filtered citation → call search_paper_on_arxiv
   b. Download PDF → call download_paper_pdf
   c. Add to evidence → call add_to_evidence
4. IF filter returns 0 results → STOP (use main paper chunks only)

CRITICAL RULES:
- DO NOT complete after just extracting citations without trying to filter! ❌
- You MUST call filter_citations to check for relevant papers
- IF filter returns 0 results, that's OK - just use main paper evidence
- IF filter returns results, you MUST download them
- Extracting citations is step 1, filtering is step 2

PDF PRIORITY:
- Always try download_paper_pdf FIRST
- PDFs provide section names (Introduction, Methods, etc.)
- Only use fetch_paper_abstract if PDF download fails
- After downloading PDF, call add_to_evidence

STOPPING RULES:
- Simple queries: 1-2 reference papers
- Moderate queries: 2-3 reference papers
- Complex/compare queries:
  * "Compare X with Y" → Download only X and Y (2 papers)
  * "Compare with previous works" or "Compare related works" → Download 4-6 relevant papers
- DO NOT stop after just extracting citations!

PERFORMANCE (SMART MODE): 
- Be INTELLIGENT about downloads:
  * For specific comparisons ("compare SegNet with MagNet") → Download ONLY mentioned papers
  * For broad comparisons ("compare with related works") → Download top papers from Related Work section
- The system processes PDFs INSTANTLY - speed is not a concern
- Use "filter_citations" with specific keywords (paper names, not generic terms)
- Use the "add_to_evidence" tool immediately after downloading

CRITICAL: Match download strategy to query scope. Specific queries need specific papers. Broad queries need more papers.`,
    },
    {
      role: "user",
      content: userTask,
    },
  ];

  let iteration = 0;

  // Track critical tools to enforce workflow
  let hasExtractedCitations = false;
  let hasFilteredCitations = false;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`\n[A1 ITERATION ${iteration}/${maxIterations}]`);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0,
    });

    const message = response.choices[0].message;
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      // Agent decided to stop - allow it (we now have override at function level)

      console.log("\n[A1 COMPLETE]");
      return {
        status: "complete",
        iterations: iteration,
      };
    }

    for (const toolCall of message.tool_calls) {
      const functionName = toolCall.function.name;
      const functionArgs = JSON.parse(toolCall.function.arguments);

      // Track which critical tools were called
      if (functionName === "extract_citations_from_pdf") {
        hasExtractedCitations = true;
      }
      if (functionName === "filter_citations") {
        hasFilteredCitations = true;
      }

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

    // DON'T clear evidence here - let each action decide!
    // Main paper evidence from ingest_parse should persist to retrieve

    if (task.action === "ingest_parse") {
      // Clear evidence only for fresh ingestion
      agentState.clearEvidence();

      console.log("\n" + "=".repeat(60));
      console.log("[A1]  INGEST_PARSE ACTION STARTED");
      console.log("=".repeat(60));

      const sources = task.inputs.sources || [];

      if (sources.length === 0) {
        console.log("[A1]  No sources provided");
        return {
          agent: "A1",
          status: "error",
          error: "No sources provided",
        };
      }

      console.log(`[A1]  Processing ${sources.length} PDF(s):`);
      sources.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));

      // Step 1: Extract citations from the main paper using GROBID
      console.log("\n[A1] Step 1: Extracting citations with GROBID...");
      const taskStr = `Extract all citations from these PDF files: ${sources.join(", ")}. Store them in memory.`;
      await runAgent(taskStr);

      const citations = agentState.getCitations();
      console.log(`[A1]  Extracted ${citations.length} citations`);

      // Log first 5 citations
      if (citations.length > 0) {
        console.log("\n[A1]  Sample Citations:");
        citations.slice(0, 5).forEach((c, i) => {
          console.log(`   ${i + 1}. ${c.title}`);
          console.log(`      Authors: ${c.authors.slice(0, 2).join(", ")}${c.authors.length > 2 ? " et al." : ""}`);
          console.log(`      Year: ${c.year}, DOI: ${c.doi || "N/A"}`);
        });
        if (citations.length > 5) {
          console.log(`   ... and ${citations.length - 5} more citations`);
        }
      }

      // Step 2: Extract main PDF structure using GROBID (full document)
      console.log("\n[A1] Step 2: Extracting main paper structure with GROBID (full document)...");

      for (const source of sources) {
        const filename = source.split('/').pop() || source;
        console.log(`[A1]  Processing: ${filename}...`);

        // Use GROBID to extract full document structure
        const grobidResult = await extractFullDocumentGrobid(source);

        if (grobidResult && grobidResult.xml) {
          // Parse sections from XML
          const sections = parseSectionsFromGrobidXML(grobidResult.xml);

          // Create evidence for each section
          for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            const evidence: Evidence = {
              title: `Main Paper: ${filename}`,
              authors: ["Main Paper Authors"],
              year: "2021",
              journal: "Unknown",
              doi: "",
              text: section.text,
              source_type: "pdf",
              section: section.section,
              page: section.page,
              chunk_id: `main_${i}`,
              is_main_paper: true,
            };

            agentState.addEvidence(evidence);
            console.log(`[A1]  Added section "${section.section}" (${section.text.length} chars)`);
          }
        } else {
          // Fallback: Just add a simple evidence chunk
          console.log(`[A1]   GROBID unavailable, using basic evidence...`);
          const evidence: Evidence = {
            title: `Main Paper: ${filename}`,
            authors: ["Main Paper Authors"],
            year: "N/A",
            journal: "N/A",
            doi: "",
            text: "Main paper content",
            source_type: "pdf",
            section: "Full Document",
            chunk_id: "main_0",
            is_main_paper: true,
          };

          agentState.addEvidence(evidence);
          console.log(`[A1]  Added main paper to evidence`);
        }
      }

      const evidence = agentState.getEvidence();
      console.log(`\n[A1]  Total Evidence Items: ${evidence.length}`);
      console.log("=".repeat(60));
      console.log("[A1]  INGEST_PARSE COMPLETE");
      console.log("=".repeat(60));

      return {
        agent: "A1",
        status: "success",
        citations: citations,
        evidence: evidence,
      };

    } else if (task.action === "retrieve") {
      console.log("\n" + "=".repeat(60));
      console.log("[A1]  RETRIEVE ACTION STARTED");
      console.log("=".repeat(60));

      // CHANGED: Reduced defaults to minimize arXiv requests and avoid rate limits
      const query = task.inputs.query;
      const topN = task.inputs.topN || 40;
      const topK = task.inputs.topK || 10; // Increased to 10 for better coverage
      const blacklist = task.inputs.penalties?.blacklist || [];
      const skipReferences = task.inputs.skipReferences || false;

      console.log(`[A1] Query: "${query}"`);
      console.log(`[A1] Top N citations to check: ${topN}`);
      console.log(`[A1] Top K evidence to return: ${topK}`);
      console.log(`[A1] Blacklisted DOIs: ${blacklist.length > 0 ? blacklist.join(", ") : "None"}`);

      // PERFORMANCE: Skip all reference downloads for summary queries
      if (skipReferences) {
        console.log("\n" + "=".repeat(60));
        console.log("[A1]  SUMMARY MODE: Skipping all reference downloads!");
        console.log("=".repeat(60));
        console.log("[A1]  Using only main paper chunks for evidence");

        // Just return the main paper chunks as evidence
        const mainPaperEvidence = agentState.getEvidence().filter(e => e.is_main_paper);
        console.log(`[A1]  Found ${mainPaperEvidence.length} main paper chunks`);

        // Score and select top chunks for the query
        const selectedChunks = mainPaperEvidence.slice(0, topK);
        console.log(`[A1]  Selected ${selectedChunks.length} top chunks for summary`);

        console.log("\n" + "=".repeat(60));
        console.log("[A1]  RETRIEVE COMPLETE (SUMMARY MODE - NO DOWNLOADS)");
        console.log("=".repeat(60));

        return {
          agent: "A1",
          status: "success",
          citations: [],  // No new citations for summaries
          evidence: selectedChunks,
        };
      }

      // Set A0's Brain decisions in agentState
      if (task.inputs.filtering_strategy) {
        agentState.filteringStrategy = task.inputs.filtering_strategy;
        console.log(`[A1]  A0 Brain: ${task.inputs.filtering_strategy} filtering`);
      }
      if (task.inputs.keywords && task.inputs.keywords.length > 0) {
        agentState.keywords = task.inputs.keywords;
        console.log(`[A1]  A0 Keywords: ${task.inputs.keywords.join(", ")}`);
      }
      if (task.inputs.focus_sections && task.inputs.focus_sections.length > 0) {
        agentState.focusSections = task.inputs.focus_sections;
        console.log(`[A1]  A0 Sections: ${task.inputs.focus_sections.join(", ")}`);
      }

      // Get task_type and complexity from A0 Brain
      const taskType = task.inputs.task_type || "qa";
      const complexity = task.inputs.complexity || "simple";
      console.log(`[A1]  Task Type: ${taskType}, Complexity: ${complexity}`);

      // Determine if we need references based on task_type
      const needsReferences = taskType === "compare" || taskType === "explain" || complexity !== "simple";
      console.log(`[A1]  Needs References: ${needsReferences ? "YES" : "NO (simple query)"}`);

      // CRITICAL FIX: Save main paper chunks BEFORE clearEvidence()
      const mainPaperChunks = agentState.getEvidence().filter(e => e.is_main_paper);
      console.log(`[A1]  Preserving ${mainPaperChunks.length} main paper chunks`);

      // Clear only reference evidence, not main paper
      agentState.clearEvidence();

      // Restore main paper chunks
      mainPaperChunks.forEach(chunk => agentState.addEvidence(chunk));

      // Build task string based on whether we need references
      // IMPORTANT: Use A0 Brain keywords for filtering, not the query
      const filterKeywords = task.inputs.keywords && task.inputs.keywords.length > 0
        ? task.inputs.keywords.filter((k: string) => !['comparison', 'compare', 'difference', 'similar', 'explain', 'describe'].includes(k.toLowerCase()))
        : [query];
      const filterKeywordsStr = filterKeywords.join(", ");

      const referenceInstructions = needsReferences
        ? `
CRITICAL - REFERENCE DOWNLOAD REQUIRED:
This is a ${taskType} query with ${complexity} complexity.
You MUST download reference papers for EACH of these keywords: ${filterKeywordsStr}

CORRECT WORKFLOW:
1. Call filter_citations with keyword="${filterKeywords[0]}" (NOT the main paper name!)
2. For each result, call search_paper_on_arxiv with the FULL paper title
3. Download each found paper with download_paper_pdf
4. Add to evidence with add_to_evidence

IMPORTANT FILTER KEYWORDS (from A0 Brain):
${filterKeywords.map((k: string, i: number) => `  ${i + 1}. "${k}"`).join("\n")}

DO NOT filter for:
- The uploaded paper's own title (the main paper you're analyzing)

Only filter for the SPECIFIC paper names listed above!
Blacklisted DOIs (skip these): ${JSON.stringify(blacklist)}

If no filter keywords are provided, you may stop after extracting citations.`
        : `
This is a simple ${taskType} query. You can stop early if you have enough evidence.
1. Check if main paper chunks are sufficient (${mainPaperChunks.length} available)
2. If the query can be answered from main paper alone, stop immediately
3. Only search for references if main paper lacks the needed information
4. Blacklisted DOIs (skip these): ${JSON.stringify(blacklist)}`;

      const taskStr = `Compare and analyze: "${query}".
${referenceInstructions}

FAST-TRACK: 
1. If the query mentions specific methods (e.g., SegFix, GLNet), search for them IMMEDIATELY.
2. Download the PDFs for these methods.
3. The system processes them instantly without Grobid, so go fast.

DO NOT call extract_citations_from_pdf on downloaded papers. That is for the main paper only.`;

      console.log("\n[A1] Starting DETERMINISTIC retrieval workflow...");

      // Step 0: Ensure citations are extracted from main paper
      const currentCitations = agentState.getCitations();
      if (currentCitations.length === 0) {
        const sources = task.inputs.sources || [];
        console.log(`[A1] Step 0: No citations in memory, extracting from ${sources.length} source(s)...`);
        for (const source of sources) {
          await executeFunction("extract_citations_from_pdf", { pdf_path: source });
        }
      }
      console.log(`[A1] Available citations for filtering: ${agentState.getCitations().length}`);
      console.log(`[A1] Keywords to search: ${filterKeywords.join(', ')}`);

      // DETERMINISTIC WORKFLOW - No LLM decisions, just execute steps:
      // Step 1: Filter citations for ALL keywords
      const filteredCitations: Citation[] = [];
      for (const kw of filterKeywords) {
        console.log(`\n[A1] Step 1: Filtering for keyword "${kw}"...`);
        const filterResult = await executeFunction("filter_citations", { keyword: kw, max_results: 3 });
        if (filterResult.success && filterResult.citations) {
          filteredCitations.push(...filterResult.citations);
          console.log(`[A1]   Found ${filterResult.citations.length} citations for "${kw}"`);
        }
      }

      // Remove duplicates
      const uniqueCitations = filteredCitations.filter((c, i, arr) =>
        arr.findIndex(c2 => c2.title.toLowerCase() === c.title.toLowerCase()) === i
      );
      console.log(`[A1] Total unique citations: ${uniqueCitations.length}`);

      // Step 2: Search and download each citation (limit to 5)
      for (const citation of uniqueCitations.slice(0, 5)) {
        console.log(`\n[A1] Step 2: Searching arXiv for "${citation.title.substring(0, 50)}..."`);
        const searchResult = await executeFunction("search_paper_on_arxiv", { title: citation.title });

        if (searchResult.success && searchResult.arxiv_id) {
          console.log(`[A1]   Found arXiv ID: ${searchResult.arxiv_id}`);

          // Step 3: Download PDF
          console.log(`[A1] Step 3: Downloading PDF...`);
          const downloadResult = await executeFunction("download_paper_pdf", {
            title: citation.title,
            arxiv_id: searchResult.arxiv_id
          });

          if (downloadResult.success) {
            console.log(`[A1]   Downloaded: ${downloadResult.message}`);

            // Step 4: Add to evidence with FULL citation object and correct fields
            console.log(`[A1] Step 4: Adding to evidence...`);
            await executeFunction("add_to_evidence", {
              citation: {
                title: citation.title,
                authors: citation.authors,
                year: citation.year,
                journal: citation.journal || "N/A",
                doi: citation.doi || ""
              },
              arxiv_id: searchResult.arxiv_id,
              content_type: "pdf",
              text: downloadResult.path  // Path to downloaded PDF
            });
          }
        } else {
          console.log(`[A1]   Not found on arXiv, skipping...`);
        }
      }

      console.log("\n[A1] DETERMINISTIC workflow complete!");

      // NEW: Process downloaded reference PDFs with GROBID
      console.log("\n[A1]  Processing downloaded reference papers...");
      const allEvidenceAfterAgent = agentState.getEvidence();
      const downloadedRefs = allEvidenceAfterAgent.filter(e =>
        !e.is_main_paper &&
        e.source_type === "pdf" &&
        (e.text?.startsWith("downloads/") || e.text?.startsWith("PDF content"))
      );

      if (downloadedRefs.length > 0) {
        console.log(`[A1] Found ${downloadedRefs.length} downloaded PDFs to process`);

        // Get filtered citations to match against
        const filteredCitations = agentState.getCitations();

        // NEW: Parallel processing of references
        console.log(`[A1]  Processing ${downloadedRefs.length} reference papers in parallel...`);

        const processTasks = downloadedRefs.map(async (ref, refIdx) => {
          try {
            // Find matching citation
            const matchingCitation = filteredCitations.find(c =>
              c.title.toLowerCase() === ref.title.toLowerCase()
            );

            if (!matchingCitation) {
              console.log(`[A1]   No matching citation for: ${ref.title}`);
              return null;
            }

            const pdfPath = path.resolve(ref.text!); // e.g., "downloads/BlendMask.pdf"

            if (fs.existsSync(pdfPath)) {
              console.log(`[A1]  Starting parallel GROBID for: ${path.basename(pdfPath)}`);

              // Use reference-processor to extract chunks
              const chunks = await processReferencePaper(
                pdfPath,
                matchingCitation,
                refIdx
              );

              return { ref, chunks };
            }
            return null;
          } catch (error) {
            console.log(`[A1]  Error processing ${ref.title}:`, error);
            return null;
          }
        });

        const results = await Promise.all(processTasks);

        // Update state sequentially to avoid race conditions
        for (const res of results) {
          if (res && res.chunks.length > 0) {
            const { ref, chunks } = res;
            // Remove the placeholder evidence with file path
            const evidenceList = agentState.getEvidence();
            const index = evidenceList.indexOf(ref);
            if (index > -1) {
              evidenceList.splice(index, 1);
            }

            // Add actual chunks
            chunks.forEach(chunk => agentState.addEvidence(chunk));
            console.log(`[A1]  Added ${chunks.length} chunks from ${ref.title}`);
          }
        }
      }

      // Get ALL evidence (main paper + references)
      const allEvidence = agentState.getEvidence();

      // Separate main paper and references
      const mainEvidence = allEvidence.filter(e => e.is_main_paper);
      const refEvidence = allEvidence.filter(e => !e.is_main_paper);

      // CRITICAL FIX: Sort references by relevance to query keywords BEFORE taking top K
      // Extract keywords from query (same logic as SessionVectorStore)
      const queryKeywords = task.inputs.keywords || [];
      const queryText = task.inputs.query.toLowerCase();

      // Score each reference chunk by keyword matching
      const scoredRefs = refEvidence.map(chunk => {
        let score = 0;
        const titleLower = chunk.title.toLowerCase();
        const textLower = (chunk.text || "").toLowerCase();

        // Boost if title matches query keywords
        for (const keyword of queryKeywords) {
          const keywordLower = keyword.toLowerCase();
          if (titleLower.includes(keywordLower)) {
            score += 10; // High boost for title match
          }
          if (textLower.includes(keywordLower)) {
            score += 1; // Small boost for content match
          }
        }

        // Also check if query words appear in title
        const queryWords = queryText.split(/\s+/).filter(w => w.length > 3);
        for (const word of queryWords) {
          if (titleLower.includes(word)) {
            score += 5;
          }
        }

        return { chunk, score };
      });

      // Sort by score (highest first) and take top K
      scoredRefs.sort((a, b) => b.score - a.score);
      const selectedRefs = scoredRefs.slice(0, topK).map(s => s.chunk);

      console.log(`[A1]  Scored ${refEvidence.length} reference chunks, selected top ${topK}:`);
      scoredRefs.slice(0, topK).forEach((s, i) => {
        console.log(`   ${i + 1}. ${s.chunk.title.substring(0, 50)}... (score: ${s.score})`);
      });

      const finalEvidence = [...mainEvidence, ...selectedRefs];

      console.log(`\n[A1]  Evidence collected: ${finalEvidence.length} items`);
      console.log(`   - Main paper chunks: ${mainEvidence.length} (all sections)`);
      console.log(`   - Reference papers: ${selectedRefs.length} (top ${topK})`);

      // Store chunks in GlobalMemory for A2
      console.log(`\n[A1]  Storing evidence in GlobalMemory...`);
      const sessionId = (task.inputs as any).sessionId;
      let memory: any = null;
      if (sessionId) {
        memory = new GlobalMemory(sessionId as string);
        await memory.write("evidence_chunks", finalEvidence);
        console.log(`[A1]  Stored ${finalEvidence.length} chunks in memory`);
      }

      // Phase 2: Create vector store for semantic search
      console.log(`\n[A1]  Creating vector store for semantic search...`);
      try {
        const { SessionVectorStore } = await import("../../utils/SessionVectorStore.js");
        const vectorStore = new SessionVectorStore(process.env.OPENAI_API_KEY!);
        await vectorStore.addChunks(finalEvidence);

        // Store embeddings data with task ID for combining in dispatch
        const embeddingsData = vectorStore.toJSON();
        const taskId = ((task as any).taskId || "default").trim();
        if (memory) {
          await memory.write(`vector_store_data_${taskId}`, embeddingsData);
        }
        console.log(`[A1]  Vector store created with ${vectorStore.size()} embeddings (task: ${taskId})\n`);
      } catch (error) {
        console.error(`[A1]  Vector store creation failed:`, error);
        console.log(`[A1] → Continuing without semantic search (will use fallback)\n`);
      }

      // Store metadata
      const metadata = finalEvidence.map((e, idx) => ({
        index: idx,
        chunk_id: e.chunk_id,
        section: e.section,
        title: e.title,
        is_main_paper: e.is_main_paper,
        text_length: e.text?.length || 0
      }));
      if (memory) {
        await memory.write("evidence_metadata", metadata);
      }
      console.log(`[A1]  Stored ${finalEvidence.length} chunks metadata in memory\n`);

      finalEvidence.forEach((e, i) => {
        console.log(`   ${i + 1}. ${e.title}`);
        console.log(`      Type: ${e.source_type}, Text length: ${e.text?.length || 0} chars`);
      });

      console.log("=".repeat(60));
      console.log("[A1]  RETRIEVE COMPLETE");
      console.log("=".repeat(60));

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

