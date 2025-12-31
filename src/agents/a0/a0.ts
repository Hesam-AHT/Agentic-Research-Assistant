// Agentic-Research-Assistant/src/a0/A0.ts
//
// A0 Controller (uses GlobalMemory)
// - A0 is the only authority over global memory (Redis via GlobalMemory)
// - Decides policy (main_only vs allow_citations)
// - Calls A1 only if policy allows external/citation retrieval
// - Calls A2 to produce the final answer
//
// Compatible with:
//   A1: src/agents/a1/a1.ts
//   A2: src/agents/a2/a2.ts
//   Memory: src/memory/GlobalMemory.ts
import "dotenv/config";

import { Agent, run, setDefaultOpenAIKey } from "@openai/agents";

import { run as runA1, type A1Task, type Evidence } from "../a1/a1";
import { run as runA2, type A2Task, type A2Result } from "../a2/a2";

import { GlobalMemory, Namespaces } from "../../memory/GlobalMemory";

setDefaultOpenAIKey(process.env.OPENAI_API_KEY!);

/* =========================
   A0 POLICY PLANNER (NO ANSWERS)
========================= */

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
You only decide policy.

Return STRICT JSON:

{
  "mode": "main_only" | "allow_citations",
  "allow_external_retrieval": true | false,
  "format": "markdown" | "latex" | "html"
}

Rules:
- If a paper is provided AND user does NOT ask for citations/references → main_only, allow_external_retrieval=false
- If user explicitly asks for citations/references/related work → allow_citations, allow_external_retrieval=true
- If no paper is provided → allow_external_retrieval=true
- Default format: markdown
`,
});

/* =========================
   A0 CONTROLLER
========================= */

export async function runA0(input: {
  sessionId: string;
  userInput: string;
  expertise?: "novice" | "intermediate" | "expert";
  format?: "markdown" | "latex" | "html";
  sources?: string[];
}) {
  const {
    sessionId,
    userInput,
    expertise = "intermediate",
    format,
    sources = [],
  } = input;

  const mem = new GlobalMemory(sessionId);

  /* ---------- POLICY PLAN ---------- */
  const planRes = await run(
  Planner,
  JSON.stringify({ userInput, sources, format })
);

const raw = planRes.finalOutput;
if (!raw) {
  throw new Error("Planner returned empty finalOutput");
}

const plan: PolicyPlan = JSON.parse(raw);


  /* ---------- STORE MAIN PAPER ---------- */
  if (sources.length > 0) {
    await mem.write(Namespaces.main_paper, {
      path: sources[0],
      uploaded_at: new Date().toISOString(),
    });
  }

  /* ---------- LOAD FEEDBACK MEMORY (OPTIONAL) ---------- */
  const blacklist = (await mem.read<string[]>(Namespaces.blacklist)) ?? [];

  /* ---------- RETRIEVAL DECISION ---------- */
  let evidence: Evidence[] = [];

  if (plan.allow_external_retrieval) {
    const a1Task: A1Task = {
      agent: "A1",
      action: "retrieve",
      inputs: {
        query: userInput,
        topN: 40,
        topK: 8,
        penalties: { blacklist },
      },
    };

    const a1Out = await runA1(a1Task);
    evidence = a1Out.evidence ?? [];
  }

  /* ---------- HARD POLICY ENFORCEMENT ---------- */
  if (plan.mode === "main_only" && evidence.length > 0) {
    throw new Error(
      "A0 policy violation: external evidence retrieved in main_only mode"
    );
  }

  /* ---------- REASONING (A2) ---------- */
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

  /* ---------- SAVE WORKING MEMORY ---------- */
  await mem.write(Namespaces.working, {
    query: userInput,
    mode: plan.mode,
    external_evidence_used: plan.allow_external_retrieval,
    evidence_count: evidence.length,
    confidence: a2Result.confidence,
    at: new Date().toISOString(),
  });

  return a2Result;
}


/* sanity test */
if (require.main === module) {
  runA0({
    sessionId: "test-session",
    userInput: "Summarize this paper",
    sources: ["dummy.pdf"],
  })
    .then((res) => {
      console.log("A0 RESULT:");
      console.log(res);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
