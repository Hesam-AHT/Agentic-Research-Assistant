/**
 * API Type Definitions - Matches backend exactly
 */

export interface Evidence {
    text: string;
    source: string;
    authors: string[];
    year: string;
    section?: string;
    page?: number;
    source_type: 'pdf' | 'abstract' | 'metadata_only';
    doi?: string;
    arxiv_id?: string;
    journal?: string;
}

export interface Citation {
    index: number;
    formatted: string;
    title: string;
    authors: string[];
    year: string;
    section?: string;
    doi?: string;
    arxiv_id?: string;
    journal?: string;
    evidenceChunk?: {
        text: string;
        section: string;
        page?: number;
        is_main_paper?: boolean;  // True if from uploaded PDF, false if from references
    };
}

export interface QueryRequest {
    sessionId: string;
    question: string;
    sources: string[];
    expertise?: 'novice' | 'intermediate' | 'expert';
}

export interface QueryResponse {
    answer: string;
    citations: Citation[];
    sessionId: string;
    trace?: string[];
}

export interface ChatMessage {
    id: string;
    type: 'question' | 'answer';
    content: string;
    citations?: Citation[];
    timestamp: Date;
}
