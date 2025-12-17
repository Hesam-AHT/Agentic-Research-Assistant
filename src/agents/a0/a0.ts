import { StateGraph, END } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { GlobalMemory } from "../memory/GlobalMemory";

// Agents

export type AgentRegistry = {
  A1: { run: (task: A1Task) => Promise<any> };
  A2: { run: (task: A2Task) => Promise<any> };
};

export type A1Task =
  | { agent: "A1"; action: "ingest_parse"; inputs: { sources: any[] } }
  | { agent: "A1"; action: "retrieve"; inputs: { query: string; topN: number; topK: number; filters?: any; penalties?: any } };

export type A2Task =
  | { agent: "A2"; action: "reason"; inputs: { query: string; evidence: any[]; expertise: string; format: string } };

export type TodoTask = {
  id: string;
  task: A1Task | A2Task;
  deps: string[];
  retry?: number;
  timeout_s?: number;
};

// Schemas

const BrainSchema = z.object({
  task_type: z.enum(["qa", "summarization", "compare", "extract"]),
  expertise: z.enum(["novice", "intermediate", "expert", "unknown"]).default("unknown"),
  needs_citations: z.boolean().default(true),
  mode: z.enum(["pipeline", "parallel"]).default("pipeline"),
  output_format: z.enum(["markdown", "bullets"]).default("markdown"),
});
type Brain = z.infer<typeof BrainSchema>;

const DecompSchema = z.object({
  subquestions: z.array(z.string()).min(1).max(7),
});
type Decomp = z.infer<typeof DecompSchema>;

// A0 State

export type A0State = {
  sessionId: string;
  userInput: string;
  sources?: any[];

  // memory
  profile?: any;
  blacklist?: string[];

  // control
  brain?: Brain;
  decomposition?: Decomp;
  plan?: TodoTask[];
  attempts?: number;

  // execution
  results?: Record<string, any>;
  evidence?: any[];

  // output
  answer?: string;
  citations?: any[];

  trace?: string[];
};code

// LLM small brain (maybe switch to deepsearch from openai????)

const brainLLM = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
const decompLLM = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });

async function classifyBrain(input: string, profile: any): Promise<Brain> {
  const prompt = `Classify the request. JSON only.

{
  "task_type": "qa|summarization|compare|extract",
  "expertise": "novice|intermediate|expert|unknown",
  "needs_citations": true|false,
  "mode": "pipeline|parallel",
  "output_format": "markdown|bullets"
}

Request:
"""${input}"""`;

  try {
    const res = await brainLLM.invoke(prompt);
    return BrainSchema.parse(JSON.parse(String(res.content)));
  } catch {
    return BrainSchema.parse({
      task_type: "qa",
      expertise: profile?.expertise ?? "unknown",
      needs_citations: true,
      mode: "pipeline",
      output_format: "markdown",
    });
  }
}

async function decomposeQuery(input: string, taskType: Brain["task_type"]): Promise<Decomp> {
  if (taskType === "summarization") {
    return { subquestions: [input] };
  }

  const prompt = `Split into 1–7 subquestions. JSON only.
{ "subquestions": ["..."] }

Request:
"""${input}"""`;

  try {
    const res = await decompLLM.invoke(prompt);
    return DecompSchema.parse(JSON.parse(String(res.content)));
  } catch {
    return { subquestions: [input] };
  }
}

//Planner

function buildPlan(state: A0State): TodoTask[] {
  const brain = state.brain!;
  const decomp = state.decomposition!;
  const todos: TodoTask[] = [];

  if ((state.sources?.length ?? 0) > 0) {
    todos.push({
      id: "ingest",
      task: { agent: "A1", action: "ingest_parse", inputs: { sources: state.sources! } },
      deps: [],
    });
  }

  decomp.subquestions.forEach((q, i) => {
    todos.push({
      id: `retrieve_${i}`,
      task: {
        agent: "A1",
        action: "retrieve",
        inputs: {
          query: q,
          topN: brain.needs_citations ? 40 : 20,
          topK: brain.needs_citations ? 8 : 5,
          penalties: { blacklist: state.blacklist ?? [] },
        },
      },
      deps: state.sources?.length ? ["ingest"] : [],
      retry: 2,
    });
  });

  todos.push({
    id: "reason",
    task: {
      agent: "A2",
      action: "reason",
      inputs: {
        query: state.userInput,
        evidence: [],
        expertise: brain.expertise,
        format: brain.output_format,
      },
    },
    deps: todos.filter(t => t.id.startsWith("retrieve_")).map(t => t.id),
  });

  return todos;
}

