import { A0State } from "../types/workflow-types.js";
import { withErrorBoundary } from "../utils/error-handler.js";
import { classifyQuery } from "../agents/a0/a0-brain.js";

export async function classifyNode(state: A0State): Promise<Partial<A0State>> {
    return withErrorBoundary("classify", async () => {
        const brain = await classifyQuery(state.userInput, state.chatHistory);
        return {
            brain: brain as any,
            trace: [...(state.trace || []), "CLASSIFY"]
        };
    }, {
        brain: {
            task_type: "qa",
            complexity: "moderate",
            expertise: "intermediate",
            keywords: [],
            filtering_strategy: "keyword",
            focus_sections: [],
            needs_citations: true
        },
        trace: [...(state.trace || []), "CLASSIFY (FALLBACK)"]
    });
}
