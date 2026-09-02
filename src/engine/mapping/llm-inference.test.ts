/**
 * LLM Inference tests — uses exported helpers to test prompt building,
 * response parsing, and validation without calling the real API.
 */

import { describe, it, expect, vi } from "vitest";
import {
  inferColumnsWithLlm,
  _buildPrompt,
  _parseResponse,
  _validateTarget,
  type LlmColumnRequest,
  type LlmInferenceConfig,
} from "./llm-inference.js";

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

describe("buildPrompt", () => {
  it("includes all column headers and sample values", () => {
    const prompt = _buildPrompt([
      {
        header: "Retail",
        neighborHeaders: ["Wholesale", "MAP"],
        sampleValues: ["24.99", "39.99", "12.50"],
      },
    ]);

    expect(prompt).toContain("Retail");
    expect(prompt).toContain("Wholesale");
    expect(prompt).toContain("24.99");
  });

  it("includes all allowed target fields in the prompt", () => {
    const prompt = _buildPrompt([
      { header: "X", neighborHeaders: [], sampleValues: [] },
    ]);

    expect(prompt).toContain("product.title");
    expect(prompt).toContain("variant.sku");
    expect(prompt).toContain("variant.price");
    expect(prompt).toContain("image.url");
    expect(prompt).toContain("ignore");
  });

  it("limits sample values to 10", () => {
    const prompt = _buildPrompt([
      {
        header: "Col",
        neighborHeaders: [],
        sampleValues: Array.from({ length: 50 }, (_, i) => `val_${i}`),
      },
    ]);

    // Should contain val_0 through val_9 but not val_10
    expect(prompt).toContain("val_0");
    expect(prompt).toContain("val_9");
    expect(prompt).not.toContain("val_10");
  });

  it("handles multiple columns in one prompt", () => {
    const prompt = _buildPrompt([
      { header: "Col A", neighborHeaders: ["Col B"], sampleValues: ["a1"] },
      { header: "Col B", neighborHeaders: ["Col A"], sampleValues: ["b1"] },
    ]);

    expect(prompt).toContain("Col A");
    expect(prompt).toContain("Col B");
  });
});

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

describe("parseResponse", () => {
  it("parses a clean JSON array", () => {
    const raw = JSON.stringify([
      { header: "Retail", target: "variant.price", reasoning: "Looks like a price" },
    ]);
    const result = _parseResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].header).toBe("Retail");
    expect(result[0].target).toBe("variant.price");
    expect(result[0].reasoning).toBe("Looks like a price");
  });

  it("extracts JSON from markdown code blocks", () => {
    const raw = `Here's my analysis:
\`\`\`json
[{"header": "UPC Code", "target": "variant.barcode", "reasoning": "UPC is a barcode"}]
\`\`\``;
    const result = _parseResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].target).toBe("variant.barcode");
  });

  it("extracts JSON embedded in prose", () => {
    const raw = `Based on the data, I suggest:
[{"header": "Qty", "target": "variant.inventoryQuantity", "reasoning": "quantity values"}]
That should work well.`;
    const result = _parseResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].target).toBe("variant.inventoryQuantity");
  });

  it("handles missing reasoning field", () => {
    const raw = JSON.stringify([
      { header: "X", target: "ignore" },
    ]);
    const result = _parseResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].reasoning).toBe("");
  });

  it("returns empty array for invalid JSON", () => {
    expect(_parseResponse("not json at all")).toEqual([]);
  });

  it("returns empty array for non-array JSON", () => {
    expect(_parseResponse('{"header": "X"}')).toEqual([]);
  });

  it("filters out entries with missing header or target", () => {
    const raw = JSON.stringify([
      { header: "Good", target: "variant.sku" },
      { target: "variant.price" }, // missing header
      { header: "Also Bad" }, // missing target
      { header: "OK", target: "ignore" },
    ]);
    const result = _parseResponse(raw);
    expect(result).toHaveLength(2);
    expect(result[0].header).toBe("Good");
    expect(result[1].header).toBe("OK");
  });
});

