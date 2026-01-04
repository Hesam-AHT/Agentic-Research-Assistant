import { A0State } from "../types/workflow-types.js";
import { GlobalMemory } from "../memory/GlobalMemory.js";
import { ChatHistory } from "../utils/ChatHistory.js";
import { withErrorBoundary } from "../utils/error-handler.js";
import { WORKFLOW_CONFIG } from "../config/workflow-config.js";

export async function exitNode(state: A0State): Promise<Partial<A0State>> {
    return withErrorBoundary("exit", async () => {
        const mem = new GlobalMemory(state.sessionId);
        const chatHistory = new ChatHistory(state.sessionId, WORKFLOW_CONFIG.chatHistory.maxStoredMessages);

        // Save current exchange to chat history
        if (state.userInput && state.answer) {
            await chatHistory.addExchange({
                question: state.userInput,
                answer: state.answer,
                citations: state.citations || [],
                timestamp: new Date().toISOString(),
            });
        }

        // Save working state for session persistence
        await mem.write("working", {
            last_query: state.userInput,
            last_answer: state.answer,
            last_citations: state.citations,
        }, WORKFLOW_CONFIG.memory.workingDataTTL);

        return {
            trace: [...(state.trace || []), "EXIT"]
        };
    });
}
