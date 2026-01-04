import express, { Request, Response } from "express";
import cors from "cors";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import * as path from "path";
import * as fs from "fs";
import dotenv from "dotenv";
import { executeQuery, submitFeedback } from "./index";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// File upload configuration
const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${file.originalname}`;
        cb(null, uniqueName);
    },
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === "application/pdf") {
            cb(null, true);
        } else {
            cb(new Error("Only PDF files are allowed"));
        }
    },
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB max
    },
});

/**
 * Health check endpoint
 */
app.get("/api/health", (req: Request, res: Response) => {
    res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        service: "Agentic Research Assistant",
    });
});

/**
 * Submit a research query
 * POST /api/query
 * Body: { query: string, sessionId?: string }
 * Optional: PDF files as multipart/form-data
 */
app.post("/api/query", async (req: Request, res: Response) => {
    try {
        const { query, sessionId, sources, expertise } = req.body;

        if (!query) {
            return res.status(400).json({
                error: "Query is required",
            });
        }

        // Generate or use provided session ID
        const session = sessionId || uuidv4();

        console.log(`Sources (PDF paths): ${JSON.stringify(sources || [])}`);
        console.log(`Expertise: ${expertise || 'intermediate'}`);

        console.log(`\n[API] Query received`);
        console.log(`Session: ${session}`);
        console.log(`Query: ${query}`);
        console.log(`PDFs: ${sources.length}`);

        const result = await executeQuery(session, query, sources);

        // Return result
        res.json({
            sessionId: session,
            query,
            answer: result.answer,
            citations: result.citations,
            metadata: {
                trace: result.trace,
                sources_count: sources.length,
            },
        });
    } catch (error: any) {
        console.error("[API] Query error:", error);
        res.status(500).json({
            error: "Failed to process query",
            message: error.message,
        });
    }
});

/**
 * Upload PDF files
 * POST /api/upload
 * Multipart form data with 'pdfs' field
 */
app.post("/api/upload", upload.array("pdfs", 10), async (req: Request, res: Response) => {
    try {
        const files = req.files as Express.Multer.File[];

        if (!files || files.length === 0) {
            return res.status(400).json({
                error: "No PDF files uploaded",
            });
        }

        console.log(`\n[API] PDF Upload`);
        console.log(`Files: ${files.length}`);
        files.forEach(f => console.log(`  - ${f.originalname} -> ${f.path}`));

        // Return the first file path (for single upload)
        res.json({
            path: files[0].path,
            files: files.map(f => ({ originalName: f.originalname, path: f.path }))
        });
    } catch (error: any) {
        console.error("[API] Upload error:", error);
        res.status(500).json({
            error: "Failed to upload PDF",
            message: error.message,
        });
    }
});

/**
 * Submit feedback
 * POST /api/feedback
 * Body: {
 *   sessionId: string,
 *   helpful?: boolean,
 *   wrong_citations?: { doi?: string }[],
 *   verbosity?: "shorter" | "longer"
 * }
 */
app.post("/api/feedback", async (req: Request, res: Response) => {
    try {
        const { sessionId, helpful, wrong_citations, verbosity } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                error: "sessionId is required",
            });
        }

        const feedback = {
            helpful,
            wrong_citations,
            verbosity,
            timestamp: new Date().toISOString(),
        };

        console.log(`\n[API] Feedback received`);
        console.log(`Session: ${sessionId}`);
        console.log(`Feedback:`, feedback);

        await submitFeedback(sessionId, feedback);

        res.json({
            status: "success",
            message: "Feedback recorded",
        });
    } catch (error: any) {
        console.error("[API] Feedback error:", error);
        res.status(500).json({
            error: "Failed to process feedback",
            message: error.message,
        });
    }
});

/**
 * Get session history (optional endpoint)
 * GET /api/session/:sessionId
 */
app.get("/api/session/:sessionId", async (req: Request, res: Response) => {
    try {
        const { sessionId } = req.params;
        const { GlobalMemory } = await import("./memory/GlobalMemory");
        const mem = new GlobalMemory(sessionId);

        const working = await mem.read("working");
        const feedbackLog = await mem.read("feedback_log");

        res.json({
            sessionId,
            lastQuery: working?.last_query,
            lastAnswer: working?.last_answer,
            lastCitations: working?.last_citations,
            feedbackLog,
        });
    } catch (error: any) {
        console.error("[API] Session error:", error);
        res.status(500).json({
            error: "Failed to retrieve session",
            message: error.message,
        });
    }
});

/**
 * Start server
 */
app.listen(PORT, () => {
    console.log("=".repeat(60));
    console.log(" Agentic Research Assistant API Server");
    console.log("=".repeat(60));
    console.log(` Server running on http://localhost:${PORT}`);
    console.log(` Health check: http://localhost:${PORT}/api/health`);
    console.log(` Query endpoint: POST http://localhost:${PORT}/api/query`);
    console.log(` Feedback endpoint: POST http://localhost:${PORT}/api/feedback`);
    console.log("=".repeat(60));
});

// Graceful shutdown
process.on("SIGINT", async () => {
    console.log("\n\n Shutting down gracefully...");
    const { GlobalMemory } = await import("./memory/GlobalMemory");
    await GlobalMemory.disconnect();
    process.exit(0);
});

export default app;