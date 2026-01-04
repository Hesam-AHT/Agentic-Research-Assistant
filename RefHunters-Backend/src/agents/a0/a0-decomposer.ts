/**
 * A0 Query Decomposer
 * Breaks complex queries into sub-questions for parallel processing
 */

import OpenAI from "openai";
import { BrainOutput } from "./a0-brain.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface DecompositionOutput {
    subquestions: string[];
    strategy: "parallel" | "sequential";
    reasoning: string;
}

/**
 * Decompose complex queries into sub-questions
 */
export async function decomposeQuery(
    query: string,
    brain: BrainOutput
): Promise<DecompositionOutput> {

    console.log(`\n[A0 Decomposer] Analyzing query...`);

    // Simple queries don't need decomposition
    if (brain.complexity === "simple") {
        console.log(`[A0 Decomposer] ✓ Simple query, no split needed`);
        return {
            subquestions: [query],
            strategy: "parallel",
            reasoning: "Simple query, answer directly"
        };
    }

    try {
        const response = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `Break complex research questions into sub-questions.

Rules:
- If query asks ONE thing → keep as is
- If query asks MULTIPLE things → split them
- Each sub-question must be independently answerable
- Max 5 sub-questions

Examples:
"Compare MagNet and SegNet" → ["What is MagNet?", "What is SegNet?", "How do they differ?"]
"What is MagNet?" → ["What is MagNet?"]
"Explain MagNet architecture and performance" → ["What is MagNet architecture?", "How does MagNet perform?"]`
                },
                {
                    role: "user",
                    content: `Query: "${query}"\nTask: ${brain.task_type}\nComplexity: ${brain.complexity}`
                }
            ],
            functions: [
                {
                    name: "decompose",
                    parameters: {
                        type: "object",
                        properties: {
                            subquestions: {
                                type: "array",
                                items: { type: "string" },
                                description: "List of sub-questions (or [original] if no split needed)"
                            },
                            strategy: {
                                type: "string",
                                enum: ["parallel", "sequential"],
                                description: "Can sub-questions be answered in parallel?"
                            },
                            reasoning: {
                                type: "string",
                                description: "Why this decomposition?"
                            }
                        },
                        required: ["subquestions", "strategy", "reasoning"]
                    }
                }
            ],
            function_call: { name: "decompose" },
            temperature: 0
        });

        const args = response.choices[0].message.function_call?.arguments;
        if (!args) throw new Error("No decomposition returned");

        const decomposition: DecompositionOutput = JSON.parse(args);

        console.log(`[A0 Decomposer] ✓ ${decomposition.subquestions.length} sub-questions (${decomposition.strategy})`);
        decomposition.subquestions.forEach((q, i) => {
            console.log(`[A0 Decomposer]   ${i + 1}. ${q}`);
        });

        return decomposition;

    } catch (error) {
        console.error(`[A0 Decomposer] ✗ Decomposition failed:`, error);
        console.log(`[A0 Decomposer] Using fallback (no split)`);
        return {
            subquestions: [query],
            strategy: "parallel",
            reasoning: "Fallback due to error"
        };
    }
}
