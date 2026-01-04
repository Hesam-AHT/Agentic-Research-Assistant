/**
 * FUZZY SECTION NAME MATCHING
 * Papers use different section names - this maps generic names to common variations
 */
function findMatchingSection(targetSection: string, actualSections: string[]): string | null {
    const target = targetSection.toLowerCase().trim();

    // 1. Direct exact match
    const direct = actualSections.find(s => s.toLowerCase().trim() === target);
    if (direct) {
        console.log(`[A1]  Exact section match: "${targetSection}" → "${direct}"`);
        return direct;
    }

    // 2. Fuzzy match with common variations
    const sectionMappings: Record<string, string[]> = {
        "related work": ["literature review", "background", "prior work", "previous work", "prior art", "related research"],
        "methods": ["methodology", "approach", "proposed method", "our method", "our approach", "technical approach"],
        "architecture": ["model", "network architecture", "framework", "proposed architecture", "model architecture", "network design"],
        "experiments": ["results", "empirical evaluation", "evaluation", "experimental results", "experimental evaluation"],
        "introduction": ["intro", "overview", "motivation"],
        "conclusion": ["conclusions", "concluding remarks", "summary", "discussion"],
    };

    const alternatives = sectionMappings[target] || [];
    for (const alt of alternatives) {
        const match = actualSections.find(s => s.toLowerCase().includes(alt));
        if (match) {
            console.log(`[A1]  Fuzzy section match: "${targetSection}" → "${match}" (via "${alt}")`);
            return match;
        }
    }

    // 3. Partial/substring match
    const partial = actualSections.find(s => {
        const sLower = s.toLowerCase();
        return sLower.includes(target) || target.includes(sLower);
    });

    if (partial) {
        console.log(`[A1]  Partial section match: "${targetSection}" → "${partial}"`);
        return partial;
    }

    console.log(`[A1]   No section match for "${targetSection}" in available sections: ${actualSections.join(", ")}`);
    return null;
}

/**
 * TWO-STEP KEYWORD RESOLUTION
 * Search main paper for keyword mentions, extract citation numbers, map to full titles
 */
async function findCitationsForKeywords(
    mainPaperChunks: any[],
    keywords: string[],
    grobidXml?: string
): Promise<Map<string, string[]>> {

    const keywordToCitations = new Map<string, string[]>();

    // Focus on sections likely to mention related work
    const searchSections = ["related work", "introduction", "background", "experiments", "results", "discussion", "literature review"];

    for (const keyword of keywords) {
        console.log(`[A1]  Searching main paper for keyword: "${keyword}"`);

        const citationNumbers: Set<string> = new Set();

        // Search relevant sections for keyword
        for (const chunk of mainPaperChunks) {
            const section = (chunk.section || "").toLowerCase();
            const text = chunk.text || "";

            // Skip if not a relevant section
            const isRelevantSection = searchSections.some(s => section.includes(s));
            if (!isRelevantSection && section) continue; // Only skip if has section and not relevant

            // Check if keyword appears in this chunk
            const keywordRegex = new RegExp(keyword, 'gi');
            if (!keywordRegex.test(text)) continue;

            console.log(`[A1]  Found "${keyword}" in section: ${chunk.section || 'unknown'}`);

            // Extract citation markers near the keyword
            const citations = extractCitationMarkersNearKeyword(text, keyword);
            citations.forEach(c => citationNumbers.add(c));
        }

        if (citationNumbers.size > 0) {
            console.log(`[A1]  Found ${citationNumbers.size} citation markers for "${keyword}": [${Array.from(citationNumbers).join(', ')}]`);

            // Map citation numbers to full titles
            const fullTitles = grobidXml
                ? mapCitationNumbersToTitles(Array.from(citationNumbers), grobidXml)
                : [];

            if (fullTitles.length > 0) {
                keywordToCitations.set(keyword, fullTitles);
                console.log(`[A1]  Mapped to ${fullTitles.length} full citation titles`);
            }
        } else {
            console.log(`[A1]   No citation markers found for "${keyword}" in main paper`);
        }
    }

    return keywordToCitations;
}

