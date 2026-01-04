import { WORKFLOW_CONFIG } from "../config/workflow-config.js";
import { BrainOutput } from "../types/workflow-types.js";

export class TaskBuilder {
    static createIngestTask(sources: string[]): any {
        return {
            id: "ingest",
            task: {
                agent: "A1",
                action: "ingest_parse",
                inputs: { sources }
            },
            deps: [],
        };
    }

    static createRetrieveTask(
        index: number,
        query: string,
        brain: BrainOutput,
        hasIngest: boolean,
        sessionId: string,
        blacklist: string[] = []
    ): any {
        const skipReferences = brain.task_type === "summarize";

        return {
            id: `retrieve_${index}`,
            task: {
                agent: "A1",
                action: "retrieve",
                inputs: {
                    query,
                    topN: skipReferences
                        ? WORKFLOW_CONFIG.retrieval.topN.summary
                        : WORKFLOW_CONFIG.retrieval.topN.default,
                    topK: WORKFLOW_CONFIG.retrieval.topK.default,
                    penalties: { blacklist },
                    filtering_strategy: brain.filtering_strategy,
                    keywords: brain.keywords,
                    focus_sections: brain.focus_sections,
                    skipReferences,
                    task_type: brain.task_type,
                    complexity: brain.complexity,
                    sessionId
                },
            },
            deps: hasIngest ? ["ingest"] : [],
            retry: 2,
        };
    }

    static createReasonTask(
        query: string,
        brain: BrainOutput,
        retrieveDeps: string[],
        sessionId: string
    ): any {
        return {
            id: "reason",
            task: {
                agent: "A2",
                action: "reason",
                inputs: {
                    query,
                    evidence: [], // To be populated by dispatcher
                    expertise: brain.expertise,
                    format: brain.output_format,
                    sessionId
                },
            },
            deps: retrieveDeps,
        };
    }
}