// ---------------------------------------------------------------------------
// Target validation
// ---------------------------------------------------------------------------

describe("validateTarget", () => {
  it("accepts valid target fields", () => {
    expect(_validateTarget("variant.price")).toBe("variant.price");
    expect(_validateTarget("product.title")).toBe("product.title");
    expect(_validateTarget("image.url")).toBe("image.url");
    expect(_validateTarget("ignore")).toBe("ignore");
  });

  it("rejects invented targets", () => {
    expect(_validateTarget("product.color")).toBeNull();
    expect(_validateTarget("variant.flavor")).toBeNull();
    expect(_validateTarget("made_up_field")).toBeNull();
    expect(_validateTarget("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// inferColumnsWithLlm — integration (no real API call)
// ---------------------------------------------------------------------------

describe("inferColumnsWithLlm", () => {
  const columns: LlmColumnRequest[] = [
    { header: "Retail", neighborHeaders: ["Wholesale"], sampleValues: ["24.99"] },
    { header: "UOM", neighborHeaders: ["Source"], sampleValues: ["USD/mt"] },
  ];

  it("returns empty suggestions when provider is none", async () => {
    const config: LlmInferenceConfig = { provider: "none", apiKey: "", model: "" };
    const results = await inferColumnsWithLlm(columns, config);
    expect(results).toHaveLength(2);
    expect(results[0].suggestedTarget).toBeNull();
    expect(results[1].suggestedTarget).toBeNull();
  });

  it("returns empty suggestions when apiKey is empty", async () => {
    const config: LlmInferenceConfig = { provider: "anthropic", apiKey: "", model: "claude-sonnet-4-20250514" };
    const results = await inferColumnsWithLlm(columns, config);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.suggestedTarget === null)).toBe(true);
  });

  it("returns empty suggestions for empty column list", async () => {
    const config: LlmInferenceConfig = { provider: "anthropic", apiKey: "sk-test", model: "claude-sonnet-4-20250514" };
    const results = await inferColumnsWithLlm([], config);
    expect(results).toHaveLength(0);
  });

  it("handles unsupported provider gracefully", async () => {
    const config: LlmInferenceConfig = {
      provider: "openai" as LlmInferenceConfig["provider"],
      apiKey: "sk-test",
      model: "gpt-4",
    };
    const results = await inferColumnsWithLlm(columns, config);
    expect(results).toHaveLength(2);
    expect(results[0].reasoning).toContain("not implemented");
  });
});

// ---------------------------------------------------------------------------
// Mapping engine integration — LLM suggestions flow through
// ---------------------------------------------------------------------------

describe("mapColumns with LLM", () => {
  it("existing tests still pass without LLM config", async () => {
    // Import mapColumns — existing behavior unchanged when no LLM
    const { mapColumns } = await import("./mapping-engine.js");
    const sheet = {
      headers: ["SKU", "Product Name", "Price"],
      rows: [{ SKU: "A", "Product Name": "Widget", Price: "10.00" }],
      delimiter: ",",
      rowCount: 1,
    };

    const result = await mapColumns(sheet);
    expect(result.mappings).toHaveLength(3);
    expect(result.mappings[0].targetField).toBe("variant.sku");
  });

  it("passes LLM config through without breaking when provider is none", async () => {
    const { mapColumns } = await import("./mapping-engine.js");
    const sheet = {
      headers: ["Weird Column", "Another One"],
      rows: [{ "Weird Column": "abc", "Another One": "xyz" }],
      delimiter: ",",
      rowCount: 1,
    };

    const result = await mapColumns(sheet, {
      llm: { provider: "none", apiKey: "", model: "" },
    });

    // Both unmapped — LLM didn't run
    expect(result.unmapped).toContain("Weird Column");
    expect(result.unmapped).toContain("Another One");
  });
});
