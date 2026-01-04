import { GlobalMemory } from "../memory/GlobalMemory.js";

/**
 * Represents a single conversation exchange
 */
export interface ChatExchange {
    question: string;
    answer: string;
    citations: any[];
    timestamp: string;
}

/**
 * Chat history data structure
 */
interface ChatHistoryData {
    exchanges: ChatExchange[];
    maxHistory: number;
}

/**
 * Manages chat history for a session
 * Stores conversation exchanges in GlobalMemory
 */
export class ChatHistory {
    private sessionId: string;
    private memory: GlobalMemory;
    private maxHistory: number;

    constructor(sessionId: string, maxHistory: number = 10) {
        this.sessionId = sessionId;
        this.memory = new GlobalMemory(sessionId);
        this.maxHistory = maxHistory;
    }

    /**
     * Add a new exchange to chat history
     */
    async addExchange(exchange: ChatExchange): Promise<void> {
        const history = await this.loadHistory();

        // Add new exchange
        history.exchanges.push(exchange);

        // Trim to max history size (keep most recent)
        if (history.exchanges.length > this.maxHistory) {
            history.exchanges = history.exchanges.slice(-this.maxHistory);
        }

        await this.saveHistory(history);
    }

    /**
     * Get recent chat history
     * @param limit Number of recent exchanges to retrieve (default: all)
     */
    async getHistory(limit?: number): Promise<ChatExchange[]> {
        const history = await this.loadHistory();

        if (limit && limit < history.exchanges.length) {
            return history.exchanges.slice(-limit);
        }

        return history.exchanges;
    }

    /**
     * Format chat history for LLM context
     * @param limit Number of recent exchanges to include
     */
    async getFormattedHistory(limit: number = 3): Promise<string> {
        const exchanges = await this.getHistory(limit);

        if (exchanges.length === 0) {
            return "";
        }

        let formatted = "Previous conversation:\n";
        for (let i = 0; i < exchanges.length; i++) {
            const ex = exchanges[i];
            formatted += `\nQ${i + 1}: ${ex.question}\n`;
            formatted += `A${i + 1}: ${ex.answer.substring(0, 300)}${ex.answer.length > 300 ? "..." : ""}\n`;
        }

        return formatted;
    }

    /**
     * Get number of exchanges in history
     */
    async size(): Promise<number> {
        const history = await this.loadHistory();
        return history.exchanges.length;
    }

    /**
     * Clear all chat history for this session
     */
    async clear(): Promise<void> {
        await this.memory.write("chat_history", {
            exchanges: [],
            maxHistory: this.maxHistory
        });
    }

    /**
     * Load history from GlobalMemory
     */
    private async loadHistory(): Promise<ChatHistoryData> {
        const data = await this.memory.read("chat_history");

        if (!data) {
            return {
                exchanges: [],
                maxHistory: this.maxHistory
            };
        }

        return data as ChatHistoryData;
    }

    /**
     * Save history to GlobalMemory
     */
    private async saveHistory(history: ChatHistoryData): Promise<void> {
        await this.memory.write("chat_history", history);
    }
}
