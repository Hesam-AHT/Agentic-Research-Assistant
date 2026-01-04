/**
 * Parse sections from GROBID full document XML
 * Extracts: Abstract, Introduction, Methods, Results, Discussion, Conclusion, etc.
 */
export function parseSectionsFromGrobidXML(xml: string): Array<{ section: string, text: string, page?: number }> {
    console.log(`[A1] Parsing sections from GROBID XML...`);

    const sections: Array<{ section: string, text: string, page?: number }> = [];

    // Helper to extract page number from coords attribute
    const extractPageNumber = (xmlContent: string): number | undefined => {
        // GROBID uses coords="1,100,200,300,400" where first number is page
        const coordsMatch = xmlContent.match(/coords="(\d+)/);
        if (coordsMatch) {
            return parseInt(coordsMatch[1]);
        }
        return undefined;
    };

    try {
        // Extract abstract
        const abstractMatch = xml.match(/<abstract[^>]*>([\s\S]*?)<\/abstract>/i);
        if (abstractMatch) {
            // Remove XML tags but keep text
            const abstractText = abstractMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (abstractText.length > 50) {
                const page = extractPageNumber(abstractMatch[0]);
                sections.push({ section: 'Abstract', text: abstractText, page });
                console.log(`[A1]   ✓ Abstract: ${abstractText.length} chars (page ${page || '?'})`);
            }
        }

        // Extract body sections (div with type="introduction", "methods", etc.)
        const bodyMatch = xml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch) {
            const bodyContent = bodyMatch[1];

            // Find all div elements with head tags
            const divMatches = bodyContent.matchAll(/<div[^>]*>([\s\S]*?)<\/div>/gi);

            for (const divMatch of divMatches) {
                const divContent = divMatch[1];

                // Extract section heading
                const headMatch = divContent.match(/<head[^>]*>([^<]+)<\/head>/i);
                if (headMatch) {
                    const sectionName = headMatch[1].trim();

                    // Extract section text (remove XML tags)
                    const sectionText = divContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

                    if (sectionText.length > 100) {
                        // Try to get page number from div or head element
                        const page = extractPageNumber(divMatch[0]);
                        sections.push({ section: sectionName, text: sectionText, page });
                        console.log(`[A1]   ✓ ${sectionName}: ${sectionText.length} chars (page ${page || '?'})`);
                    }
                }
            }
        }

        console.log(`[A1]  Extracted ${sections.length} sections total`);

        // FALLBACK: If no pages were extracted, estimate them
        const hasPages = sections.some(section => section.page !== undefined);
        if (!hasPages && sections.length > 0) {
            console.log('[A1]  No page numbers found in GROBID XML, estimating...');
            // Estimate: Abstract on page 1, subsequent sections spread across remaining pages
            sections.forEach((section, idx) => {
                if (section.section === 'Abstract') {
                    section.page = 1;
                } else {
                    // Estimate 1-2 pages per section
                    section.page = Math.floor(idx / 2) + 1;
                }
                console.log(`[A1]    Estimated ${section.section} → page ${section.page}`);
            });
        }
    } catch (error) {
        console.error("[A1]  Failed to parse sections:", error);
    }

    return sections;
}
