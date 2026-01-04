import { A0State } from "../types/workflow-types.js";
import { TaskExecutor } from "../utils/task-executor.js";
import { EvidenceAggregator } from "../utils/evidence-aggregator.js";

export async function dispatchNode(state: A0State): Promise<Partial<A0State>> {
    const executor = new TaskExecutor();
    const aggregator = new EvidenceAggregator();

    console.log(`[Dispatch] Starting execution for ${state.plan?.length} tasks`);

    // Execute all non-A2 tasks first (ingest + retrieve)
    const results: Record<string, any> = {};
    const done = new Set<string>();
    const plan = state.plan!;

    while (done.size < plan.length) {
        const ready = plan.filter(t =>
            done.size === 0 || (!done.has(t.id) && t.deps.every((d: string) => done.has(d)))
        );

        if (ready.length === 0 && done.size < plan.length) {
            console.error("[Dispatch] Circular dependency or stuck!");
            break;
        }

        for (const t of ready) {
            let task = structuredClone(t.task);
            task.inputs = task.inputs || {};
            task.inputs.sessionId = state.sessionId;
            task.taskId = t.id.trim();

            // For A2 tasks, inject aggregated evidence before execution
            if (task.agent === "A2") {
                console.log("[Dispatch] Aggregating evidence for A2...");
                const evidence = await aggregator.aggregateFromResults(
                    results,
                    state.sessionId,
                    state.userInput
                );
                task.inputs.evidence = evidence;
                console.log(`[Dispatch] Injected ${evidence.length} evidence chunks into A2`);
            }

            console.log(`[Dispatch] Running task: ${t.id} (${task.agent}.${task.action})`);

            const out = await executor.executeTask(task);
            results[t.id] = out;
            done.add(t.id);
        }
    }

    // Find the reasoning result
    const reason = results["reason"] ?? {};

    return {
        results,
        answer: reason.answer ?? "",
        citations: reason.citations ?? [],
        trace: [...(state.trace || []), "DISPATCH"],
    };
}
