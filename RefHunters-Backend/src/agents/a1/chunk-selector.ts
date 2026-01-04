/**
 * Smart Chunk Selector - Filter evidence chunks based on query relevance
 * Only send relevant sections to A2 to reduce tokens and improve precision
 */

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface Evidence {
  title: string;
  section?: string;
  chunk_id?: string;
  text: string;
  is_main_paper?: boolean;
}

/**
 * Select only relevant chunks from main paper based on query
 * @param allChunks All available evidence chunks
 * @param query User's question
 * @param maxChunks Maximum chunks to return (default: 5)
 * @returns Filtered chunks most relevant to query
 */
export async function selectRelevantChunks(
  allChunks: Evidence[],
  query: string,
  maxChunks: number = 5
): Promise<Evidence[]> {
  
  console.log(`\n[ChunkSelector]  Selecting relevant chunks for query`);
  console.log(`[ChunkSelector]  Total chunks available: ${allChunks.length}`);
  console.log(`[ChunkSelector]  Query: "${query}"`);
  
  // Separate main paper and references
  const mainChunks = allChunks.filter(e => e.is_main_paper);
  const refChunks = allChunks.filter(e => !e.is_main_paper);
  
  console.log(`[ChunkSelector]  Main paper chunks: ${mainChunks.length}`);
  console.log(`[ChunkSelector]  Reference chunks: ${refChunks.length}`);
  
  // If few main chunks, include all
  if (mainChunks.length <= maxChunks) {
    console.log(`[ChunkSelector]  Using all ${mainChunks.length} main chunks + ${refChunks.length} references`);
    return allChunks;
  }
  
  // Create section list for GPT
  const sectionList = mainChunks
    .map((c, i) => `${i}. ${c.section || 'Unknown'} (${c.chunk_id}) - ${c.text.substring(0, 100)}...`)
    .join('\n');
  
  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a research assistant. Select the most relevant paper sections to answer a question.
Return ONLY the indices (numbers) of relevant sections, comma-separated.
Example: "0,3,7,12"`
        },
        {
          role: "user",
          content: `Question: "${query}"

Available sections:
${sectionList}

Select the TOP ${maxChunks} most relevant section indices to answer this question.
Return only numbers, comma-separated (e.g., "0,3,7").`
        }
      ],
      temperature: 0,
      max_tokens: 100
    });
    
    const selectedIndicesStr = response.choices[0].message.content?.trim() || "";
    const selectedIndices = selectedIndicesStr
      .split(',')
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n) && n >= 0 && n < mainChunks.length);
    
    console.log(`[ChunkSelector]  Selected ${selectedIndices.length} main chunks: [${selectedIndices.join(', ')}]`);
    
    const selectedMainChunks = selectedIndices.map(i => mainChunks[i]);
    
    // Log selected sections
    selectedMainChunks.forEach(c => {
      console.log(`[ChunkSelector]   ✓ ${c.section} (${c.chunk_id})`);
    });
    
    // Combine with ALL references (they're already filtered)
    const result = [...selectedMainChunks, ...refChunks];
    console.log(`[ChunkSelector]  Final evidence: ${selectedMainChunks.length} main + ${refChunks.length} refs = ${result.length} total\n`);
    
    return result;
    
  } catch (error) {
    console.error(`[ChunkSelector]  Selection failed, using all chunks:`, error);
    return allChunks;
  }
}
