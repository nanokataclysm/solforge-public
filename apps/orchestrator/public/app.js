const intakePanel = document.querySelector("#intake-panel");
const approvalPanel = document.querySelector("#approval-panel");
const resultPanel = document.querySelector("#result-panel");
const intakeHeading = document.querySelector("#intake-heading");
const approvalHeading = document.querySelector("#approval-heading");
const resultHeading = document.querySelector("#result-heading");

const accessCode = document.querySelector("#access-code");
const briefInput = document.querySelector("#brief");
const planButton = document.querySelector("#plan-button");
const approveButton = document.querySelector("#approve-button");
const reviseButton = document.querySelector("#revise-button");
const restartButton = document.querySelector("#restart-button");
const downloadButton = document.querySelector("#download-button");
const logoutButton = document.querySelector("#logout-button");

const planMessage = document.querySelector("#plan-message");
const buildMessage = document.querySelector("#build-message");
const packageMessage = document.querySelector("#package-message");
const planSummary = document.querySelector("#plan-summary");
const executionTrace = document.querySelector("#execution-trace");
const previewFrame = document.querySelector("#preview-frame");
const statusPill = document.querySelector("#status-pill");
const statusLabel = document.querySelector("#status-label");
const statusSub = document.querySelector("#status-sub");

const step1Indicator = document.querySelector("#step-1-indicator");
const step2Indicator = document.querySelector("#step-2-indicator");
const step3Indicator = document.querySelector("#step-3-indicator");

let currentPlan = null;
/** One-time approval nonce from POST /api/approve (session cookie is HttpOnly). */
let approvalNonce = null;
let signedPackage = null;
let publicKeyFingerprint = null;
let artifactContextId = null;
let authenticated = false;

const STATE_CHANGE_HEADERS = {
  "content-type": "application/json",
  "x-solforge-csrf": "1",
};

function setMessage(el, text, isError = false) {
  if (!el) return;
  if (!text) {
    el.textContent = "";
    el.classList.remove("is-error", "is-success");
    return;
  }
  el.textContent = text;
  el.classList.toggle("is-error", Boolean(isError));
  el.classList.toggle("is-success", !isError);
}

async function refreshHealth() {
  if (!statusLabel) return;
  try {
    const response = await fetch("/health", { credentials: "same-origin" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error("down");
    statusPill?.classList.add("is-live");
    statusPill?.classList.remove("is-down");
    statusLabel.textContent = `${payload.provider?.includes("Alibaba") ? "Qwen" : "Live"} · ${payload.model ?? "online"}`;
    statusSub.textContent = payload.approvalGate
      ? `Gate: ${payload.approvalGate}`
      : "Runtime · online";
  } catch {
    statusPill?.classList.add("is-down");
    statusPill?.classList.remove("is-live");
    if (statusLabel) statusLabel.textContent = "Offline";
    if (statusSub) statusSub.textContent = "Health check failed";
  }
}

refreshHealth();

function setAuthenticated(value) {
  authenticated = Boolean(value);
  if (accessCode) accessCode.disabled = authenticated;
  logoutButton?.classList.toggle("hidden", !authenticated);
}

async function refreshAuth() {
  try {
    const response = await fetch("/api/auth/session", {
      credentials: "same-origin",
    });
    const payload = await response.json();
    setAuthenticated(response.ok && payload.authenticated);
  } catch {
    setAuthenticated(false);
  }
}

refreshAuth();

async function ensureAuthenticated() {
  if (authenticated) return;
  const accessCodeValue = accessCode ? accessCode.value.trim() : "";
  if (!accessCodeValue) {
    throw new Error("Enter the configured access code.");
  }
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: STATE_CHANGE_HEADERS,
    body: JSON.stringify({ accessCode: accessCodeValue }),
  });
  if (accessCode) accessCode.value = "";
  const payload = await response.json();
  if (!response.ok || !payload.authenticated) {
    throw new Error(payload.error ?? "Authentication failed");
  }
  setAuthenticated(true);
}

