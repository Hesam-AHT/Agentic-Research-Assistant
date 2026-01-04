import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import dotenv from "dotenv";

import { entryNode } from "./nodes/entry-node.js";
import { classifyNode } from "./nodes/classify-node.js";
import { decomposeNode } from "./nodes/decompose-node.js";
import { plannerNode } from "./nodes/planner-node.js";
import { dispatchNode } from "./nodes/dispatch-node.js";
import { exitNode } from "./nodes/exit-node.js";

import { GlobalMemory } from "./memory/GlobalMemory.js";
import { A0State } from "./types/workflow-types.js";

dotenv.config();

/**
 * Main entry point for the Agentic Research Assistant
 * Modular LangGraph Orchestrator
 */

// Define state annotation for LangGraph
const StateAnnotation = Annotation.Root({
    sessionId: Annotation<string>,
    userInput: Annotation<string>,
    sources: Annotation<string[]>,
    profile: Annotation<any>,
    blacklist: Annotation<string[]>,
    brain: Annotation<any>,
    decomposition: Annotation<any>,
    plan: Annotation<any[]>,
    attempts: Annotation<number>,
    results: Annotation<any>,
    evidence: Annotation<any[]>,
    answer: Annotation<string>,
    citations: Annotation<any[]>,
    trace: Annotation<string[]>,
    vector_store: Annotation<any>,
    chatHistory: Annotation<string>,
});

/**
 * Build the main answer graph
 */
export function buildA0AnswerGraph() {
    const graph = new StateGraph(StateAnnotation);

    // Add nodes extracted into modular functions
    graph.addNode("entry", entryNode);
    graph.addNode("classify", classifyNode);
    graph.addNode("decompose", decomposeNode);
    graph.addNode("planner", plannerNode);
    graph.addNode("dispatch", dispatchNode);
    graph.addNode("exit", exitNode);

    // Define edges
    graph.setEntryPoint("entry" as any);
    graph.addEdge("entry" as any, "classify" as any);
    graph.addEdge("classify" as any, "decompose" as any);
    graph.addEdge("decompose" as any, "planner" as any);
    graph.addEdge("planner" as any, "dispatch" as any);
    graph.addEdge("dispatch" as any, "exit" as any);
    graph.addEdge("exit" as any, END);

    return graph.compile();
}

/**
 * Build the feedback graph
 */
export function buildA0FeedbackGraph() {
    const FeedbackAnnotation = Annotation.Root({
        sessionId: Annotation<string>,
        feedback: Annotation<any>,
    });

    const graph = new StateGraph(FeedbackAnnotation);

    graph.addNode("ingest", async (state: any) => {
        const mem = new GlobalMemory(state.sessionId);
        const blacklist = (await mem.read<string[]>("blacklist")) ?? [];

        for (const w of state.feedback.wrong_citations ?? []) {
            if (w.doi && !blacklist.includes(w.doi)) {
                blacklist.push(w.doi);
            }
        }

        await mem.write("blacklist", blacklist);
        await mem.append("feedback_log", state.feedback);

        return {};
    });

    graph.setEntryPoint("ingest" as any);
    graph.addEdge("ingest" as any, END);

    return graph.compile();
}

/**
 * Main execution function
 */
export async function executeQuery(
    sessionId: string,
    userInput: string,
    sources?: any[]
): Promise<A0State> {
    const graph = buildA0AnswerGraph();

    const initialState = {
        sessionId,
        userInput,
        sources,
    };

    const result = await graph.invoke(initialState);
    return result as unknown as A0State;
}

/**
 * Submit feedback
 */
export async function submitFeedback(
    sessionId: string,
    feedback: any
): Promise<void> {
    const graph = buildA0FeedbackGraph();

    await graph.invoke({
        sessionId,
        feedback,
    });
}
