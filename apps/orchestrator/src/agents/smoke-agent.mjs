import OpenAI from "openai";
import { modelFor } from "./models.mjs";

const required = [
  "DASHSCOPE_API_KEY",
  "DASHSCOPE_BASE_URL",
];

for (const name of required) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

const qwen = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: process.env.DASHSCOPE_BASE_URL,
});

const agentRole = process.argv[2] || "navigator";
const brief =
  process.argv.slice(3).join(" ") ||
  "I have an unplugged acoustic show in Austin in three weeks, almost no budget, and want around 40 attendees.";

const completion = await qwen.chat.completions.create({
  model: modelFor(agentRole),
  temperature: 0.2,
  messages: [
    {
      role: "system",
      content: `
You are the NANOKAT Navigator.

Classify the user's mission. Do not automatically assume they need a website.

Return one valid JSON object with:
{
  "missionType": "string",
  "primaryOutcome": "string",
  "possibleArtifacts": ["string"],
  "websiteRequired": false,
  "evidenceNeeded": ["string"],
  "recommendedAgents": ["string"],
  "risks": ["string"]
}

Return JSON only. No markdown.
      `.trim(),
    },
    {
      role: "user",
      content: brief,
    },
  ],
});

const raw = completion.choices?.[0]?.message?.content ?? "";

console.log(raw);
