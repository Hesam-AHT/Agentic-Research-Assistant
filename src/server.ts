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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads (single file only)
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"));
  },
});

// Ensure uploads directory exists
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads", { recursive: true });
}

// Helper to generate session ID
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Helper function to download PDF from DOI
async function downloadPdfFromDOI(doi: string): Promise<string | undefined> {
  try {
    const doiUrl = `https://doi.org/${doi}`;
    const response = await axios.get(doiUrl, {
      maxRedirects: 5,
      timeout: 10000,
    });

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
          if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
          const filePath = path.join(downloadDir, `${safeName}.pdf`);
          fs.writeFileSync(filePath, pdfResponse.data);
          return filePath;
        }
      } catch {
        continue;
      }
    }
    return undefined;
  } catch (error) {
    console.error("[Server] Error downloading PDF from DOI:", error);
    return undefined;
  }
}

// POST /api/query - Main query endpoint
app.post("/api/query", upload.single("file"), async (req, res) => {
  try {
    const { query, sessionId, doi } = req.body;
    const file = req.file;

    if (!query) return res.status(400).json({ error: "Query is required" });

    const session = sessionId || generateSessionId();

    // Prepare source PDF path
    let sourcePath: string | undefined = undefined;

    if (file) sourcePath = file.path;
    else if (doi) {
      sourcePath = (await downloadPdfFromDOI(doi)) || undefined;
      if (!sourcePath)
        return res.status(400).json({
          error: "Failed to download PDF from DOI. Please upload the PDF manually.",
        });
    }

    if (!sourcePath)
      return res.status(400).json({ error: "Either a PDF file or DOI must be provided" });

    console.log(`\n[Server] Processing query for session ${session}`);
    console.log(`Query: ${query}`);
    console.log(`Source: ${sourcePath}`);

    // Run A0 directly
    const result: any = await runA0({
      sessionId: session,
      userInput: query,
      sources: [sourcePath],
    });

    // Highlighted sections
    const mainPaperEvidence = result.evidence?.find((e: any) => e.is_main_paper);
    const highlightedSections = mainPaperEvidence?.locations || [];

    // Format citations
    const formattedCitations = (result.citations || []).map((citation: any) => {
      if (citation.is_main_paper && citation.locations) {
        return {
          ...citation,
          location_details: citation.locations.map((loc: any) => ({
            paragraph: loc.paragraph,
            line: loc.line,
            start_sentence: loc.start_sentence,
            details: `Paragraph ${loc.paragraph}, Line ${loc.line}: "${loc.start_sentence}"`,
          })),
        };
      }
      return citation;
    });

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
      confidence: result.confidence,
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

// POST /api/feedback - Feedback endpoint
app.post("/api/feedback", async (req, res) => {
  try {
    const { sessionId, feedback, lastQuery, lastAnswer } = req.body;

    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
    if (!feedback) return res.status(400).json({ error: "feedback is required" });

    console.log(`\n[Server] Processing feedback for session ${sessionId}`);
    console.log(`Feedback:`, feedback);

    const mem = new GlobalMemory(sessionId);

    // Update blacklist if wrong citations
    const blacklist = (await mem.read<string[]>("blacklist")) || [];
    for (const w of feedback.wrong_citations ?? []) {
      if (w.doi && !blacklist.includes(w.doi)) blacklist.push(w.doi);
    }
    await mem.write("blacklist", blacklist);
    await mem.append("feedback_log", feedback);

    let nextAction: any = null;

    // Route to appropriate agent based on feedback
    if (feedback.wrong_citations?.length > 0 || feedback.needs_more_info) {
      // A1: Retrieve new knowledge base
      const a1Task = {
        agent: "A1" as const,
        action: "retrieve" as const,
        inputs: {
          query: lastQuery || "",
          topN: 40,
          topK: 8,
          penalties: { blacklist },
        },
      };
      const a1Result = await runA1(a1Task);
      nextAction = { agent: "A1", result: a1Result, message: "New knowledge base created. Would you like a new answer?" };
    } else if (feedback.answer_wrong) {
      // A2: Reason with existing evidence
      const lastWorking = await mem.read("working");
      const evidence = (lastWorking as any)?.last_evidence || [];
      if (evidence.length === 0)
        return res.status(400).json({ error: "No evidence available. Please submit a new query first." });

      const a2Task = {
        agent: "A2" as const,
        action: "reason" as const,
        inputs: {
          query: lastQuery || "",
          evidence,
          expertise: "intermediate",
          format: feedback.verbosity === "shorter" ? "bullets" : "markdown",
        },
      };
      const a2Result = await runA2(a2Task);
      nextAction = { agent: "A2", result: a2Result, message: "New answer generated based on feedback" };
    }

    res.json({ sessionId, nextAction });
  } catch (error) {
    console.error("[Server] Error processing feedback:", error);
    res.status(500).json({
      error: "Failed to process feedback",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// GET /api/health - Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n[Server] Research Assistant API running on port ${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/api/health`);
  console.log(`[Server] Query endpoint: POST http://localhost:${PORT}/api/query`);
  console.log(`[Server] Feedback endpoint: POST http://localhost:${PORT}/api/feedback\n`);
});

export default app;
