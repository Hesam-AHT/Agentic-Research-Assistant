/**
 * A0 Brain - Query Classification
 * Analyzes user queries to determine task type, complexity, and search strategy
 */

import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface BrainOutput {
    task_type: "qa" | "summarize" | "compare" | "explain";
    expertise: "novice" | "intermediate" | "expert";
    needs_citations: boolean;
    complexity: "simple" | "moderate" | "complex";
    keywords: string[];
    focus_sections?: string[];
    filtering_strategy?: "section" | "keyword" | "hybrid";
    reasoning?: string;
}

/**
 * Classify user query using GPT-4o-mini
 */
export async function classifyQuery(query: string, chatHistory?: string): Promise<BrainOutput> {
    console.log(`\n[A0 Brain] Classifying: "${query}"`);

    try {
        const response = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `Classify research queries. Extract:
1. Task type (qa/summarize/compare/explain)
2. User expertise (novice/intermediate/expert)
3. Complexity (simple/moderate/complex)
4. Keywords (technical terms for search)
5. Filtering strategy:
   - "section": User wants papers FROM a specific section (e.g., "related work")
   - "keyword": User wants papers ABOUT specific topics
   - "hybrid": Both section AND keywords

Examples:
- "What is MagNet?" → qa, simple, keywords: ["MagNet", "architecture"]
- "Compare MagNet with SegNet" → compare, moderate, keywords: ["MagNet", "SegNet", "comparison"]
- "Summarize related work" → summarize, simple, section filtering, focus: ["Related Work"]`
                },
                {
                    role: "user",
                    content: chatHistory
                        ? `${chatHistory}\n\nCurrent: ${query}`
                        : query
                }
            ],
            functions: [
                {
                    name: "classify",
                    parameters: {
                        type: "object",
                        properties: {
                            task_type: {
                                type: "string",
                                enum: ["qa", "summarize", "compare", "explain"]
                            },
                            expertise: {
                                type: "string",
                                enum: ["novice", "intermediate", "expert"]
                            },
                            needs_citations: { type: "boolean" },
                            complexity: {
                                type: "string",
                                enum: ["simple", "moderate", "complex"]
                            },
                            keywords: {
                                type: "array",
                                items: { type: "string" },
                                description: "Technical terms for searching"
                            },
                            focus_sections: {
                                type: "array",
                                items: { type: "string" },
                                description: "Paper sections to prioritize"
                            },
                            filtering_strategy: {
                                type: "string",
                                enum: ["section", "keyword", "hybrid"]
                            },
                            reasoning: {
                                type: "string",
                                description: "Brief explanation"
                            }
                        },
                        required: ["task_type", "expertise", "needs_citations", "complexity", "keywords", "filtering_strategy"]
                    }
                }
            ],
            function_call: { name: "classify" },
            temperature: 0  // Deterministic classification
        });

        const args = response.choices[0].message.function_call?.arguments;
        if (!args) throw new Error("No classification returned");

        const brain: BrainOutput = JSON.parse(args);

        console.log(`[A0 Brain] ✓ ${brain.task_type} | ${brain.complexity} | ${brain.filtering_strategy}`);
        console.log(`[A0 Brain]   Keywords: ${brain.keywords.join(", ")}`);
        if (brain.focus_sections) {
            console.log(`[A0 Brain]   Sections: ${brain.focus_sections.join(", ")}`);
        }

        return brain;

    } catch (error) {
        console.error(`[A0 Brain] ✗ Classification failed:`, error);
        return fallbackClassification(query);
    }
}

/**
 * Fallback classification if GPT fails
 */
function fallbackClassification(query: string): BrainOutput {
    console.log(`[A0 Brain] Using fallback`);

    const lowerQuery = query.toLowerCase();
    const keywords = extractKeywords(query);

    // Detect task type
    let task_type: BrainOutput["task_type"] = "qa";
    if (lowerQuery.includes("compare") || lowerQuery.includes("versus") || lowerQuery.includes("vs")) {
        task_type = "compare";
    } else if (lowerQuery.includes("summarize") || lowerQuery.includes("summary")) {
        task_type = "summarize";
    } else if (lowerQuery.includes("explain") || lowerQuery.includes("how does")) {
        task_type = "explain";
    }

    // Detect complexity
    const complexity = keywords.length > 3 ? "moderate" : "simple";

    return {
        task_type,
        expertise: "intermediate",
        needs_citations: true,
        complexity,
        keywords,
        filtering_strategy: "keyword"
    };
}

/**
 * Extract keywords from query (simple heuristic)
 */
function extractKeywords(query: string): string[] {
    const stopWords = new Set([
        "what", "is", "are", "the", "a", "an", "how", "does", "do",
        "can", "could", "would", "should", "explain", "tell", "me", "about",
        "and", "or", "but", "in", "on", "at", "to", "for", "of", "with"
    ]);

    return query
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopWords.has(w))
        .filter((v, i, a) => a.indexOf(v) === i); // unique
}
