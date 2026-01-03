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
import { parseLLMJson } from "../../utils";

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

  // CHANGED BY DATE: 2026-01-03 - Use robust parser to handle markdown wrapping
  const plan: PolicyPlan = parseLLMJson<PolicyPlan>(raw);


  /* ---------- STORE MAIN PAPER ---------- */
  if (sources.length > 0) {
    await mem.write(Namespaces.main_paper, {
      path: sources[0],
      uploaded_at: new Date().toISOString(),
    });
  }

  /* ---------- LOAD FEEDBACK MEMORY (OPTIONAL) ---------- */
  const blacklist = (await mem.read<string[]>(Namespaces.blacklist)) ?? [];

  /* ---------- INGESTION (A1) ---------- */
  let evidence: Evidence[] = [];

  // CHANGED BY DATE: 2026-01-02 - Fixed workflow: Always call A1 to ingest paper first
  if (sources.length > 0) {
    const ingestTask: A1Task = {
      agent: "A1",
      action: "ingest_parse",
      inputs: {
        sources: sources
      }
    };

    // Call A1 to read the file
    // Note: A1 returns 'evidence' containing the parsed text
    const ingestRes = await runA1(ingestTask);
    if (ingestRes.status === "success" && ingestRes.evidence) {
      evidence.push(...ingestRes.evidence);
    }
  }

  /* ---------- RETRIEVAL DECISION (A1 AGAIN) ---------- */
  if (plan.allow_external_retrieval) {
    const searchTask: A1Task = {
      agent: "A1",
      action: "retrieve",
      inputs: {
        query: userInput,
        topN: 40,
        topK: 8,
        penalties: { blacklist },
      },
    };

    const a1Out = await runA1(searchTask);
    const searchEvidence = a1Out.evidence ?? [];
    evidence.push(...searchEvidence);
  }

  // CHANGED BY DATE: 2026-01-02 - Removed manual "PREPARE EVIDENCE" block since A1 now handles it above (reverted quick fix)

  /* ---------- HARD POLICY ENFORCEMENT ---------- */
  // CHANGED BY DATE: 2026-01-02 - Modified strict policy violation to a filter
  // Original code:
  // if (plan.mode === "main_only" && evidence.length > 0) {
  //   throw new Error(
  //     "A0 policy violation: external evidence retrieved in main_only mode"
  //   );
  // }

  if (plan.mode === "main_only") {
    // Filter to only allow main paper evidence
    evidence = evidence.filter(e => e.is_main_paper);
  }

  if (plan.mode === "main_only" && evidence.length > 1) {
    // If we have more than just the main paper (and maybe duplicates were not filtered correctly), strict check
    // But simpler is just to force filter above.
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
