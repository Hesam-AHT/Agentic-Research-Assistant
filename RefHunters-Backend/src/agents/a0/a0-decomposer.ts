/**
 * A0 Query Decomposer
 * SIMPLIFIED: No longer splits queries - just clarifies the original query
 * All keywords come from A0 Brain, handled by A1 in a single retrieve task
 */

import { BrainOutput } from "./a0-brain.js";

export interface DecompositionOutput {
    subquestions: string[];
    strategy: "parallel" | "sequential";
    reasoning: string;
}

/**
 * SIMPLIFIED: Returns a single, clear question based on the original query and keywords
 * A0 Brain provides keywords, A1 handles all filtering in one task
 */
export async function decomposeQuery(
    query: string,
    brain: BrainOutput
): Promise<DecompositionOutput> {

    console.log(`\n[A0 Decomposer] Processing query...`);

    // Filter out MagNet/Magnet and generic words from keywords list for display
    const genericWords = ['comparison', 'compare', 'difference', 'similar', 'explain', 'describe', 'magnet'];
    const entidades = brain.keywords.filter(k => !genericWords.includes(k.toLowerCase()));

    // Construct a "clearer" single question
    let clearerQuestion = query;
    if (entidades.length > 0) {
        clearerQuestion = `Detailed information about ${entidades.join(' and ')} for the query: ${query}`;
    }

    console.log(`[A0 Decomposer] ✓ Single question mode (A1 handles all keywords)`);
    console.log(`[A0 Decomposer]   1. ${clearerQuestion}`);

    return {
        subquestions: [clearerQuestion],
        strategy: "parallel",
        reasoning: `Single clarified question for deterministic retrieval of entities: ${entidades.join(', ')}`
    };
}
