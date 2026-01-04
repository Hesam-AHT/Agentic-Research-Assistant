/**
 * Citation Extractor - Parse GROBID XML to extract citations from specific sections
 * Used for section-aware citation filtering
 */

/**
 * Extract citation markers from a specific section in GROBID XML
 * @param xml Full GROBID XML document
 * @param sectionName Target section name (e.g., "Related Work", "Introduction")
 * @returns Array of citation IDs like ["b0", "b4", "b12"]
 */
export function extractCitationMarkersFromSection(
    xml: string,
    sectionName: string
): string[] {
    console.log(`[CitationExtractor]  Extracting citations from "${sectionName}" section`);

    const citationIds = new Set<string>();

    try {
        // Find the target section in XML
        // GROBID structure: <div><head>Section Name</head>...<ref type="bibr" target="#b4">...
        const sectionRegex = new RegExp(
            `<div[^>]*>\\s*<head[^>]*>${sectionName}</head>([\\s\\S]*?)</div>`,
            'i'
        );

        const sectionMatch = xml.match(sectionRegex);

        if (!sectionMatch) {
            console.log(`[CitationExtractor]   Section "${sectionName}" not found in XML`);
            return [];
        }

        const sectionContent = sectionMatch[1];
        console.log(`[CitationExtractor]  Found section "${sectionName}" (${sectionContent.length} chars)`);

        // Extract all citation markers from this section
        // Pattern: <ref type="bibr" target="#b12">
        const citationRegex = /<ref\s+type="bibr"\s+target="#(b\d+)"/g;
        let match;

        while ((match = citationRegex.exec(sectionContent)) !== null) {
            citationIds.add(match[1]);
        }

        console.log(`[CitationExtractor]  Found ${citationIds.size} unique citations in "${sectionName}"`);
        console.log(`[CitationExtractor]  Citation IDs:`, Array.from(citationIds).sort());

        return Array.from(citationIds);
    } catch (error) {
        console.error(`[CitationExtractor]  Error extracting citations:`, error);
        return [];
    }
}

/**
 * Map citation IDs (e.g., "b4") to actual Citation objects
 * GROBID uses <biblStruct xml:id="b4"> for each citation
 * @param citationIds Array of IDs like ["b0", "b4"]
 * @param xml Full GROBID XML with biblStruct elements
 * @returns Citation indices (0-based) matching the IDs
 */
export function mapCitationIdsToIndices(
    citationIds: string[],
    xml: string
): number[] {
    console.log(`[CitationExtractor]   Mapping ${citationIds.length} citation IDs to indices`);

    const indices: number[] = [];

    try {
        // Extract all biblStruct elements with their xml:id
        const biblStructRegex = /<biblStruct[^>]+xml:id="(b\d+)"/g;
        const allBiblStructs: string[] = [];
        let match;

        while ((match = biblStructRegex.exec(xml)) !== null) {
            allBiblStructs.push(match[1]);
        }

        console.log(`[CitationExtractor] Total biblStruct elements: ${allBiblStructs.length}`);

        // Map each citation ID to its index
        citationIds.forEach(id => {
            const index = allBiblStructs.indexOf(id);
            if (index !== -1) {
                indices.push(index);
            } else {
                console.warn(`[CitationExtractor]   Citation ID "${id}" not found in biblStruct list`);
            }
        });

        console.log(`[CitationExtractor]  Mapped to indices:`, indices.sort((a, b) => a - b));

        return indices.sort((a, b) => a - b);
    } catch (error) {
        console.error(`[CitationExtractor]  Error mapping citation IDs:`, error);
        return [];
    }
}
