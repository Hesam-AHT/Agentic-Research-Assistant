import { SessionVectorStore } from "./SessionVectorStore.js";
import { GlobalMemory } from "../memory/GlobalMemory.js";
import { WORKFLOW_CONFIG } from "../config/workflow-config.js";

export class EvidenceAggregator {
    async aggregateFromResults(
        results: Record<string, any>,
        sessionId: string,
        query: string
    ): Promise<any[]> {
        const memory = new GlobalMemory(sessionId);
        const allChunks: any[] = [];
        const allVectorData = { chunks: [] as any[] };

        // Collect all evidence and vector data from retrieve tasks
        for (const taskId in results) {
            const cleanTaskId = taskId.trim();
            if (cleanTaskId.startsWith("retrieve_")) {
                const taskResult = results[taskId];
                if (taskResult?.evidence) {
                    allChunks.push(...taskResult.evidence);
                }

                const taskVectorData = await memory.read(`vector_store_data_${cleanTaskId}`);
                if (taskVectorData?.chunks) {
                    console.log(`[EvidenceAggregator] Loaded ${taskVectorData.chunks.length} embeddings from ${cleanTaskId}`);
                    allVectorData.chunks.push(...taskVectorData.chunks);
                }
            }
        }

        if (allVectorData.chunks.length > 0) {
            console.log(`[EvidenceAggregator] Reconstructing unified vector store from ${allVectorData.chunks.length} chunks`);
            const vectorStore = SessionVectorStore.fromJSON(allVectorData, process.env.OPENAI_API_KEY!);

            const topK = WORKFLOW_CONFIG.retrieval.topK.semanticSearch;
            const relevantChunks = await vectorStore.query(query, topK);

            console.log(`[EvidenceAggregator] Semantic search: ${allChunks.length} total → ${relevantChunks.length} most relevant`);
            return relevantChunks;
        } else {
            // Fallback: use first 20 chunks if no vector store
            const limitedChunks = allChunks.slice(0, 20);
            console.log(`[EvidenceAggregator] Fallback: ${allChunks.length} total → ${limitedChunks.length} chunks (no vector store)`);
            return limitedChunks;
        }
    }
}
