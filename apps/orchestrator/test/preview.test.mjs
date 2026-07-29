import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractColor,
  normalizePages,
  normalizePalette,
  buildPreviewFromPlan,
  isAllowedColor,
} from "../lib/preview.mjs";

describe("extractColor", () => {
  it("returns trimmed strings", () => {
    assert.equal(extractColor("  #abc  "), "#abc");
  });

  it("reads hex/value/color from objects", () => {
    assert.equal(extractColor({ hex: "#112233" }), "#112233");
    assert.equal(extractColor({ value: "#445566" }), "#445566");
    assert.equal(extractColor({ color: "rgb(1,2,3)" }), "rgb(1,2,3)");
  });

  it("returns null for empty or non-color values", () => {
    assert.equal(extractColor(""), null);
    assert.equal(extractColor(null), null);
    assert.equal(extractColor({}), null);
  });
});

describe("normalizePages", () => {
  it("falls back when missing", () => {
    assert.deepEqual(normalizePages(undefined), [
      "Home",
      "Work",
      "About",
      "Contact",
    ]);
  });

  it("caps at 6 and unwraps page objects", () => {
    const pages = normalizePages([
      "Home",
      { name: "Services" },
      { title: "About" },
      "Contact",
      "Blog",
      "Shop",
      "Extra",
    ]);
    assert.equal(pages.length, 6);
    assert.equal(pages[1], "Services");
    assert.equal(pages[2], "About");
  });
});

describe("normalizePalette", () => {
  it("uses array hex values", () => {
    assert.deepEqual(normalizePalette(["#111", "#222", "#333", "#444"]), [
      "#111",
      "#222",
      "#333",
    ]);
  });

  it("extracts ordered keys from Qwen-style object palettes", () => {
    assert.deepEqual(
      normalizePalette({
        primary: "#9b4a35",
        secondary: "#f2eadf",
        accent: "#202020",
        unused: "not-a-priority-but-ok",
      }),
      ["#9b4a35", "#f2eadf", "#202020"],
    );
  });

  it("falls back when palette is unusable", () => {
    assert.deepEqual(normalizePalette(null), [
      "#9b4a35",
      "#f2eadf",
      "#202020",
    ]);
  });

  it("rejects css injection-ish colors", () => {
    assert.equal(isAllowedColor("url(javascript:alert(1))"), false);
    assert.equal(isAllowedColor("expression(alert(1))"), false);
    assert.deepEqual(
      normalizePalette(["url(evil)", "#abc", "#def", "#123"]),
      ["#abc", "#def", "#123"],
    );
  });
});

describe("buildPreviewFromPlan", () => {
  it("rejects non-object plans", () => {
    const result = buildPreviewFromPlan(null);
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  it("builds preview with object palette hex values", () => {
    const result = buildPreviewFromPlan({
      businessName: "Clay & Co",
      businessSummary: "Pottery studio",
      archetype: "Craft",
      motif: "Wheel",
      pages: ["Home", "Gallery"],
      palette: {
        primary: "#aa5500",
        secondary: "#fff8f0",
        foreground: "#1a1a1a",
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.preview.palette, [
      "#aa5500",
      "#fff8f0",
      "#1a1a1a",
    ]);
    assert.equal(Array.isArray(result.preview.pages), true);
    assert.equal(result.preview.pages.length, 2);
    assert.equal(result.preview.pages[0].name, "home.html");
    assert.equal(result.preview.pages[1].name, "gallery.html");
    assert.equal(typeof result.preview.pages[0].html, "string");
    assert.equal(result.preview.name, "Clay & Co");
    assert.equal(result.validation.productionMutation, false);
    assert.equal(typeof result.preview.html, "string");
    assert.match(result.preview.html, /Clay &amp; Co|Clay & Co/);
    assert.match(result.preview.html, /id="p-0"/);
  });
});
