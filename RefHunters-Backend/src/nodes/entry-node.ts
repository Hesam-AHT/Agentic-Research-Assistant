import { A0State } from "../types/workflow-types.js";
import { GlobalMemory } from "../memory/GlobalMemory.js";
import { ChatHistory } from "../utils/ChatHistory.js";
import { withErrorBoundary } from "../utils/error-handler.js";
import { WORKFLOW_CONFIG } from "../config/workflow-config.js";

export async function entryNode(state: A0State): Promise<Partial<A0State>> {
    return withErrorBoundary("entry", async () => {
        const mem = new GlobalMemory(state.sessionId);
        const chatHistory = new ChatHistory(state.sessionId, WORKFLOW_CONFIG.chatHistory.maxStoredMessages);

        // Load recent conversation history
        const formattedHistory = await chatHistory.getFormattedHistory(WORKFLOW_CONFIG.chatHistory.maxExchanges);

        return {
            profile: (await mem.read("profile")) ?? {},
            blacklist: (await mem.read("blacklist")) ?? [],
            attempts: state.attempts ?? 0,
            trace: ["ENTRY"],
            chatHistory: formattedHistory,
        };
    });
}
