/**
 * A0 Type Definitions
 * 
 * NOTE: This file only contains type definitions for backward compatibility.
 * The actual A0 logic has been moved to:
 * - a0-brain.ts (query classification)
 * - a0-decomposer.ts (query decomposition)
 * - ../nodes/* (LangGraph node implementations)
 */

// Agent Registry
export type AgentRegistry = {
  A1: { run: (task: A1Task) => Promise<any> };
  A2: { run: (task: A2Task) => Promise<any> };
};

// A1 Task Types
export type A1Task =
  | { agent: "A1"; action: "ingest_parse"; inputs: { sources: any[]; sessionId?: string } }
  | {
    agent: "A1";
    action: "retrieve";
    inputs: {
      query: string;
      topN: number;
      topK: number;
      filters?: any;
      penalties?: any;
      sessionId?: string;
      filtering_strategy?: "section" | "keyword" | "hybrid";
      keywords?: string[];
      focus_sections?: string[];
      skipReferences?: boolean;
      task_type?: "qa" | "summarize" | "compare" | "explain";
      complexity?: "simple" | "moderate" | "complex";
    }
  };

// A2 Task Types
export type A2Task = {
  agent: "A2";
  action: "reason";
  inputs: {
    query: string;
    evidence: any[];
    expertise: string;
    format: string
  }
};

// Task Queue Item
export type TodoTask = {
  id: string;
  task: A1Task | A2Task;
  deps: string[];
  retry?: number;
  timeout_s?: number;
};

// A0 State (for LangGraph)
export type A0State = {
  sessionId: string;
  userInput: string;
  sources?: any[];
  profile?: any;
  blacklist?: string[];
  brain?: any;
  decomposition?: any;
  plan?: TodoTask[];
  attempts?: number;
  results?: Record<string, any>;
  evidence?: any[];
  answer?: string;
  citations?: any[];
  trace?: string[];
  chatHistory?: string;
};

// Feedback State
export type FeedbackState = {
  sessionId: string;
  feedback: {
    helpful?: boolean;
    wrong_citations?: { doi?: string }[];
    verbosity?: "shorter" | "longer";
  };
};