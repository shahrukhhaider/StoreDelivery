/**
 * Issue Side Panel — guided issue resolution.
 *
 * Shows issue context, affected product count, detected related fields,
 * and a suggested fix with Accept / Edit / Apply to All / Skip actions.
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
} from "@shopify/polaris";
import { editProduct, bulkEdit, type EditIssue } from "../api-client.js";

type Props = {
  issue: EditIssue;
  catalogId: string;
  /** How many products share this same issue */
  similarCount: number;
  /** Source keys of products with the same issue */
  similarKeys: string[];
  /** Detected related fields from the product (e.g. "Wholesale: 14.00, MSRP: 29.99") */
  detectedFields?: Array<{ label: string; value: string }>;
  /** Suggested fix */
  suggestedFix?: { field: string; value: string; explanation: string };
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
  const [applying, setApplying] = useState(false);
  const [applyingAll, setApplyingAll] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // Accept suggested fix for the single affected product
  const handleAccept = useCallback(async () => {
    if (!issue.sourceKey || !suggestedFix) return;
    setApplying(true);
    setResult(null);
    try {
      // Find the product ID — we use sourceKey match via bulk with single key
      await bulkEdit(
        catalogId,
        "set_value",
        suggestedFix.field,
        editValue,
        { sourceKeys: [issue.sourceKey] },
      );
      setResult({ success: true, message: "Fix applied." });
      onResolved();
    } catch (err) {
      setResult({ success: false, message: (err as Error).message });
    } finally {
      setApplying(false);
    }
  }, [catalogId, issue.sourceKey, suggestedFix, editValue, onResolved]);

  // Apply fix to all similar products
  const handleApplyToAll = useCallback(async () => {
    if (!suggestedFix) return;
    setApplyingAll(true);
    setResult(null);
    try {
      const res = await bulkEdit(
        catalogId,
        "set_value",
        suggestedFix.field,
        editValue,
        { sourceKeys: similarKeys },
      );
      setResult({
        success: true,
        message: `Applied to ${res.affected} product(s).${res.invalid > 0 ? ` ${res.invalid} would become invalid and were skipped.` : ""}`,
      });
      onResolved();
    } catch (err) {
      setResult({ success: false, message: (err as Error).message });
    } finally {
      setApplyingAll(false);
    }
  }, [catalogId, suggestedFix, editValue, similarKeys, onResolved]);

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
          <Button variant="plain" onClick={onClose}>✕</Button>
        </InlineStack>

        {/* Issue description */}
        <Text as="p" variant="bodyMd">{issue.message}</Text>

        {issue.sourceKey && (
          <Text as="p" variant="bodySm" tone="subdued">
            Product: {issue.sourceKey}
          </Text>
        )}

        {/* Affected count */}
        <Text as="p" variant="bodySm">
          <strong>{similarCount}</strong> product(s) affected
        </Text>

        <Divider />

        {/* Detected related fields */}
        {detectedFields && detectedFields.length > 0 && (
          <BlockStack gap="200">
            <Text as="h4" variant="headingSm">Detected fields</Text>
            {detectedFields.map((f, i) => (
              <InlineStack key={i} gap="200">
                <Text as="span" variant="bodySm" tone="subdued">{f.label}:</Text>
                <Text as="span" variant="bodySm" fontWeight="semibold">{f.value}</Text>
              </InlineStack>
            ))}
          </BlockStack>
        )}

        {/* Suggested fix */}
        {suggestedFix && (
          <>
            <Divider />
            <BlockStack gap="200">
              <Text as="h4" variant="headingSm">Suggested fix</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {suggestedFix.explanation}
              </Text>

              <TextField
                label={`Set ${suggestedFix.field}`}
                value={editValue}
                onChange={setEditValue}
                autoComplete="off"
              />

              <InlineStack gap="200">
                <Button
                  variant="primary"
                  onClick={handleAccept}
                  loading={applying}
                  disabled={!editValue}
                >
                  Accept
                </Button>

                {similarCount > 1 && (
                  <Button
                    onClick={handleApplyToAll}
                    loading={applyingAll}
                    disabled={!editValue}
                  >
                    Apply to all {String(similarCount)}
                  </Button>
                )}

                <Button variant="plain" onClick={onClose}>
                  Skip
                </Button>
              </InlineStack>
            </BlockStack>
          </>
        )}

        {/* No suggestion — just show skip */}
        {!suggestedFix && (
          <>
            <Divider />
            <Text as="p" variant="bodySm" tone="subdued">
              No automatic fix available. Edit the product directly in the grid above.
            </Text>
            <Button variant="plain" onClick={onClose}>Close</Button>
          </>
        )}

        {/* Result */}
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
