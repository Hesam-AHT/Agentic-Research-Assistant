import Redis from "ioredis";
import { Agent, run, setDefaultOpenAIKey } from "@openai/agents";

import { run as runA1, type A1Task, type Evidence } from "../agents/a1/a1";
import { run as runA2, type A2Task, type A2Result } from "../agents/a2/a2";

setDefaultOpenAIKey(process.env.OPENAI_API_KEY!);

/* 
   GLOBAL MEMORY (A0 ONLY)
 */

const redis = new Redis(process.env.REDIS_URL!);
const memKey = (sid: string, ns: string) => `mem:${sid}:${ns}`;

async function read<T>(sid: string, ns: string): Promise<T | null> {
  const v = await redis.get(memKey(sid, ns));
  return v ? JSON.parse(v) : null;
}

async function write(
  sid: string,
  ns: string,
  val: any,
  ttlSec = 60 * 60 * 24
) {
  await redis.set(memKey(sid, ns), JSON.stringify(val), "EX", ttlSec);
}

/* 
   A0 PLANNER 
 */

type PolicyPlan = {
  mode: "main_only" | "allow_citations";
  allow_external_retrieval: boolean;
  format: "markdown" | "latex" | "html";
};

const Planner = new Agent({
  name: "A0-Planner",
  model: "gpt-4o-mini",
  instructions: `
You are A0 (controller). You never answer questions.

Return STRICT JSON:

{
  "mode": "main_only" | "allow_citations",
  "allow_external_retrieval": true | false,
  "format": "markdown" | "latex" | "html"
}

Rules:
- If the user says "based only on this paper" → main_only, allow_external_retrieval=false
- If the user says "use citations / references" → allow_citations, allow_external_retrieval=true
- If no paper is provided → allow_external_retrieval=true
- Default format: markdown
`,
});

/* 
   A0 CONTROLLER
 */

export async function runA0(input: {
  sessionId: string;
  userInput: string;
  expertise?: "novice" | "intermediate" | "expert";
  format?: "markdown" | "latex" | "html";
  sources?: string[]; // PDF paths
}) {
  const {
    sessionId,
    userInput,
    expertise = "intermediate",
    format,
    sources = [],
  } = input;

  /* POLICY PLAN */
  const planRes = await run(
    Planner,
    JSON.stringify({ userInput, sources, format })
  );
  const plan: PolicyPlan = JSON.parse(planRes.finalOutput);

  /* STORE MAIN PAPER */
  if (sources.length > 0) {
    await write(sessionId, "main_paper", {
      path: sources[0],
      uploaded_at: new Date().toISOString(),
    });
  }

  /* RETRIEVAL DECISION */
  let evidence: Evidence[] = [];

  if (plan.allow_external_retrieval) {
    const a1Task: A1Task = {
      agent: "A1",
      action: "retrieve",
      inputs: {
        query: userInput,
        topN: 40,
        topK: 8,
        penalties: { blacklist: [] },
      },
    };

    const a1Out = await runA1(a1Task);
    evidence = a1Out.evidence ?? [];
  }

  /* HARD POLICY ENFORCEMENT */
  if (plan.mode === "main_only" && evidence.length > 0) {
    throw new Error(
      "A0 policy violation: external evidence retrieved in main_only mode"
    );
  }

  /* REASONING (A2) */
  const a2Task: A2Task = {
    agent: "A2",
    action: "reason",
    inputs: {
      query: userInput,
      evidence,
      expertise,
      format: plan.format,
    },
  };

  const a2Result: A2Result = await runA2(a2Task);

  /* SAVE WORKING MEMORY */
  await write(sessionId, "working", {
    query: userInput,
    mode: plan.mode,
    external_evidence_used: plan.allow_external_retrieval,
    evidence_count: evidence.length,
    confidence: a2Result.confidence,
    at: new Date().toISOString(),
  });

  return a2Result;
}
