/**
 * Vercel serverless entry — Express app (Solforge orchestrator).
 * Does not call listen(); Vercel invokes the exported app.
 */
import { createApp } from "../server.mjs";
import { createApprovalStoreFromEnv } from "../lib/approval-session.mjs";

const app = await createApp({
  approvalStore: createApprovalStoreFromEnv(),
});

export default app;
