
export interface BrainOutput {
    task_type: "qa" | "summarize" | "compare" | "explain";
    expertise: "novice" | "intermediate" | "expert";
    complexity: "simple" | "moderate" | "complex";
    keywords: string[];
    filtering_strategy: "section" | "keyword" | "hybrid";
    focus_sections: string[];
    output_format?: string;
    mode?: string;
    needs_citations: boolean;
}

export interface DecompositionOutput {
    subquestions: string[];
}

export interface TaskResults {
    [taskId: string]: any;
}

export interface A0State {
    sessionId: string;
    userInput: string;
    sources?: string[];
    profile?: any;
    blacklist?: string[];
    brain?: BrainOutput;
    decomposition?: DecompositionOutput;
    plan?: any[];
    attempts?: number;
    results?: TaskResults;
    evidence?: any[];
    answer?: string;
    citations?: any[];
    trace?: string[];
    vector_store?: any;
    chatHistory?: string;
}
