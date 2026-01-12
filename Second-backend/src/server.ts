import express from "express";
import cors from "cors";
import multer from "multer";
import * as path from "path";
import * as fs from "fs";
import axios from "axios";
import dotenv from "dotenv";
import { runA0 } from "./agents/a0/a0";
import { run as runA1 } from "./agents/a1/a1";
import { run as runA2 } from "./agents/a2/a2";
import { GlobalMemory } from "./memory/GlobalMemory";

dotenv.config();

// Check for required environment variables
if (!process.env.OPENAI_API_KEY) {
  console.error("\n❌ ERROR: OPENAI_API_KEY is required but not found!");
  console.error("Please create a .env file in the project root with:");
  console.error("  OPENAI_API_KEY=your_openai_api_key_here\n");
  console.error("Or set it as an environment variable:");
  console.error("  export OPENAI_API_KEY=your_openai_api_key_here\n");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: ['http://localhost:5174', 'http://localhost:5173'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads (single file only)
// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Keep original extension and name (sanitized)
    const uniqueSuffix = Date.now();
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    cb(null, `${path.parse(sanitizedName).name}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
});

// Helper to handle both 'file' (legacy/cli) and 'pdfs' (frontend) fields
const uploadMiddleware = upload.fields([{ name: 'file', maxCount: 1 }, { name: 'pdfs', maxCount: 1 }]);

// Ensure uploads directory exists
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads", { recursive: true });
}

// CHANGED BY DATE: 2026-01-02 - Added local interface definitions to fix missing type errors
// Define simple state types
interface A0State {
  sessionId: string;
  userInput: string;
  sources?: string[];
  trace?: string[];
}

interface FeedbackState {
  sessionId: string;
  feedback: any;
  lastQuery?: string;
  lastAnswer?: string;
}

// CHANGED BY DATE: 2026-01-02 - Removed explicit type annotation 'AgentRegistry' to fix type error
// const agents: AgentRegistry = {
//   A1: { run: runA1 },
//   A2: { run: runA2 },
// };
const agents = {
  A1: { run: runA1 },
  A2: { run: runA2 },
};

// CHANGED BY DATE: 2026-01-02 - Disabled graph builders as they are not implemented in this version
// // Build graphs
// const answerGraph = buildA0AnswerGraph(agents);
// const feedbackGraph = buildA0FeedbackGraph();
// Graph builders are not used in this backend version
// const answerGraph = buildA0AnswerGraph(agents);
// const feedbackGraph = buildA0FeedbackGraph();

// Helper to generate session ID
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Helper function to download PDF from DOI
async function downloadPdfFromDOI(doi: string): Promise<string | null> {
  try {
    // Try to get PDF URL from DOI
    const doiUrl = `https://doi.org/${doi}`;
    const response = await axios.get(doiUrl, {
      maxRedirects: 5,
      timeout: 10000,
    });

    // Try common PDF URL patterns
    const pdfUrls = [
      response.request?.responseURL?.replace(/\.html?$/, ".pdf"),
      `https://arxiv.org/pdf/${doi}.pdf`,
    ];

    for (const pdfUrl of pdfUrls) {
      if (!pdfUrl) continue;
      try {
        const pdfResponse = await axios.get(pdfUrl, {
          responseType: "arraybuffer",
          timeout: 30000,
        });

        if (pdfResponse.status === 200 && pdfResponse.data) {
          const safeName = doi.replace(/[^a-zA-Z0-9]/g, "_");
          const downloadDir = "uploads";
          if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
          }
          const filePath = path.join(downloadDir, `${safeName}.pdf`);
          fs.writeFileSync(filePath, pdfResponse.data);
          return filePath;
        }
      } catch (e) {
        // Try next URL
        continue;
      }
    }

    return null;
  } catch (error) {
    console.error("[Server] Error downloading PDF from DOI:", error);
    return null;
  }
}

