import OpenAI from "openai";

/**
 * SessionVectorStore - In-memory vector search for semantic chunk retrieval
 * Uses OpenAI embeddings and cosine similarity
 */

export interface VectorChunk {
    chunk_id: string;
    text: string;
    embedding: number[];
    metadata: any; // Full Evidence object
}

export class SessionVectorStore {
    private chunks: Map<string, VectorChunk> = new Map();
    private openai: OpenAI;

    constructor(apiKey: string) {
        this.openai = new OpenAI({ apiKey });
    }

    /**
     * Add chunks with embeddings
     * Generates embeddings in batches for efficiency
     */
    async addChunks(evidence: any[]): Promise<void> {
        if (evidence.length === 0) {
            console.log("[VectorStore] No chunks to embed");
            return;
        }

        console.log(`[VectorStore]  Generating embeddings for ${evidence.length} chunks...`);
        const startTime = Date.now();

        // Prepare texts (combine title + section + text for better context)
        const texts = evidence.map(e => {
            const parts = [
                e.title || "",
                e.section ? `Section: ${e.section}` : "",
                e.text || ""
            ].filter(Boolean);
            return parts.join("\n").slice(0, 8000); // OpenAI limit
        });

        // Generate embeddings in batches (max 100 per request)
        const batchSize = 100;
        let totalEmbedded = 0;

        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);

            try {
                const response = await this.openai.embeddings.create({
                    model: "text-embedding-3-small",
                    input: batch,
                });

                response.data.forEach((item, idx) => {
                    const chunkIdx = i + idx;
                    const chunk_id = evidence[chunkIdx].chunk_id || `chunk_${chunkIdx}`;

                    this.chunks.set(chunk_id, {
                        chunk_id,
                        text: texts[chunkIdx],
                        embedding: item.embedding,
                        metadata: evidence[chunkIdx],
                    });
                    totalEmbedded++;
                });

                console.log(`[VectorStore] ✓ Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} embeddings`);
            } catch (error) {
                console.error(`[VectorStore]  Embedding batch failed:`, error);
                throw error;
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[VectorStore]  Generated ${totalEmbedded} embeddings in ${duration}s`);
    }

    /**
     * Extract potential method names and key terms from query
     */
    private extractKeywords(text: string): string[] {
        const words = text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3);

        // Extract potential method/model names (e.g., "GLNet", "ResNet")
        const methodNames = words.filter(w =>
            w.endsWith('net') || w.endsWith('cnn') || w.endsWith('rcnn') || w.includes('mag')
        );

        return [...new Set(methodNames)];
    }

    /**
     * Query for most relevant chunks using semantic similarity
     */
    async query(queryText: string, topK: number = 8): Promise<any[]> {
        if (this.chunks.size === 0) {
            console.log("[VectorStore]  No chunks to query");
            return [];
        }

        console.log(`[VectorStore]  Querying for top ${topK} chunks...`);
        const startTime = Date.now();

        // Embed query
        const response = await this.openai.embeddings.create({
            model: "text-embedding-3-small",
            input: queryText,
        });
        const queryEmbedding = response.data[0].embedding;

        // Calculate cosine similarity for all chunks
        const scores: { chunk_id: string; score: number; title: string; section?: string }[] = [];

        for (const [chunk_id, chunk] of this.chunks) {
            const score = this.cosineSimilarity(queryEmbedding, chunk.embedding);
            scores.push({
                chunk_id,
                score,
                title: chunk.metadata.title,
                section: chunk.metadata.section,
            });
        }

        // CRITICAL FIX: Always prioritize main paper chunks!
        const queryKeywords = this.extractKeywords(queryText);
        if (queryKeywords.length > 0) {
            console.log(`[VectorStore]  Detected method keywords: ${queryKeywords.join(', ')}`);

            for (const scoreItem of scores) {
                const chunk = this.chunks.get(scoreItem.chunk_id)!;
                const titleLower = chunk.metadata.title.toLowerCase();
                const textLower = (chunk.metadata.text || '').toLowerCase();
                const isMainPaper = chunk.metadata.is_main_paper === true;

                // PRIORITY 1: Slight boost for main paper (reduced from 0.5 to 0.15)
                if (isMainPaper) {
                    scoreItem.score += 0.15; // Reduced boost for better reference inclusion
                    console.log(`[VectorStore]  +0.15 boost: Main Paper - "${chunk.metadata.title.slice(0, 40)}..."`);
                }

                // PRIORITY 2: Penalize generic/Wikipedia content (NOT academic references!)
                if (!isMainPaper) {
                    const isGeneric = titleLower.includes('what is') ||
                        titleLower.includes('introduction to') ||
                        textLower.includes('wikipedia');

                    if (isGeneric) {
                        scoreItem.score -= 0.3;
                        console.log(`[VectorStore]  -0.3 penalty: Generic content - "${chunk.metadata.title.slice(0, 40)}..."`);
                    }
                }
            }
        } else {
            // Even without keywords, slight boost for main paper
            for (const scoreItem of scores) {
                const chunk = this.chunks.get(scoreItem.chunk_id)!;
                if (chunk.metadata.is_main_paper === true) {
                    scoreItem.score += 0.15;
                }
            }
        }

        // Sort by score (highest first) and return top-K
        scores.sort((a, b) => b.score - a.score);
        const topResults = scores.slice(0, topK);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[VectorStore]  Query completed in ${duration}s`);
        console.log(`[VectorStore]  Top ${topK} results:`);
        topResults.forEach((r, i) => {
            const sectionInfo = r.section ? ` - ${r.section}` : "";
            console.log(`   ${i + 1}. ${r.title.slice(0, 50)}...${sectionInfo} (score: ${r.score.toFixed(3)})`);
        });

        return topResults.map(s => this.chunks.get(s.chunk_id)!.metadata);
    }

    /**
     * Calculate cosine similarity between two vectors
     */
    private cosineSimilarity(a: number[], b: number[]): number {
        let dot = 0;
        let magA = 0;
        let magB = 0;

        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            magA += a[i] * a[i];
            magB += b[i] * b[i];
        }

        return dot / (Math.sqrt(magA) * Math.sqrt(magB));
    }

    /**
     * Get total number of chunks stored
     */
    size(): number {
        return this.chunks.size;
    }

    /**
   * Clear all stored chunks
   */
    clear(): void {
        this.chunks.clear();
    }

    /**
     * Export embeddings data for JSON storage (no OpenAI client)
     */
    toJSON(): any {
        const chunks: any[] = [];
        for (const [chunk_id, chunk] of this.chunks) {
            chunks.push({
                chunk_id,
                text: chunk.text,
                embedding: chunk.embedding,
                metadata: chunk.metadata,
            });
        }
        return { chunks };
    }

    /**
     * Import embeddings from JSON data
     */
    static fromJSON(data: any, apiKey: string): SessionVectorStore {
        const store = new SessionVectorStore(apiKey);
        if (data && data.chunks) {
            for (const chunk of data.chunks) {
                store.chunks.set(chunk.chunk_id, {
                    chunk_id: chunk.chunk_id,
                    text: chunk.text,
                    embedding: chunk.embedding,
                    metadata: chunk.metadata,
                });
            }
        }
        return store;
    }
}
