/**
 * Robustly parse JSON from an LLM response that might contain markdown formatting.
 */
export function parseLLMJson<T>(content: string): T {
    let cleaned = content.trim();

    // Remove markdown code block markers
    cleaned = cleaned.replace(/```json\n?/g, "").replace(/```/g, "").trim();

    try {
        return JSON.parse(cleaned) as T;
    } catch (e) {
        // If standard parsing fails, try to find the first '{' or '[' and the last '}' or ']'
        const startBrace = cleaned.indexOf("{");
        const startBracket = cleaned.indexOf("[");
        const endBrace = cleaned.lastIndexOf("}");
        const endBracket = cleaned.lastIndexOf("]");

        let start = -1;
        let end = -1;

        // Determine if it's an object or array based on which comes first/last
        if (startBrace !== -1 && (startBracket === -1 || startBrace < startBracket)) {
            start = startBrace;
            end = endBrace;
        } else if (startBracket !== -1) {
            start = startBracket;
            end = endBracket;
        }

        if (start !== -1 && end !== -1 && end > start) {
            const extracted = cleaned.substring(start, end + 1);
            try {
                return JSON.parse(extracted) as T;
            } catch (innerError) {
                console.error("[parseLLMJson] Failed to parse extracted JSON:", innerError);
                console.error("[parseLLMJson] Extracted content:", extracted);
                throw innerError;
            }
        }

        console.error("[parseLLMJson] Could not find JSON structures in content.");
        console.error("[parseLLMJson] Original content:", content);
        throw e;
    }
}
