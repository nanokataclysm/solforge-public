#!/usr/bin/env node
/**
 * Smoke an explicitly selected Solforge runtime without printing its access code.
 * The code is sent once to login; every later request uses HttpOnly-style
 * Cookie headers plus the state-change barrier header.
 */

const stateHeaders = {
  "Content-Type": "application/json",
  "x-solforge-csrf": "1",
};

function loadBase() {
  const configured = process.env.FORGE_URL?.trim();
  if (!configured) {
    throw new Error("FORGE_URL must explicitly select the runtime to smoke");
  }

  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("FORGE_URL must be a valid absolute URL");
  }

  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new Error("FORGE_URL must use http or https");
  }

  return configured.replace(/\/$/, "");
}

function loadSecret() {
  const secret = process.env.DEMO_SHARED_SECRET?.trim();
  if (!secret) {
    throw new Error("DEMO_SHARED_SECRET must be set explicitly");
  }
  return secret;
}

function cookie(setCookie, name) {
  const match = setCookie?.match(new RegExp(`(?:^|,\\s*)${name}=([^;]*)`));
  if (!match) throw new Error(`No ${name} cookie received`);
  return `${name}=${match[1]}`;
}

async function main() {
  const base = loadBase();
  const secret = loadSecret();

  async function json(pathname, init = {}) {
    const response = await fetch(`${base}${pathname}`, init);
    const body = await response.json();
    return { response, body };
  }

  console.log("base:", base);

  const health = await json("/health");
  if (!health.response.ok || !health.body.ok) throw new Error("Health failed");
  console.log("health:", health.body.authStore, health.body.approvalStore);

  const login = await json("/api/auth/login", {
    method: "POST",
    headers: stateHeaders,
    body: JSON.stringify({ accessCode: secret }),
  });
  if (!login.response.ok || !login.body.authenticated) {
    throw new Error(login.body.error || "Login failed");
  }
  const authCookie = cookie(
    login.response.headers.get("set-cookie"),
    "sf_auth_session",
  );

  const planResult = await json("/api/plan", {
    method: "POST",
    headers: { ...stateHeaders, Cookie: authCookie },
    body: JSON.stringify({
      brief:
        "Smoke test studio: handmade goods in Austin. Pages Home, Work, About, Contact.",
    }),
  });
  if (!planResult.response.ok || !planResult.body.plan) {
    throw new Error(planResult.body.error || "Plan failed");
  }
  const plan = planResult.body.plan;
  console.log("plan:", planResult.response.status, planResult.body.model);

  const approval = await json("/api/approve", {
    method: "POST",
    headers: { ...stateHeaders, Cookie: authCookie },
    body: JSON.stringify({ plan, operation: "build-preview" }),
  });
  if (!approval.response.ok || !approval.body.nonce) {
    throw new Error(approval.body.error || "Approval failed");
  }
  const approvalCookie = cookie(
    approval.response.headers.get("set-cookie"),
    "nf_approval_session",
  );
  const gatedCookie = `${authCookie}; ${approvalCookie}`;
  const previewBody = {
    plan,
    nonce: approval.body.nonce,
    artifactContextId: approval.body.artifactContextId,
  };

  const preview = await json("/api/build-preview", {
    method: "POST",
    headers: { ...stateHeaders, Cookie: gatedCookie },
    body: JSON.stringify(previewBody),
  });
  if (!preview.response.ok) {
    throw new Error(preview.body.error || "Preview failed");
  }
  console.log("preview:", preview.response.status);

  const replay = await json("/api/build-preview", {
    method: "POST",
    headers: { ...stateHeaders, Cookie: gatedCookie },
    body: JSON.stringify(previewBody),
  });
  if (![401, 409].includes(replay.response.status)) {
    throw new Error(`Replay unexpectedly returned ${replay.response.status}`);
  }

  const logout = await json("/api/auth/logout", {
    method: "POST",
    headers: { ...stateHeaders, Cookie: authCookie },
    body: "{}",
  });
  if (!logout.response.ok) throw new Error(logout.body.error || "Logout failed");

  const session = await json("/api/auth/session", {
    headers: { Cookie: authCookie },
  });
  if (session.body.authenticated) throw new Error("Logout did not invalidate session");

  console.log("SMOKE_OK");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
