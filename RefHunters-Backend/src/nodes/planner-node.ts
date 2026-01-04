import { A0State } from "../types/workflow-types.js";
import { TaskBuilder } from "../utils/task-builder.js";

export function plannerNode(state: A0State): Partial<A0State> {
    const plan: any[] = [];
    const hasSources = (state.sources?.length ?? 0) > 0;

    // Add ingest task if sources provided
    if (hasSources) {
        plan.push(TaskBuilder.createIngestTask(state.sources!));
    }

    // Add retrieve tasks
    state.decomposition!.subquestions.forEach((q: string, i: number) => {

        plan.push(TaskBuilder.createRetrieveTask(
            i,
            q,
            state.brain!,
            hasSources,
            state.sessionId,
            state.blacklist,
            state.sources
        ));
    });


    // Add reason task
    const retrieveDeps = plan
        .filter(t => t.id.startsWith("retrieve_"))
        .map(t => t.id);

    plan.push(TaskBuilder.createReasonTask(
        state.userInput,
        state.brain!,
        retrieveDeps,
        state.sessionId
    ));

    return {
        plan,
        results: {},
        trace: [...(state.trace || []), "PLAN"]
    };
}
