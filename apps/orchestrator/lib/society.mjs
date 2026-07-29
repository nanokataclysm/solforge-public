import { executeWithRetry, estimateTokens } from "./model-router.mjs";

const SPECIALISTS = Object.freeze({
  researcher:
    "Separate supplied facts, inferences, missing evidence, and research questions. Never claim live research.",
  "human-factors-analyst":
    "Assess time, energy, money, accessibility, skills, and operator burden without diagnosing anyone.",
  "opportunity-strategist":
    "Find low-cost leverage, partnerships, experiments, and reusable assets.",
  "skeptical-analyst":
    "Run a pre-mortem, challenge assumptions, and identify failure signals and safer alternatives.",
  "systems-analyst":
    "Map dependencies, human checkpoints, failure recovery, and the smallest useful implementation order.",
  "creative-director":
    "Develop clear positioning, narrative, and artifact ideas appropriate to the mission.",
});

const DEFAULT_SPECIALISTS = Object.freeze([
  "skeptical-analyst",
  "systems-analyst",
  "opportunity-strategist",
  "human-factors-analyst",
]);

export const SOCIETY_ROLE_IDS = Object.freeze([
  "navigator",
  ...Object.keys(SPECIALISTS),
  "council-chair",
]);

function parseObject(content, roleId) {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`${roleId} returned no content`);
  }
  const parsed = JSON.parse(
    content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${roleId} returned a non-object response`);
  }
  return parsed;
}

function chooseSpecialists(value) {
  const requested = Array.isArray(value?.specialistRoleIds)
    ? value.specialistRoleIds
    : [];
  const selected = [];
  for (const roleId of [...requested, ...DEFAULT_SPECIALISTS]) {
    if (SPECIALISTS[roleId] && !selected.includes(roleId)) selected.push(roleId);
    if (selected.length === 4) break;
  }
  return selected;
}

async function callRole({
  qwen,
  roleId,
  model,
  system,
  input,
  temperature,
  maxTokens,
  timeoutMs,
}) {
  // Map roleId to routing role (all society roles use navigator/specialist/chair routing)
  const routingRole = roleId === "council-chair" ? "chair" :
                      roleId === "navigator" ? "navigator" : "specialist";

  const inputTokens = estimateTokens(system + input);
  const retryResult = await executeWithRetry({
    role: routingRole,
    explicitModel: model,
    estimatedInputTokens: inputTokens,
    reservedOutputTokens: maxTokens,
    fn: async (selectedModel) => {
      return await qwen.chat.completions.create(
        {
          model: selectedModel,
          temperature,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: input },
          ],
        },
        { timeout: timeoutMs, maxRetries: 0 },
      );
    },
  });

  const result = retryResult.result;
  const content = result.choices[0]?.message?.content;
  return {
    roleId,
    model: retryResult.model,
    output: parseObject(content, roleId),
    usage: result.usage ?? null,
  };
}

/**
 * Run one bounded Qwen mission society. It analyzes and proposes actions only;
 * it has no tool or execution authority.
 */
export async function runSociety({
  qwen,
  brief,
  navigatorModel,
  specialistModel,
  chairModel,
  timeoutMs = 20_000,
}) {
  const navigator = await callRole({
    qwen,
    roleId: "navigator",
    model: navigatorModel,
    temperature: 0.1,
    maxTokens: 900,
    timeoutMs,
    system: [
      "You are SolForge Navigator. Compile the user's actual mission and select exactly four useful specialists.",
      `Allowed specialistRoleIds: ${Object.keys(SPECIALISTS).join(", ")}.`,
      "Return one JSON object with mission, constraints, unknowns, risks, websiteRequired, and specialistRoleIds.",
      "Do not execute, publish, contact, purchase, deploy, or claim live research. JSON only.",
    ].join(" "),
    input: brief,
  });

  const selected = chooseSpecialists(navigator.output);
  const settled = await Promise.allSettled(
    selected.map((roleId) =>
      callRole({
        qwen,
        roleId,
        model: specialistModel,
        temperature: roleId === "creative-director" ? 0.5 : 0.2,
        maxTokens: 900,
        timeoutMs,
        system: [
          `You are the SolForge ${roleId}.`,
          SPECIALISTS[roleId],
          "Return one JSON object with position, claims, evidenceUsed, assumptions, risks, recommendations, questions, confidence, and disagreements.",
          "Analyze only. Do not execute or claim external effects. JSON only.",
        ].join(" "),
        input: JSON.stringify({ brief, mission: navigator.output }),
      }),
    ),
  );

  const analyses = settled.map((result, index) =>
    result.status === "fulfilled"
      ? { ok: true, ...result.value }
      : {
          ok: false,
          roleId: selected[index],
          model: specialistModel,
          error: "Role failed or returned invalid JSON",
        },
  );

  const chair = await callRole({
    qwen,
    roleId: "council-chair",
    model: chairModel,
    temperature: 0.2,
    maxTokens: 1400,
    timeoutMs,
    system: [
      "You are SolForge Council Chair. Synthesize the mission without hiding dissent or failed roles.",
      "Return one JSON object with actualMission, recommendedStrategy, disagreements, uncertainties, proposedActions, and nonActions.",
      "Each proposed action needs id, description, effects, and doesNotDo. Propose only; never execute. JSON only.",
    ].join(" "),
    input: JSON.stringify({ brief, navigator: navigator.output, analyses }),
  });

  return {
    mission: navigator.output,
    society: selected.map((roleId) => ({ roleId, model: specialistModel })),
    analyses,
    disagreements: Array.isArray(chair.output.disagreements)
      ? chair.output.disagreements
      : [],
    missionPlan: chair.output,
    proposedActions: Array.isArray(chair.output.proposedActions)
      ? chair.output.proposedActions.slice(0, 8)
      : [],
    trace: [
      "Navigator compiled mission and selected four specialists",
      "Specialists analyzed in parallel with partial-failure isolation",
      "Council Chair synthesized strategy and preserved dissent",
      "No tools or external effects were invoked",
    ],
    usage: [navigator, ...analyses.filter((item) => item.ok), chair].map(
      ({ roleId, model, usage }) => ({ roleId, model, usage: usage ?? null }),
    ),
  };
}