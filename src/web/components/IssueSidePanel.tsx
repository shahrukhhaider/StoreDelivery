/**
 * Issue Side Panel — guided issue resolution.
 *
 * Always actionable: shows edit field + suggested value + bulk apply.
 * For MISSING_SKU: generates unique SKUs with prefix pattern.
 */

import React, { useState, useCallback } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  TextField,
  Divider,
  Banner,
  Spinner,
  Select,
} from "@shopify/polaris";
import { bulkEdit, type EditIssue, type SimilarIssuesResponse } from "../api-client.js";

type Props = {
  issue: EditIssue;
  catalogId: string;
  similarCount: number;
  similarKeys: string[];
  detectedFields?: Array<{ label: string; value: string }>;
  suggestedFix?: { field: string; value: string; explanation: string; pattern?: string };
  onClose: () => void;
  onResolved: () => void;
};

export function IssueSidePanel({
  issue,
  catalogId,
  similarCount,
  similarKeys,
  detectedFields,
  suggestedFix,
  onClose,
  onResolved,
}: Props) {
  const [editValue, setEditValue] = useState(suggestedFix?.value ?? "");
  const [editField, setEditField] = useState(suggestedFix?.field ?? guessField(issue));
  const [applying, setApplying] = useState(false);
  const [applyingAll, setApplyingAll] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const isTemplatePattern = suggestedFix?.pattern === "template" || suggestedFix?.pattern === "per_variant";

  // Apply to single product
  const handleApply = useCallback(async () => {
    if (!issue.sourceKey) return;
    setApplying(true);
    setResult(null);
    try {
      await bulkEdit(
        catalogId,
        "set_value",
        suggestedFix?.field ?? editField,
        isTemplatePattern ? (suggestedFix?.value ?? editValue) : editValue,
        { sourceKeys: [issue.sourceKey] },
        undefined,
        suggestedFix?.pattern as "static" | "template" | "per_variant" | undefined,
      );
      setResult({ success: true, message: "Fix applied." });
      onResolved();
    } catch (err) {
      setResult({ success: false, message: (err as Error).message });
    } finally {
      setApplying(false);
    }
  }, [catalogId, issue.sourceKey, editField, editValue, isTemplatePattern, suggestedFix, onResolved]);

  // Apply to all similar products
  const handleApplyToAll = useCallback(async () => {
    setApplyingAll(true);
    setResult(null);
    try {
      const res = await bulkEdit(
        catalogId,
        "set_value",
        suggestedFix?.field ?? editField,
        isTemplatePattern ? (suggestedFix?.value ?? editValue) : editValue,
        { sourceKeys: similarKeys },
        undefined,
        suggestedFix?.pattern as "static" | "template" | "per_variant" | undefined,
      );
      setResult({
        success: true,
        message: `Applied to ${res.affected} product(s).${res.invalid > 0 ? ` ${res.invalid} skipped.` : ""}`,
      });
      onResolved();
    } catch (err) {
      setResult({ success: false, message: (err as Error).message });
    } finally {
      setApplyingAll(false);
    }
  }, [catalogId, editField, editValue, similarKeys, isTemplatePattern, suggestedFix, onResolved]);

  function severityBadge(severity: string) {
    switch (severity) {
      case "blocking": return <Badge tone="critical">Blocking</Badge>;
      case "warning": return <Badge tone="warning">Warning</Badge>;
      default: return <Badge tone="info">Info</Badge>;
    }
  }

  return (
    <Card>
      <BlockStack gap="400">
        {/* Header */}
        <BlockStack gap="100">
          <InlineStack gap="200">
            {severityBadge(issue.severity)}
            <Text as="h3" variant="headingSm">{issue.message}</Text>
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">
            {String(similarCount)} product{similarCount !== 1 ? "s" : ""} with the same issue
          </Text>
        </BlockStack>

        <Divider />

        {/* Edit section — always shown */}
        <BlockStack gap="300">
          <Text as="h4" variant="headingSm">
            {suggestedFix ? "Suggested fix" : "Fix this issue"}
          </Text>

          {suggestedFix?.explanation && (
            <Text as="p" variant="bodySm" tone="subdued">
              {suggestedFix.explanation}
            </Text>
          )}

          {/* Template pattern mode */}
          {isTemplatePattern ? (
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                Value template: <strong>{suggestedFix?.value ?? ""}</strong>
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Example: {similarKeys[0] ?? "product"}-001, {similarKeys[1] ?? "product2"}-001, …
              </Text>
            </BlockStack>
          ) : (
            /* Regular edit mode */
            <TextField
              label={`Set ${editField}`}
              value={editValue}
              onChange={setEditValue}
              autoComplete="off"
              placeholder={suggestedFix?.value || "Enter value..."}
            />
          )}

          {/* Action buttons */}
          <InlineStack gap="200">
            <Button
              variant="primary"
              onClick={handleApply}
              loading={applying}
              disabled={!isTemplatePattern && !editValue}
            >
              {issue.sourceKey ? "Apply to this product" : "Apply"}
            </Button>

            {similarCount > 1 && (
              <Button
                onClick={handleApplyToAll}
                loading={applyingAll}
                disabled={!isTemplatePattern && !editValue}
              >
                Apply to all {String(similarCount)}
              </Button>
            )}

            <Button variant="plain" onClick={onClose}>
              Skip
            </Button>
          </InlineStack>
        </BlockStack>

        {/* Result banner */}
        {result && (
          <Banner
            title={result.success ? "Fix applied" : "Error"}
            tone={result.success ? "success" : "critical"}
          >
            <p>{result.message}</p>
          </Banner>
        )}
      </BlockStack>
    </Card>
  );
}

/**
 * Guess which field to edit based on the issue type.
 */
function guessField(issue: EditIssue): string {
  if (issue.code.includes("SKU")) return "variants[0].sku";
  if (issue.code.includes("TITLE")) return "title";
  if (issue.code.includes("PRICE")) return "variants[0].price";
  if (issue.code.includes("BARCODE")) return "variants[0].barcode";
  if (issue.code.includes("IMAGE")) return "images";
  if (issue.code.includes("VENDOR")) return "vendor";
  if (issue.field) return issue.field;
  return "title";
}