// POST /api/query - Main query endpoint
app.post("/api/query", uploadMiddleware, async (req, res) => {
  try {
    const { query, sessionId, doi } = req.body;

    // Check for file in 'file' or 'pdfs'
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const file = (files?.['file']?.[0]) || (files?.['pdfs']?.[0]);

    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    const session = sessionId || generateSessionId();

    // Prepare sources (PDF file paths) - only one PDF allowed
    let sourcePath: string | undefined = undefined;

    if (file) {
      sourcePath = file.path;
    } else if (doi) {
      // Download PDF from DOI
      console.log(`[Server] Downloading PDF from DOI: ${doi}`);
      const downloadedPath = await downloadPdfFromDOI(doi);
      if (downloadedPath) {
        sourcePath = downloadedPath;
      } else {
        return res.status(400).json({
          error: "Failed to download PDF from DOI. Please upload the PDF file directly."
        });
      }
    }
    // CHANGED BY DATE: 2026-01-02 - Support 'sources' field from frontend which contains path to previously uploaded file
    else if (req.body.sources && Array.isArray(req.body.sources) && req.body.sources.length > 0) {
      sourcePath = req.body.sources[0];
      console.log(`[Server] Using existing source file: ${sourcePath}`);
    }

    if (!sourcePath) {
      return res.status(400).json({
        error: "Either a PDF file or DOI must be provided"
      });
    }

    // Build initial state
    const initialState: A0State = {
      sessionId: session,
      userInput: query,
      sources: [sourcePath],
      trace: [],
    };

    // CHANGED BY DATE: 2026-01-02 - Extract expertise from request body to fix UI setting issue
    const expertise = req.body.expertise as "novice" | "intermediate" | "expert" | undefined;

    // Persist expertise choice for this session (used by /api/feedback)
    if (expertise) {
      const mem = new GlobalMemory(session);
      await mem.write("expertise", expertise);
    }


    console.log(`\n[Server] Processing query for session ${session}`);
    console.log(`Query: ${query}`);
    console.log(`Expertise: ${expertise || 'default (intermediate)'}`);
    console.log(`Source: ${sourcePath}`);

    // Run the agent directly (Second-backend uses simple function call, not graph)
    const result: any = await runA0({
      ...initialState,
      expertise: expertise
    });

    // Extract highlighted sections from main paper
    const mainPaperEvidence = result.evidence?.find((e: any) => e.is_main_paper);
    const highlightedSections = mainPaperEvidence?.locations || [];

    // Format citations with evidenceChunk for frontend
    // FIXED: A2 already provides section/page/chunk_id in citation object
    // Preserve ALL metadata for both main paper and external citations
    const formattedCitations = (result.citations || []).map((citation: any) => {
      // Create evidenceChunk with all available metadata from A2
      // Don't null out anything - use what A2 provides
      const evidenceChunk = {
        text: citation.text || "",  // Preserve text if A2 provides it
        section: citation.section || null,  // Section name (main papers have this)
        page: citation.page || null,  // Page number
        is_main_paper: citation.is_main_paper || false,
        locations: citation.locations || null,  // Precise text locations for highlighting
        chunk_id: citation.chunk_id || null,  // Unique chunk identifier
        pdf_path: citation.pdf_path || null,  // Path to PDF file
      };

      return {
        index: citation.index,
        formatted: citation.formatted,
        title: citation.title,
        authors: citation.authors || [],
        year: citation.year || "",
        doi: citation.doi,
        arxiv_id: citation.arxiv_id,
        journal: citation.journal || "",
        section: citation.section || null,  // Include at top level
        page: citation.page || null,  // Include at top level
        chunk_id: citation.chunk_id || null,  // Include at top level
        is_main_paper: citation.is_main_paper || false,
        evidenceChunk: evidenceChunk,  // Full metadata object
      };
    });

    // Save evidence to memory for feedback regeneration
    const memory = new GlobalMemory(session);
    await memory.write("last_working_state", {
      last_evidence: result.evidence || [],
      last_query: query,
      last_answer: result.answer,
      timestamp: new Date().toISOString()
    });
    console.log(`[Server] Saved ${result.evidence?.length || 0} evidence items to memory for feedback`);


    res.json({
      sessionId: session,
      answer: result.answer || "No answer generated",
      citations: formattedCitations,
      highlightedSections: highlightedSections.map((loc: any) => ({
        paragraph: loc.paragraph,
        line: loc.line,
        start_sentence: loc.start_sentence,
        text: loc.start_sentence,
      })),
      trace: result.trace || [],
      evidenceCount: result.evidence?.length || 0,
      mainPaperPath: mainPaperEvidence?.pdf_path || sourcePath,
    });
  } catch (error) {
    console.error("[Server] Error processing query:", error);
    res.status(500).json({
      error: "Failed to process query",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// CHANGED BY DATE: 2026-01-02 - Added separate upload endpoint for second-frontend
app.post("/api/upload", uploadMiddleware, async (req, res) => {
  try {
    // Check for file in 'file' or 'pdfs'
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const file = (files?.['file']?.[0]) || (files?.['pdfs']?.[0]);

    if (!file) {
      return res.status(400).json({ error: "No PDF file provided" });
    }

    console.log(`[Server] Uploaded file: ${file.originalname} -> ${file.path}`);

    // Return path in format expected by frontend
    res.json({
      path: file.path,
      filename: file.originalname,
      size: file.size
    });
  } catch (error) {
    console.error("[Server] Error uploading file:", error);
    res.status(500).json({
      error: "Failed to upload file",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// POST /api/feedback - Feedback endpoint
app.post("/api/feedback", async (req, res) => {
  try {
    const { sessionId, feedback, lastQuery, lastAnswer } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    if (!feedback || !feedback.rating) {
      return res.status(400).json({ error: "feedback.rating is required (use 'like' or 'dislike')" });
    }

    console.log(`\n[Server] Processing feedback for session ${sessionId}`);
    console.log(`Rating: ${feedback.rating}${feedback.style ? `, Style: ${feedback.style}` : ''}`);

    const memory = new GlobalMemory(sessionId);

    // Get stored expertise (DO NOT CHANGE IT)
    const storedExpertise = await memory.read<"novice" | "intermediate" | "expert">("expertise") ?? "intermediate";

    // LIKE: Save positive feedback and return
    if (feedback.rating === 'like') {
      await memory.write("feedback_history", {
        rating: 'like',
        query: lastQuery,
        timestamp: new Date().toISOString()
      });

      return res.json({
        status: "success",
        message: "Thank you for your feedback!",
        action: "none"
      });
    }

    // DISLIKE: Regenerate answer with SAME evidence, different format
    if (feedback.rating === 'dislike') {
      console.log("[Server] Regenerating answer with better formatting...");

      // Load EXISTING evidence (no new retrieval!)
      const lastWorking = await memory.read("last_working_state");
      const evidence = (lastWorking as any)?.last_evidence || [];

      if (evidence.length === 0) {
        return res.status(400).json({
          error: "No evidence available. Please submit a new query first."
        });
      }

      console.log(`[Server] Using ${evidence.length} existing evidence items`);
      console.log(`[Server] Keeping expertise: ${storedExpertise}`);

      // Log evidence composition for debugging
      const mainPaperEvidence = evidence.filter((e: any) => e.is_main_paper);
      const externalEvidence = evidence.filter((e: any) => !e.is_main_paper);
      console.log(`[Server] Evidence breakdown: ${mainPaperEvidence.length} main paper sections, ${externalEvidence.length} external papers`);

      if (externalEvidence.length > 0) {
        console.log(`[Server] External papers available:`);
        externalEvidence.forEach((e: any, i: number) => {
          console.log(`  [${i}] ${e.title} (${e.source_type})`);
        });
      }

      // Determine format instruction based on feedback style
      let formatInstruction = "";
      if (feedback.style === 'categorized') {
        formatInstruction = " Organize the answer into clear sections with descriptive headings.";
      } else if (feedback.style === 'shorter') {
        formatInstruction = " Provide a more concise answer (150-250 words maximum).";
      } else if (feedback.style === 'longer') {
        formatInstruction = " Provide a comprehensive, detailed answer (500-800 words).";
      } else {
        // Default: just improve structure
        formatInstruction = " Improve the structure and clarity of the answer.";
      }

      // Detect if this is a comparison question
      const isComparison = /\b(compare|comparison|vs\.?|versus|difference|differences|similarities)\b/i.test(lastQuery);

      // If comparison + external evidence exists, FORCE using external evidence
      if (isComparison && externalEvidence.length > 0 && storedExpertise !== 'novice') {
        formatInstruction += " IMPORTANT: You must cite and compare with the external reference papers provided in the evidence.";
        console.log(`[Server] ⚠️  COMPARISON DETECTED - Instructing A2 to use external evidence`);
      }

      // Call A2 with SAME evidence, SAME expertise, modified query
      const a2Task = {
        agent: "A2" as const,
        action: "reason" as const,
        inputs: {
          query: lastQuery + formatInstruction,
          evidence: evidence,
          expertise: storedExpertise,  // ✅ KEEP SAME
          format: "markdown"
        }
      };

      const improvedAnswer = await runA2(a2Task);

      console.log(`[Server] Generated improved answer (${improvedAnswer.answer?.length || 0} chars)`);

      // Format citations the same way as the main query endpoint
      const formattedCitations = (improvedAnswer.citations || []).map((citation: any) => {
        const evidenceChunk = {
          text: citation.text || "",
          section: citation.section || null,
          page: citation.page || null,
          is_main_paper: citation.is_main_paper || false,
          locations: citation.locations || null,
          chunk_id: citation.chunk_id || null,
          pdf_path: citation.pdf_path || null,
        };

        return {
          index: citation.index,
          formatted: citation.formatted,
          title: citation.title,
          authors: citation.authors || [],
          year: citation.year || "",
          doi: citation.doi,
          arxiv_id: citation.arxiv_id,
          journal: citation.journal || "",
          section: citation.section || null,
          page: citation.page || null,
          chunk_id: citation.chunk_id || null,
          is_main_paper: citation.is_main_paper || false,
          evidenceChunk: evidenceChunk,
        };
      });

      console.log(`[Server] Formatted ${formattedCitations.length} citations for feedback response`);

      return res.json({
        status: "success",
        message: "Generated improved answer",
        action: "regenerated",
        answer: improvedAnswer.answer,
        citations: formattedCitations,  // Use formatted citations
        metadata: improvedAnswer.metadata
      });
    }

    return res.status(400).json({
      error: "Invalid feedback.rating (use 'like' or 'dislike')"
    });

  } catch (error) {
    console.error("[Server] Error processing feedback:", error);
    res.status(500).json({
      error: "Failed to process feedback",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// GET / - Root endpoint with API information and examples
app.get("/", (req, res) => {
  res.json({
    name: "RefHunters API",
    version: "1.0.0",
    status: "running",
    endpoints: {
      health: {
        method: "GET",
        path: "/api/health",
        description: "Health check endpoint",
        example: "curl http://localhost:3000/api/health",
      },
      query: {
        method: "POST",
        path: "/api/query",
        description: "Submit a query with PDF file or DOI",
        required: ["query"],
        optional: ["file", "doi", "sessionId"],
        examples: {
          withFile: `curl -X POST http://localhost:3000/api/query \\
  -F "file=@paper.pdf" \\
  -F "query=What is the main contribution of this paper?"`,
          withDOI: `curl -X POST http://localhost:3000/api/query \\
  -H "Content-Type: application/json" \\
  -d '{"query":"What methods are used?","doi":"10.1234/example.doi"}'`,
        },
      },
      feedback: {
        method: "POST",
        path: "/api/feedback",
        description: "Provide feedback on answers",
        required: ["sessionId", "feedback"],
        example: `curl -X POST http://localhost:3000/api/feedback \\
  -H "Content-Type: application/json" \\
  -d '{"sessionId":"session_123","feedback":{"helpful":true}}'`,
      },
    },
    note: "POST endpoints cannot be accessed via browser. Use curl, Postman, or your frontend application.",
    documentation: "See README.md for detailed API documentation",
  });
});

// GET /api/health - Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n[Server] RefHunters API running on port ${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/api/health`);
  console.log(`[Server] Query endpoint: POST http://localhost:${PORT}/api/query`);
  console.log(`[Server] Feedback endpoint: POST http://localhost:${PORT}/api/feedback\n`);
});

export default app;
