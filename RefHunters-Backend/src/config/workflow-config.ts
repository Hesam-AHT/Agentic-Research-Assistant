export const WORKFLOW_CONFIG = {
    chatHistory: {
        maxExchanges: 3,
        maxStoredMessages: 10,
    },
    retrieval: {
        topN: {
            default: 12,
            summary: 2,
        },
        topK: {
            default: 8,
            semanticSearch: 40,
        },
    },
    memory: {
        workingDataTTL: 60 * 60 * 24 * 7, // 7 days (seconds)
    },
    agents: {
        a1: {
            maxIterations: 15,
        },
        a2: {
            maxIterations: 10,
        },
    },
} as const;
