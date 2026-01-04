import fs from "fs";
import { createRequire } from "module";

// Polyfill DOMMatrix for pdf-parse (fixes Node 18+ issues)
if (typeof (global as any).DOMMatrix === "undefined") {
    (global as any).DOMMatrix = class DOMMatrix {
        constructor() { }
    };
}

const customRequire = createRequire(import.meta.url);
const pdf = customRequire("pdf-parse");

/**
 * Fast PDF Parser - Extract text from PDF instantly using local library
 * This is used for Reference papers only.
 */
export async function extractTextFast(pdfPath: string): Promise<string> {
    const dataBuffer = fs.readFileSync(pdfPath);
    try {
        const data = await pdf(dataBuffer);
        return data.text;
    } catch (error) {
        console.error("[FastPDF] Error parsing PDF:", error);
        return "";
    }
}

/**
 * Chunk text into smaller pieces for vector store
 */
export function chunkText(text: string, maxChars: number = 2000): string[] {
    // Clean up text
    const cleanText = text
        .replace(/\r\n/g, "\n")
        .replace(/\n\s*\n/g, "\n\n")
        .replace(/[ \t]+/g, " ");

    // Split by paragraphs
    const paragraphs = cleanText.split("\n\n");
    const chunks: string[] = [];
    let currentChunk = "";

    for (const p of paragraphs) {
        if (p.trim().length === 0) continue;

        if ((currentChunk + p).length > maxChars && currentChunk.length > 0) {
            chunks.push(currentChunk.trim());
            currentChunk = "";
        }
        currentChunk += p + "\n\n";
    }

    if (currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}
