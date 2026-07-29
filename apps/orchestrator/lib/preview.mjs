const DEFAULT_PAGES = Object.freeze(["Home", "Work", "About", "Contact"]);
const DEFAULT_PALETTE = Object.freeze(["#9b4a35", "#f2eadf", "#202020"]);

const PALETTE_KEY_ORDER = Object.freeze([
  "primary",
  "secondary",
  "accent",
  "background",
  "foreground",
  "tertiary",
  "muted",
  "surface",
  "text",
]);

/** Safe CSS color allowlist: hex, rgb/rgba, hsl/hsla only. */
const COLOR_RE =
  /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(?:\s*,\s*[\d.]+%?)?\s*\)|hsla?\(\s*[\d.]+(?:deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%(?:\s*,\s*[\d.]+%?)?\s*\))$/i;

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function extractColor(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate =
      value.hex ?? value.value ?? value.color ?? value.hexCode ?? null;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

/**
 * @param {string | null} color
 * @returns {boolean}
 */
export function isAllowedColor(color) {
  if (!color || typeof color !== "string") return false;
  const t = color.trim();
  if (t.length > 64) return false;
  if (/url\s*\(|expression\s*\(|javascript:/i.test(t)) return false;
  return COLOR_RE.test(t);
}

/**
 * @param {string | null} color
 * @param {string} fallback
 * @returns {string}
 */
export function safeColor(color, fallback) {
  return isAllowedColor(color) ? color.trim() : fallback;
}

/**
 * @param {unknown} pages
 * @returns {string[]}
 */
export function normalizePages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    return [...DEFAULT_PAGES];
  }

  return pages.slice(0, 6).map((page) => {
    if (typeof page === "string") return page.slice(0, 80);
    if (page && typeof page === "object") {
      const label =
        page.name ?? page.title ?? page.label ?? page.slug ?? "Page";
      return String(label).slice(0, 80);
    }
    return String(page).slice(0, 80);
  });
}

/**
 * @param {unknown} palette
 * @returns {string[]}
 */
export function normalizePalette(palette) {
  if (Array.isArray(palette)) {
    const colors = palette
      .map(extractColor)
      .filter((color) => isAllowedColor(color))
      .slice(0, 3);
    return colors.length > 0 ? colors : [...DEFAULT_PALETTE];
  }

  if (palette && typeof palette === "object") {
    const colors = [];
    const seen = new Set();

    const push = (raw) => {
      const color = extractColor(raw);
      if (!isAllowedColor(color)) return;
      const key = color.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      colors.push(color.trim());
    };

    for (const key of PALETTE_KEY_ORDER) {
      if (Object.prototype.hasOwnProperty.call(palette, key)) {
        push(palette[key]);
      }
    }

    for (const [key, value] of Object.entries(palette)) {
      if (PALETTE_KEY_ORDER.includes(key)) continue;
      push(value);
    }

    if (colors.length > 0) {
      return colors.slice(0, 3);
    }
  }

  return [...DEFAULT_PALETTE];
}

/**
 * Escape for HTML text nodes / attributes (not CSS — use safeColor for styles).
 * @param {unknown} value
 */
function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Multi-page isolated HTML document for iframe srcdoc.
 * @param {{
 *   name: string,
 *   summary: string,
 *   archetype: string,
 *   motif: string,
 *   pages: string[],
 *   palette: string[],
 * }} preview
 */
export function buildPreviewHtml(preview) {
  const [c0, c1, c2] = preview.palette;
  const bg = safeColor(c1, DEFAULT_PALETTE[1]);
  const fg = safeColor(c2, DEFAULT_PALETTE[2]);
  const accent = safeColor(c0, DEFAULT_PALETTE[0]);

  const nav = preview.pages
    .map(
      (p, i) =>
        `<a href="#p-${i}" style="color:${esc(accent)};margin-right:0.75rem;text-decoration:none;font-size:0.85rem">${esc(p)}</a>`,
    )
    .join("");

  const sections = preview.pages
    .map((p, i) => {
      const isHome = i === 0;
      return `
<section id="p-${i}" style="padding:1.25rem 0;border-top:1px solid ${esc(accent)}33">
  <p style="letter-spacing:0.12em;text-transform:uppercase;font-size:0.7rem;color:${esc(accent)};margin:0 0 0.35rem">${String(i + 1).padStart(2, "0")}</p>
  <h2 style="margin:0 0 0.5rem;font-size:1.35rem">${esc(p)}</h2>
  <p style="margin:0;line-height:1.55;opacity:0.9">${
    isHome
      ? esc(preview.summary)
      : esc(`${p} — ${preview.motif}. ${preview.archetype}.`)
  }</p>
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(preview.name)} — preview</title>
<style>
  body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:${esc(bg)};color:${esc(fg)}}
  .wrap{max-width:40rem;margin:0 auto;padding:1.5rem}
  .cta{display:inline-block;margin-top:1rem;padding:0.55rem 1rem;border-radius:999px;background:${esc(accent)};color:${esc(bg)};font-weight:600;font-size:0.9rem}
</style>
</head>
<body>
  <div class="wrap">
    <nav aria-label="Preview pages">${nav}</nav>
    <p style="margin:1rem 0 0.25rem;letter-spacing:0.14em;text-transform:uppercase;font-size:0.7rem;color:${esc(accent)}">${esc(preview.motif)}</p>
    <h1 style="margin:0 0 0.5rem;font-size:1.75rem">${esc(preview.name)}</h1>
    <p style="margin:0;opacity:0.9">${esc(preview.summary)}</p>
    <span class="cta">Get in touch</span>
    ${sections}
    <p style="margin-top:2rem;font-size:0.75rem;opacity:0.55">Isolated Solforge preview · no production deploy</p>
  </div>
</body>
</html>`;
}

/**
 * @param {unknown} plan
 */
export function buildPreviewFromPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return {
      ok: false,
      status: 400,
      error: "A valid approved plan is required",
    };
  }

  const pages = normalizePages(plan.pages);
  const palette = normalizePalette(plan.palette);

  const validation = {
    approved: true,
    isolatedPreview: true,
    pageCountValid: pages.length > 0 && pages.length <= 6,
    paletteCountValid: palette.length > 0 && palette.length <= 3,
    colorsAllowlisted: palette.every((c) => isAllowedColor(c)),
    productionMutation: false,
    secretsAccessed: false,
  };

  if (!validation.pageCountValid || !validation.paletteCountValid) {
    return {
      ok: false,
      status: 422,
      error: "The approved plan failed preview validation",
      validation,
    };
  }

  const preview = {
    name: String(plan.businessName ?? "Moonlit Kiln").slice(0, 200),
    summary: String(
      plan.businessSummary ?? "An independent creative business.",
    ).slice(0, 2000),
    archetype: String(plan.archetype ?? "Craft / artisan").slice(0, 200),
    motif: String(plan.motif ?? "Handmade studio").slice(0, 200),
    pages,
    palette,
  };

  const html = buildPreviewHtml(preview);

  // Build pages array for package signing
  const pagesWithHtml = pages.map((pageName) => ({
    name: `${pageName.toLowerCase().replace(/\s+/g, '-')}.html`,
    html,
  }));

  return {
    ok: true,
    validation,
    preview: {
      ...preview,
      html,
      pages: pagesWithHtml,
    },
  };
}
