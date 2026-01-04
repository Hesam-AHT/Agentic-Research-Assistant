/**
 * Reference Processor - Process downloaded reference PDFs with GROBID
 * Extract structured sections to create multiple evidence chunks per paper
 */

import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import { parseSectionsFromGrobidXML } from "./sections-parser";

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
    console.log(`\n[RefProcessor]  Processing reference: "${citation.title}"`);
    console.log(`[RefProcessor]  PDF: ${path.basename(pdfPath)}`);

    const grobidUrl = process.env.GROBID_URL || "http://localhost:8070";

    // Check cache first
    const pdfBasename = path.basename(pdfPath, '.pdf');
    const cacheDir = "grobid-output";
    const cacheFile = path.join(cacheDir, `${pdfBasename}_fulltext.xml`);

    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }

    let xmlText = "";

    // Try to load from cache
    if (fs.existsSync(cacheFile)) {
        console.log(`[RefProcessor]  Using cached GROBID XML`);
        xmlText = fs.readFileSync(cacheFile, "utf-8");
    } else {
        // Process with GROBID
        console.log(`[RefProcessor]  Running GROBID processFulltextDocument...`);

        try {
            const fileBuffer = fs.readFileSync(pdfPath);
            const formData = new FormData();
            formData.append("input", fileBuffer, {
                filename: path.basename(pdfPath),
                contentType: "application/pdf"
            });

            const startTime = Date.now();
            const response = await axios.post(
                `${grobidUrl}/api/processFulltextDocument`,
                formData,
                {
                    headers: formData.getHeaders(),
                    timeout: 120000, // 2 minutes for full document
                }
            );
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);

            xmlText = response.data;
            console.log(`[RefProcessor]  GROBID completed in ${duration}s`);

            // Cache it
            fs.writeFileSync(cacheFile, xmlText);
            console.log(`[RefProcessor]  Cached to ${cacheFile}`);
        } catch (error) {
            console.error(`[RefProcessor]  GROBID failed:`, error);

            // Fallback: return single chunk with title+abstract
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

    // Parse sections from XML
    console.log(`[RefProcessor]  Parsing sections from XML...`);
    const sections = parseSectionsFromGrobidXML(xmlText);
    console.log(`[RefProcessor]  Extracted ${sections.length} sections`);

    // Create Evidence chunks
    const chunks: Evidence[] = sections.map((section, index) => {
        console.log(`[RefProcessor]   ✓ ${section.section}: ${section.text.length} chars`);

        return {
            title: citation.title,
            authors: citation.authors,
            year: citation.year,
            journal: citation.journal || "N/A",
            doi: citation.doi,
            arxiv_id: citation.arxiv_id,
            text: section.text,
            source_type: "pdf",
            section: section.section,
            chunk_id: `ref_${refIndex}_${index}`,
            is_main_paper: false
        };
    });

    console.log(`[RefProcessor]  Created ${chunks.length} evidence chunks for "${citation.title}"\n`);

    return chunks;
}