/**
 * Extract citation markers near a keyword in text
 */
function extractCitationMarkersNearKeyword(
    text: string,
    keyword: string,
    contextWindow: number = 300
): string[] {
    const markers: string[] = [];

    const keywordRegex = new RegExp(keyword, 'gi');
    let match;

    while ((match = keywordRegex.exec(text)) !== null) {
        const keywordPos = match.index;

        // Get context around keyword
        const start = Math.max(0, keywordPos - contextWindow);
        const end = Math.min(text.length, keywordPos + keyword.length + contextWindow);
        const context = text.substring(start, end);

        // Extract citation markers: [number] or [number, number] or [number-number]
        const numberCitations = context.match(/\[(\d+(?:\s*,\s*\d+)*|\d+\s*-\s*\d+)\]/g);
        if (numberCitations) {
            numberCitations.forEach(cite => {
                const numbers = cite.match(/\d+/g);
                if (numbers) markers.push(...numbers);
            });
        }
    }

    return [...new Set(markers)];
}

/**
 * Map citation numbers to full titles using GROBID XML
 */
function mapCitationNumbersToTitles(
    citationNumbers: string[],
    grobidXml: string
): string[] {
    const titles: string[] = [];

    // CRITICAL DEBUG
    console.log(`[A1]  mapCitationNumbersToTitles called`);
    console.log(`[A1]  Citation numbers:`, citationNumbers);
    console.log(`[A1]  grobidXml type: ${typeof grobidXml}, length: ${grobidXml?.length || 0}`);
    console.log(`[A1]  grobidXml is null: ${grobidXml === null}, undefined: ${grobidXml === undefined}`);

    if (!grobidXml || grobidXml.length === 0) {
        console.error(`[A1]  CRITICAL: grobidXml is ${grobidXml === null ? 'null' : grobidXml === undefined ? 'undefined' : 'empty'}!`);
        return [];
    }

    try {
        for (const num of citationNumbers) {
            // Try both 0-indexed and 1-indexed
            const id1 = `b${parseInt(num) - 1}`;
            const id2 = `b${num}`;

            const regex1 = new RegExp(`<biblStruct[^>]*xml:id="${id1}"[^>]*>([\\s\\S]*?)</biblStruct>`, 'i');
            const regex2 = new RegExp(`<biblStruct[^>]*xml:id="${id2}"[^>]*>([\\s\\S]*?)</biblStruct>`, 'i');

            const match = grobidXml.match(regex1) || grobidXml.match(regex2);

            if (match) {
                const biblStruct = match[1];

                // Try multiple title patterns - GROBID uses nested structures
                const titlePatterns = [
                    /<title[^>]*level="a"[^>]*>([^<]+)<\/title>/i,  // Article title
                    /<title[^>]*>([^<]+)<\/title>/i,  // Generic title with closing tag
                    /<title[^>]*>([^<]+)</i,  // Title without closing (fallback)
                ];

                let title = null;
                for (const pattern of titlePatterns) {
                    const titleMatch = biblStruct.match(pattern);
                    if (titleMatch) {
                        title = titleMatch[1].trim();
                        break;
                    }
                }

                if (title) {
                    console.log(`[A1] 🔗 Citation [${num}] → "${title.substring(0, 60)}..."`);
                    titles.push(title);
                } else {
                    console.log(`[A1]   No title found in biblStruct for citation [${num}]`);
                    // Log snippet for debugging
                    console.log(`[A1]  BiblStruct snippet: ${biblStruct.substring(0, 200)}...`);
                }
            } else {
                console.log(`[A1]   No biblStruct found for citation [${num}] (tried ids: ${id1}, ${id2})`);
            }
        }
    } catch (error) {
        console.error('[A1]   Error mapping citation numbers:', error);
    }

    return titles;
}

export { findMatchingSection, findCitationsForKeywords, extractCitationMarkersNearKeyword, mapCitationNumbersToTitles };
