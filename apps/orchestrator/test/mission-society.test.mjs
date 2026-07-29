import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { runSociety } from "../lib/society.mjs";

describe("Mission Society", () => {
  it("runs Navigator and selects specialists", async () => {
    const mockQwen = {
      chat: {
        completions: {
          create: mock.fn(async (params) => {
            const systemContent = params.messages[0].content;

            // Navigator response
            if (systemContent.includes("Navigator")) {
              return {
                choices: [{
                  message: {
                    content: JSON.stringify({
                      mission: "Increase event attendance",
                      constraints: ["budget", "time"],
                      unknowns: ["audience size"],
                      risks: ["low turnout"],
                      websiteRequired: false,
                      specialistRoleIds: ["skeptical-analyst", "opportunity-strategist"]
                    })
                  }
                }],
                usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
              };
            }

            // Specialist responses
            if (systemContent.includes("skeptical-analyst")) {
              return {
                choices: [{
                  message: {
                    content: JSON.stringify({
                      position: "Test early demand signals",
                      claims: ["Untested audience"],
                      evidenceUsed: [],
                      assumptions: ["Local interest exists"],
                      risks: ["Wasted effort"],
                      recommendations: ["Small test campaign"],
                      questions: ["Who is the audience?"],
                      confidence: 0.6,
                      disagreements: []
                    })
                  }
                }],
                usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
              };
            }

            // Default specialist response
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    position: "Generic analysis",
                    claims: [],
                    evidenceUsed: [],
                    assumptions: [],
                    risks: [],
                    recommendations: ["Proceed carefully"],
                    questions: [],
                    confidence: 0.7,
                    disagreements: []
                  })
                }
              }],
              usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
            };
          })
        }
      }
    };

    // Mock Council Chair
    mockQwen.chat.completions.create.mock.mockImplementationOnce(
      async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              actualMission: "Increase attendance",
              recommendedStrategy: "Test and iterate",
              disagreements: [],
              uncertainties: ["Audience size"],
              proposedActions: [
                {
                  id: "test-campaign",
                  description: "Run small test",
                  effects: ["Gather data"],
                  doesNotDo: ["Spend money"]
                }
              ],
              nonActions: ["No website yet"]
            })
          }
        }],
        usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 }
      }),
      4 // After Navigator + 4 specialists
    );

    const result = await runSociety({
      qwen: mockQwen,
      brief: "I have an acoustic show in three weeks",
      navigatorModel: "qwen-plus",
      specialistModel: "qwen-plus",
      chairModel: "qwen-plus",
      timeoutMs: 5000
    });

    assert.ok(result.mission, "Should have mission");
    assert.ok(Array.isArray(result.society), "Should have society array");
    assert.strictEqual(result.society.length, 4, "Should select 4 specialists");
    assert.ok(Array.isArray(result.analyses), "Should have analyses");
    assert.ok(Array.isArray(result.proposedActions), "Should have proposed actions");
    assert.ok(Array.isArray(result.trace), "Should have trace");
    assert.ok(result.trace.length > 0, "Trace should not be empty");
  });

  it("handles specialist failures gracefully", async () => {
    const mockQwen = {
      chat: {
        completions: {
          create: mock.fn(async (params) => {
            const systemContent = params.messages[0].content;

            if (systemContent.includes("Navigator")) {
              return {
                choices: [{
                  message: {
                    content: JSON.stringify({
                      mission: "Test mission",
                      specialistRoleIds: ["skeptical-analyst"]
                    })
                  }
                }],
                usage: null
              };
            }

            // Simulate specialist failure
            if (systemContent.includes("skeptical-analyst")) {
              throw new Error("Specialist failed");
            }

            // Other specialists succeed
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    position: "Analysis",
                    claims: [],
                    evidenceUsed: [],
                    assumptions: [],
                    risks: [],
                    recommendations: [],
                    questions: [],
                    confidence: 0.5,
                    disagreements: []
                  })
                }
              }],
              usage: null
            };
          })
        }
      }
    };

    // Mock Chair
    mockQwen.chat.completions.create.mock.mockImplementationOnce(
      async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              actualMission: "Test",
              recommendedStrategy: "Proceed",
              disagreements: [],
              uncertainties: [],
              proposedActions: [],
              nonActions: []
            })
          }
        }],
        usage: null
      }),
      5
    );

    const result = await runSociety({
      qwen: mockQwen,
      brief: "Test brief",
      navigatorModel: "qwen-plus",
      specialistModel: "qwen-plus",
      chairModel: "qwen-plus",
      timeoutMs: 5000
    });

    assert.ok(result.analyses, "Should have analyses");
    const failedAnalyses = result.analyses.filter(a => !a.ok);
    assert.ok(failedAnalyses.length > 0, "Should have at least one failed analysis");
    assert.ok(result.missionPlan, "Should still produce mission plan despite failures");
  });
});