//Dispatcher

async function dispatch(state: A0State, agents: AgentRegistry) {
  const results: Record<string, any> = {};
  const done = new Set<string>();

  const materialize = (t: TodoTask): any => {
    const task = structuredClone(t.task) as any;
    if (task.agent === "A2") {
      const ev: any[] = [];
      for (const k in results) {
        if (k.startsWith("retrieve_")) ev.push(...(results[k]?.evidence ?? []));
      }
      task.inputs.evidence = dedupe(ev);
    }
    return task;
  };

  while (done.size < state.plan!.length) {
    const ready = state.plan!.filter(t => !done.has(t.id) && t.deps.every(d => done.has(d)));
    for (const t of ready) {
      const task = materialize(t);
      const out =
        task.agent === "A1"
          ? await agents.A1.run(task)
          : await agents.A2.run(task);
      results[t.id] = out;
      done.add(t.id);
      if (state.brain?.mode === "pipeline") break;
    }
  }

  return results;
}

function dedupe(items: any[]) {
  const seen = new Set<string>();
  return items.filter(it => {
    const k = it.doi ?? it.text?.slice(0, 80);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* =========================================================
   7) LangGraph Nodes
========================================================= */

async function entryNode(state: A0State): Promise<Partial<A0State>> {
  const mem = new GlobalMemory(state.sessionId);
  return {
    profile: (await mem.read("profile")) ?? {},
    blacklist: (await mem.read("blacklist")) ?? [],
    attempts: state.attempts ?? 0,
    trace: ["ENTRY"],
  };
}

async function brainNode(state: A0State) {
  const brain = await classifyBrain(state.userInput, state.profile);
  return { brain, trace: [...state.trace!, "BRAIN"] };
}

async function decomposeNode(state: A0State) {
  const decomposition = await decomposeQuery(state.userInput, state.brain!.task_type);
  return { decomposition, trace: [...state.trace!, "DECOMPOSE"] };
}

function planNode(state: A0State) {
  return { plan: buildPlan(state), results: {}, trace: [...state.trace!, "PLAN"] };
}

async function dispatchNode(state: A0State, cfg: { agents: AgentRegistry }) {
  const results = await dispatch(state, cfg.agents);
  const reason = results["reason"] ?? {};
  return {
    results,
    answer: reason.answer ?? "",
    citations: reason.citations ?? [],
    trace: [...state.trace!, "DISPATCH"],
  };
}

async function exitNode(state: A0State) {
  const mem = new GlobalMemory(state.sessionId);
  await mem.write("working", {
    last_query: state.userInput,
    last_answer: state.answer,
    last_citations: state.citations,
  }, 60 * 60 * 24 * 7);
  return { trace: [...state.trace!, "EXIT"] };
}

/*Build Graphs 
//should be reconsidered after finishing the prototype 

export function buildA0AnswerGraph() {
  const g = new StateGraph<A0State>()
    .addNode("entry", entryNode)
    .addNode("brain", brainNode)
    .addNode("decompose", decomposeNode)
    .addNode("plan", planNode)
    .addNode("dispatch", dispatchNode as any)
    .addNode("exit", exitNode);

  g.setEntryPoint("entry");
  g.addEdge("entry", "brain");
  g.addEdge("brain", "decompose");
  g.addEdge("decompose", "plan");
  g.addEdge("plan", "dispatch");
  g.addEdge("dispatch", "exit");
  g.addEdge("exit", END);

  return g.compile();
}

*/

// Feedback


export type FeedbackState = {
  sessionId: string;
  feedback: {
    helpful?: boolean;
    wrong_citations?: { doi?: string }[];
    verbosity?: "shorter" | "longer";
  };
};

async function feedbackNode(state: FeedbackState) {
  const mem = new GlobalMemory(state.sessionId);
  const blacklist = (await mem.read<string[]>("blacklist")) ?? [];
  for (const w of state.feedback.wrong_citations ?? []) {
    if (w.doi && !blacklist.includes(w.doi)) blacklist.push(w.doi);
  }
  await mem.write("blacklist", blacklist);
  await mem.append("feedback_log", state.feedback);
  return {};
}

export function buildA0FeedbackGraph() {
  const g = new StateGraph<FeedbackState>().addNode("ingest", feedbackNode);
  g.setEntryPoint("ingest");
  g.addEdge("ingest", END);
  return g.compile();
}