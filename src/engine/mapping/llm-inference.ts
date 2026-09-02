/**
 * LLM Column Inference — Section 8.3
 *
 * Only invoked for columns that alias lookup and type inference couldn't resolve.
 * Sends a tiny payload per column (~200 tokens) and expects a strict enum response.
 *
 * The LLM is advisory only — its output passes through deterministic validation
 * and is surfaced to the merchant for review (medium confidence).
 */

import type { TargetField } from "@shared/types/mapping.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LlmColumnRequest = {
  header: string;
  neighborHeaders: string[];
  sampleValues: string[];
};

export type LlmColumnResult = {
  header: string;
  suggestedTarget: TargetField | null;
  reasoning: string;
};

export type LlmInferenceConfig = {
  provider: "anthropic" | "openai" | "none";
  apiKey: string;
  model: string;
};

// ---------------------------------------------------------------------------
// Allowed targets (the enum the LLM must pick from)
// ---------------------------------------------------------------------------

const ALLOWED_TARGETS: TargetField[] = [
  "product.title",
  "product.description",
  "product.vendor",
  "product.productType",
  "product.tags",
  "variant.sku",
  "variant.barcode",
  "variant.price",
  "variant.compareAtPrice",
  "variant.cost",
  "variant.inventoryQuantity",
  "variant.weight",
  "variant.option1",
  "variant.option2",
  "variant.option3",
  "image.url",
  "image.altText",
  "grouping.parentKey",
  "ignore",
];

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildPrompt(columns: LlmColumnRequest[]): string {
  const columnsJson = columns.map((c) => ({
    header: c.header,
    neighbor_headers: c.neighborHeaders,
    sample_values: c.sampleValues.slice(0, 10),
  }));

  return `You are a data mapping assistant for a Shopify product catalog importer.

Given spreadsheet columns that could not be automatically mapped, classify each into the correct Shopify product field.

ALLOWED TARGETS (you must pick one per column, or "ignore" if it doesn't map to any product field):
${ALLOWED_TARGETS.map((t) => `- ${t}`).join("\n")}

COLUMNS TO CLASSIFY:
${JSON.stringify(columnsJson, null, 2)}

Respond with ONLY a JSON array, one object per column:
[
  {"header": "...", "target": "...", "reasoning": "brief explanation"}
]

Rules:
- "target" MUST be one of the allowed targets listed above, or "ignore"
- If you cannot confidently determine the mapping, use "ignore"
- Base your decision on the header name, neighboring headers for context, and sample values
- Headers may be in any language (Chinese, German, French, Spanish, etc.)
- Do NOT invent targets outside the allowed list`;
}

// ---------------------------------------------------------------------------
// Anthropic client
// ---------------------------------------------------------------------------

async function callAnthropic(
  prompt: string,
  config: LlmInferenceConfig,
): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: config.apiKey });

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  // Extract text from response
  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.text ?? "";
}

// ---------------------------------------------------------------------------
// Parse + validate LLM response
// ---------------------------------------------------------------------------

function parseResponse(raw: string): Array<{ header: string; target: string; reasoning: string }> {
  // Extract JSON from response (may be wrapped in markdown code blocks)
  let jsonStr = raw.trim();
  const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item: unknown): item is { header: string; target: string; reasoning: string } =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).header === "string" &&
          typeof (item as Record<string, unknown>).target === "string",
      )
      .map((item) => ({
        header: item.header,
        target: item.target,
        reasoning: (item as Record<string, string>).reasoning ?? "",
      }));
  } catch {
    return [];
  }
}

function validateTarget(target: string): TargetField | null {
  if (ALLOWED_TARGETS.includes(target as TargetField)) {
    return target as TargetField;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run LLM inference on a batch of unmapped columns.
 * Returns suggestions with medium confidence — merchant must review.
 *
 * If the LLM is not configured or fails, returns empty results gracefully.
 */
export async function inferColumnsWithLlm(
  columns: LlmColumnRequest[],
  config: LlmInferenceConfig,
): Promise<LlmColumnResult[]> {
  if (config.provider === "none" || !config.apiKey || columns.length === 0) {
    return columns.map((c) => ({
      header: c.header,
      suggestedTarget: null,
      reasoning: "LLM inference not configured",
    }));
  }

  try {
    const prompt = buildPrompt(columns);

    let rawResponse: string;
    if (config.provider === "anthropic") {
      rawResponse = await callAnthropic(prompt, config);
    } else {
      // OpenAI or other providers could be added here
      return columns.map((c) => ({
        header: c.header,
        suggestedTarget: null,
        reasoning: `Provider "${config.provider}" not implemented`,
      }));
    }

    const parsed = parseResponse(rawResponse);

    // Match results back to input columns
    return columns.map((col) => {
      const match = parsed.find(
        (p) => p.header.toLowerCase() === col.header.toLowerCase(),
      );

      if (!match) {
        return {
          header: col.header,
          suggestedTarget: null,
          reasoning: "No LLM suggestion returned for this column",
        };
      }

      const validTarget = validateTarget(match.target);

      return {
        header: col.header,
        suggestedTarget: validTarget,
        reasoning: match.reasoning,
      };
    });
  } catch (err) {
    // LLM failure should never break the pipeline
    return columns.map((c) => ({
      header: c.header,
      suggestedTarget: null,
      reasoning: `LLM inference failed: ${(err as Error).message}`,
    }));
  }
}

/**
 * Exported for testing — build the prompt without calling the API.
 */
export { buildPrompt as _buildPrompt, parseResponse as _parseResponse, validateTarget as _validateTarget };