function text(value, fallback = "Not specified") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function list(value) {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        return (
          item.name ??
          item.title ??
          item.label ??
          item.hex ??
          item.value ??
          item.color ??
          JSON.stringify(item)
        );
      }
      return String(item);
    });
  }

  // Qwen often returns palettes as { primary, secondary, accent, ... }
  if (value && typeof value === "object") {
    const preferred = ["primary", "secondary", "accent", "background", "text"];
    const colors = [];
    for (const key of preferred) {
      if (typeof value[key] === "string" && value[key].trim()) {
        colors.push(value[key].trim());
      }
    }
    if (colors.length > 0) return colors.slice(0, 5);
    return Object.values(value)
      .filter((item) => typeof item === "string" && item.trim())
      .slice(0, 5);
  }

  return [text(value)];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderList(items) {
  return `<ul class="plan-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderPalette(items) {
  return `
    <ul class="palette-list">
      ${items
        .map((item) => {
          const value = String(item).trim();
          const validColor =
            /^#[0-9a-f]{3,8}$/i.test(value) ||
            /^(rgb|hsl)a?\([^)]+\)$/i.test(value);

          return `
            <li class="palette-chip">
              <span
                class="palette-swatch"
                ${validColor ? `style="background:${escapeHtml(value)}"` : ""}
                aria-hidden="true"
              ></span>
              <span>${escapeHtml(value)}</span>
            </li>
          `;
        })
        .join("")}
    </ul>
  `;
}

function updateStepper(panel) {
  if (!step1Indicator) return;
  const isStep1 = panel === intakePanel;
  const isStep2 = panel === approvalPanel;
  const isStep3 = panel === resultPanel;

  step1Indicator.classList.toggle("is-active", isStep1);
  step1Indicator.classList.toggle("is-completed", isStep2 || isStep3);

  step2Indicator?.classList.toggle("is-active", isStep2);
  step2Indicator?.classList.toggle("is-completed", isStep3);

  step3Indicator?.classList.toggle("is-active", isStep3);
  step3Indicator?.classList.toggle("is-completed", false);
}

function show(panel, heading) {
  for (const element of [intakePanel, approvalPanel, resultPanel]) {
    if (element) element.classList.toggle("hidden", element !== panel);
  }

  updateStepper(panel);
  if (heading) {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    heading.scrollIntoView({ behavior, block: "start" });
    heading.focus({ preventScroll: true });
  } else {
    panel?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderPlan(plan) {
  if (!planSummary) return;
  const pages = list(plan.pages);
  const palette = list(plan.palette);
  const validations = list(plan.validationSteps);
  const risks = list(plan.risks);

  planSummary.innerHTML = `
    <div class="plan-grid">
      <article class="plan-card">
        <div class="card-header">
          <span class="card-icon" aria-hidden="true">🏢</span>
          <h3>Business Overview</h3>
        </div>
        <p>${escapeHtml(text(plan.businessSummary))}</p>
      </article>

      <article class="plan-card">
        <div class="card-header">
          <span class="card-icon" aria-hidden="true">📐</span>
          <h3>Design Archetype</h3>
        </div>
        <p>${escapeHtml(text(plan.archetype))}</p>
      </article>

      <article class="plan-card">
        <div class="card-header">
          <span class="card-icon" aria-hidden="true">✨</span>
          <h3>Visual Motif</h3>
        </div>
        <p>${escapeHtml(text(plan.motif))}</p>
      </article>

      <article class="plan-card">
        <div class="card-header">
          <span class="card-icon" aria-hidden="true">🎨</span>
          <h3>Color Palette</h3>
        </div>
        ${renderPalette(palette)}
      </article>

      <article class="plan-card">
        <div class="card-header">
          <span class="card-icon" aria-hidden="true">📄</span>
          <h3>Page Architecture</h3>
        </div>
        ${renderList(pages)}
      </article>

      <article class="plan-card">
        <div class="card-header">
          <span class="card-icon" aria-hidden="true">✅</span>
          <h3>Validation Steps</h3>
        </div>
        ${renderList(validations)}
      </article>

      <article class="plan-card plan-card-risk">
        <div class="card-header">
          <span class="card-icon" aria-hidden="true">⚠️</span>
          <h3>Identified Risks</h3>
        </div>
        ${renderList(risks)}
      </article>
    </div>
  `;
}

function renderTrace(trace) {
  if (!executionTrace) return;
  executionTrace.innerHTML = trace
    .map((item) => {
      const isWarning = item.includes("⚠️");
      const icon = isWarning ? "⚠️" : "✓";
      const itemClass = isWarning ? "trace-item trace-item-warning" : "trace-item";

      let formattedText = escapeHtml(item);
      if (item.includes("Package fingerprint:") || item.includes("Independent key:")) {
        formattedText = formattedText.replace(
          /([a-f0-9]{16}\.\.\.)/gi,
          "<code>$1</code>"
        );
      }

      return `
        <div class="${itemClass}">
          <span class="trace-icon" aria-hidden="true">${icon}</span>
          <span class="trace-text">${formattedText}</span>
        </div>
      `;
    })
    .join("");
}

function renderPreview(preview) {
  if (!previewFrame) return;

  // Prefer multi-page sandboxed HTML from server (WP-D)
  if (preview && typeof preview.html === "string" && preview.html.length > 0) {
    previewFrame.innerHTML = "";
    const frame = document.createElement("iframe");
    frame.className = "preview-iframe";
    frame.title = "Isolated website preview";
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.srcdoc = preview.html;
    previewFrame.appendChild(frame);
    return;
  }

  const pages = list(preview.pages);
  const palette = list(preview.palette);
  const background = palette[1] ?? "#f3efe6";
  const accent = palette[0] ?? "#8f3f2c";
  const foreground = palette[2] ?? "#202020";

  previewFrame.innerHTML = `
    <article
      class="preview-site"
      style="background:${escapeHtml(background)};color:${escapeHtml(foreground)}"
    >
      <header class="preview-hero">
        <div class="preview-kicker" style="color:${escapeHtml(accent)}">
          ${escapeHtml(text(preview.motif, "Independent craft"))}
        </div>

        <h2 class="preview-title">${escapeHtml(text(preview.name, "Moonlit Kiln"))}</h2>
        <p class="preview-summary">${escapeHtml(text(preview.summary))}</p>

        <button
          type="button"
          class="preview-cta"
          style="background:${escapeHtml(accent)};border-color:${escapeHtml(accent)}"
        >
          Explore the work
        </button>
      </header>

      <section class="preview-pages">
        ${pages
          .map(
            (page, index) => `
              <div class="preview-page">
                <strong>${String(index + 1).padStart(2, "0")} · ${escapeHtml(page)}</strong>
                <span>Generated from approved Qwen plan.</span>
              </div>
            `,
          )
          .join("")}
      </section>
    </article>
  `;
}

function clearRunMessages() {
  setMessage(planMessage, "");
  setMessage(buildMessage, "");
  setMessage(packageMessage, "");
}

// Preset brief sample chip handlers
document.querySelectorAll(".preset-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const briefText = chip.getAttribute("data-brief");
    if (briefText && briefInput) {
      briefInput.value = briefText;
      briefInput.focus();
      briefInput.classList.add("brief-flash");
      setTimeout(() => briefInput.classList.remove("brief-flash"), 400);
    }
  });
});

planButton?.addEventListener("click", async () => {
  const brief = briefInput ? briefInput.value.trim() : "";

  if (!brief) {
    setMessage(planMessage, "Enter a business brief.", true);
    return;
  }

  planButton.disabled = true;
  planButton.classList.add("is-loading");
  setMessage(planMessage, "Qwen is structuring the request…");

  try {
    await ensureAuthenticated();
    const response = await fetch("/api/plan", {
      method: "POST",
      credentials: "same-origin",
      headers: STATE_CHANGE_HEADERS,
      body: JSON.stringify({ brief }),
    });

    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? "Planning failed");
    }

    currentPlan = payload.plan;
    renderPlan(currentPlan);
    setMessage(planMessage, payload.model ? `Plan ready · model ${payload.model}` : "");
    show(approvalPanel, approvalHeading);
  } catch (error) {
    setMessage(
      planMessage,
      error instanceof Error ? error.message : "Planning failed",
      true,
    );
  } finally {
    planButton.disabled = false;
    planButton.classList.remove("is-loading");
  }
});

approveButton?.addEventListener("click", async () => {
  if (!currentPlan) return;

  approveButton.disabled = true;
  approveButton.classList.add("is-loading");
  setMessage(buildMessage, "Binding approval to a server session…");

  try {
    // 1) Session-bound approval: HttpOnly cookie + one-time nonce + plan digest
    const approveResponse = await fetch("/api/approve", {
      method: "POST",
      credentials: "same-origin",
      headers: STATE_CHANGE_HEADERS,
      body: JSON.stringify({
        plan: currentPlan,
        operation: "package",
      }),
    });

    const approvePayload = await approveResponse.json();
    if (!approveResponse.ok || !approvePayload.ok) {
      throw new Error(approvePayload.error ?? "Approval session failed");
    }

    approvalNonce = approvePayload.nonce;
    artifactContextId = approvePayload.artifactContextId;
    setMessage(buildMessage, "Generating signed package…");

    // 2) Signed package with valid session cookie + matching plan + unused nonce
    const response = await fetch("/api/package", {
      method: "POST",
      credentials: "same-origin",
      headers: STATE_CHANGE_HEADERS,
      body: JSON.stringify({
        plan: currentPlan,
        nonce: approvalNonce,
        artifactContextId,
      }),
    });

    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? "Package generation failed");
    }

    approvalNonce = null;
    signedPackage = payload;
    publicKeyFingerprint = payload.publicKeyFingerprint;

    // Fetch independent public key for comparison
    let independentFingerprint = null;
    let keyVerificationStatus = "unknown";
    try {
      const keyResponse = await fetch("/api/signing/public-key", {
        credentials: "same-origin",
      });
      const keyPayload = await keyResponse.json();
      if (keyPayload.ok && keyPayload.fingerprint) {
        independentFingerprint = keyPayload.fingerprint;
        if (independentFingerprint === publicKeyFingerprint) {
          keyVerificationStatus = "verified";
        } else {
          keyVerificationStatus = "mismatch";
        }
      } else {
        keyVerificationStatus = "fetch-failed";
      }
    } catch {
      keyVerificationStatus = "fetch-error";
    }

    // Build trace from package metadata
    const trace = [
      "Business brief received",
      "Qwen generated a structured website plan",
      "Human approval bound to server session (plan digest + one-time nonce)",
      "Session-bound gate validated for package generation",
      "Files generated and digests computed",
      "Canonical manifest created",
      "Receipt signed with Ed25519",
      `Package fingerprint: ${publicKeyFingerprint?.slice(0, 16)}...`,
      independentFingerprint
        ? `Independent key: ${independentFingerprint.slice(0, 16)}... (${keyVerificationStatus})`
        : `Independent key verification: ${keyVerificationStatus}`,
    ];

    if (keyVerificationStatus === "mismatch") {
      trace.push("⚠️ WARNING: Package fingerprint does not match independent public key");
    } else if (keyVerificationStatus !== "verified") {
      trace.push("⚠️ WARNING: Could not verify package against independent public key");
    }

    renderTrace(trace);

    // Render preview from package files
    const htmlFile = payload.files.find((f) => f.name.endsWith(".html"));
    if (htmlFile && htmlFile.content) {
      renderPreview({ html: htmlFile.content });
    }

    // Message reflects package generation success, not verification status
    let statusMessage = `Package generated · ${payload.files.length} files · ${payload.signingAlgorithm}`;
    if (keyVerificationStatus === "verified") {
      statusMessage += " · key verified";
    } else if (keyVerificationStatus === "mismatch") {
      statusMessage += " · ⚠️ key mismatch";
    } else {
      statusMessage += " · ⚠️ key verification failed";
    }

    setMessage(buildMessage, statusMessage);
    show(resultPanel, resultHeading);
  } catch (error) {
    setMessage(
      buildMessage,
      error instanceof Error ? error.message : "Package generation failed",
      true,
    );
  } finally {
    approveButton.disabled = false;
    approveButton.classList.remove("is-loading");
  }
});

downloadButton?.addEventListener("click", () => {
  if (!signedPackage) {
    setMessage(packageMessage, "No package available to download", true);
    return;
  }

  try {
    const blob = new Blob([JSON.stringify(signedPackage, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `solforge-package-${signedPackage.requestId || Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setMessage(packageMessage, "Package downloaded successfully");
  } catch (error) {
    setMessage(
      packageMessage,
      error instanceof Error ? error.message : "Download failed",
      true,
    );
  }
});

reviseButton?.addEventListener("click", () => {
  approvalNonce = null;
  signedPackage = null;
  publicKeyFingerprint = null;
  artifactContextId = null;
  clearRunMessages();
  show(intakePanel, intakeHeading);
});

restartButton?.addEventListener("click", () => {
  currentPlan = null;
  approvalNonce = null;
  signedPackage = null;
  publicKeyFingerprint = null;
  artifactContextId = null;
  if (planSummary) planSummary.innerHTML = "";
  if (executionTrace) executionTrace.innerHTML = "";
  if (previewFrame) previewFrame.innerHTML = "";
  clearRunMessages();
  show(intakePanel, intakeHeading);
});

logoutButton?.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: STATE_CHANGE_HEADERS,
      body: "{}",
    });
    if (!response.ok) throw new Error("Logout failed");
    setAuthenticated(false);
    currentPlan = null;
    approvalNonce = null;
    artifactContextId = null;
    signedPackage = null;
    publicKeyFingerprint = null;
    clearRunMessages();
    show(intakePanel);
  } catch (error) {
    setMessage(
      planMessage,
      error instanceof Error ? error.message : "Logout failed",
      true,
    );
  } finally {
    logoutButton.disabled = false;
  }
});
