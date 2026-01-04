/**
 * Reference Processor - Process downloaded reference PDFs with GROBID
 * Extract structured sections to create multiple evidence chunks per paper
 */

import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import { parseSectionsFromGrobidXML } from "./sections-parser";
import { extractTextFast, chunkText } from "./fast-pdf-parser";

export interface Citation {
    title: string;
    authors: string[];
    year: string;
    doi?: string;
    journal?: string;
    arxiv_id?: string;
}

export interface Evidence {
    title: string;
    authors: string[];
    year: string;
    journal: string;
    doi?: string;
    arxiv_id?: string;
    text: string;
    source_type: "pdf" | "abstract" | "metadata_only";
    section?: string;
    chunk_id?: string;
    page?: number;
    start_char?: number;
    end_char?: number;
    is_main_paper?: boolean;
}

/**
 * Extract full document structure from reference paper using GROBID
 * @param pdfPath Path to downloaded reference PDF
 * @param citation Citation metadata for this paper
 * @param refIndex Reference index (for chunk_id generation)
 * @returns Array of Evidence chunks (one per section)
 */
export async function processReferencePaper(
    pdfPath: string,
    citation: Citation,
    refIndex: number
): Promise<Evidence[]> {
    console.log(`\n[RefProcessor]  Fast-Processing reference: "${citation.title}"`);
    console.log(`[RefProcessor]  PDF: ${path.basename(pdfPath)}`);

    try {
        const startTime = Date.now();
        const fullText = await extractTextFast(pdfPath);

        if (!fullText || fullText.length < 100) {
            throw new Error("Extracted text is too short or empty");
        }

        const textChunks = chunkText(fullText);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[RefProcessor]  Fast-parsing completed in ${duration}s (${textChunks.length} chunks)`);

        // Create Evidence chunks
        const chunks: Evidence[] = textChunks.map((text, index) => ({
            title: citation.title,
            authors: citation.authors,
            year: citation.year,
            journal: citation.journal || "N/A",
            doi: citation.doi,
            arxiv_id: citation.arxiv_id,
            text: text,
            source_type: "pdf",
            section: index === 0 ? "Introduction/Abstract" : `Section ${index + 1}`,
            chunk_id: `ref_${refIndex}_${index}`,
            is_main_paper: false
        }));

        return chunks;
    } catch (error) {
        console.error(`[RefProcessor]  Fast-parsing failed, using minimal fallback:`, error);
        return [{
            title: citation.title,
            authors: citation.authors,
            year: citation.year,
            journal: citation.journal || "N/A",
            doi: citation.doi,
            arxiv_id: citation.arxiv_id,
            text: citation.title, // Minimal fallback
            source_type: "pdf",
            chunk_id: `ref_${refIndex}_0`,
            is_main_paper: false
        }];
    }
}
