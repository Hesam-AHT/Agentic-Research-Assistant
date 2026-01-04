import { A0State } from "../types/workflow-types.js";
import { withErrorBoundary } from "../utils/error-handler.js";
import { decomposeQuery } from "../agents/a0/a0-decomposer.js";

export async function decomposeNode(state: A0State): Promise<Partial<A0State>> {
    return withErrorBoundary("decompose", async () => {
        const result = await decomposeQuery(state.userInput, state.brain!);
        return {
            decomposition: { subquestions: result.subquestions },
            trace: [...(state.trace || []), "DECOMPOSE"]
        };
    }, {
        decomposition: { subquestions: [state.userInput] },
        trace: [...(state.trace || []), "DECOMPOSE (FALLBACK)"]
    });
}
