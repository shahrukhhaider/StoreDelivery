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
  Collapsible,
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
  const [fieldsExpanded, setFieldsExpanded] = useState(false);

  const isSkuPattern = suggestedFix?.pattern === "{sourceKey}-{index}";

  // Apply to single product
  const handleApply = useCallback(async () => {
    if (!issue.sourceKey) return;
    setApplying(true);
    setResult(null);
    try {
      if (isSkuPattern) {
        // For SKU pattern: apply {sourceKey}-001 for this single product
        await bulkEdit(catalogId, "set_value", editField, `${issue.sourceKey}-001`, {
          sourceKeys: [issue.sourceKey],
        });
      } else {
        await bulkEdit(catalogId, "set_value", editField, editValue, {
          sourceKeys: [issue.sourceKey],
        });
      }
      setResult({ success: true, message: "Fix applied." });
      onResolved();
    } catch (err) {
      setResult({ success: false, message: (err as Error).message });
    } finally {
      setApplying(false);
    }
  }, [catalogId, issue.sourceKey, editField, editValue, isSkuPattern, onResolved]);

  // Apply to all similar products
  const handleApplyToAll = useCallback(async () => {
    setApplyingAll(true);
    setResult(null);
    try {
      if (isSkuPattern) {
        // For SKU pattern: apply {sourceKey}-001 per product (need individual calls)
        let applied = 0;
        for (let i = 0; i < similarKeys.length; i++) {
          const key = similarKeys[i];
          const sku = `${key}-001`;
          await bulkEdit(catalogId, "set_value", editField, sku, {
            sourceKeys: [key],
          });
          applied++;
        }
        setResult({ success: true, message: `Applied unique SKUs to ${applied} product(s).` });
      } else {
        const res = await bulkEdit(catalogId, "set_value", editField, editValue, {
          sourceKeys: similarKeys,
        });
        setResult({
          success: true,
          message: `Applied to ${res.affected} product(s).${res.invalid > 0 ? ` ${res.invalid} skipped (would become invalid).` : ""}`,
        });
      }
      onResolved();
    } catch (err) {
      setResult({ success: false, message: (err as Error).message });
    } finally {
      setApplyingAll(false);
    }
  }, [catalogId, editField, editValue, similarKeys, isSkuPattern, onResolved]);

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
        <InlineStack align="space-between">
          <InlineStack gap="200">
            {severityBadge(issue.severity)}
            <Text as="h3" variant="headingSm">{issue.code}</Text>
          </InlineStack>
        </InlineStack>

        <Text as="p" variant="bodyMd">{issue.message}</Text>

        {issue.sourceKey && (
          <Text as="p" variant="bodySm" tone="subdued">
            Product: {issue.sourceKey}
          </Text>
        )}

        <Text as="p" variant="bodySm">
          <strong>{String(similarCount)}</strong> product(s) affected
        </Text>

        <Divider />

        {/* Detected fields — collapsible */}
        {detectedFields && detectedFields.length > 0 && (
          <BlockStack gap="200">
            <Button
              variant="plain"
              onClick={() => setFieldsExpanded(!fieldsExpanded)}
              fullWidth
              textAlign="left"
            >
              {fieldsExpanded ? "▾" : "▸"} Product details ({String(detectedFields.length)} fields)
            </Button>
            <Collapsible
              open={fieldsExpanded}
              id="detected-fields"
              transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
            >
              <Card>
                <BlockStack gap="100">
                  {detectedFields.map((f, i) => (
                    <InlineStack key={i} gap="200" align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">{f.label}</Text>
                      <Text as="span" variant="bodySm" fontWeight="semibold">{f.value}</Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              </Card>
            </Collapsible>
            <Divider />
          </BlockStack>
        )}

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

          {/* SKU pattern mode */}
          {isSkuPattern ? (
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                Each product will get a unique SKU: <strong>{"{handle}"}-001</strong>
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
              disabled={!isSkuPattern && !editValue}
            >
              {issue.sourceKey ? "Apply to this product" : "Apply"}
            </Button>

            {similarCount > 1 && (
              <Button
                onClick={handleApplyToAll}
                loading={applyingAll}
                disabled={!isSkuPattern && !editValue}
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
