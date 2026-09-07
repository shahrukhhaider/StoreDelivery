/**
 * SKU Generation Modal — configure format, preview, and apply generated SKUs.
 *
 * Generation is an explicit merchant action. Never auto-applies.
 * Shows format input, live preview of sample SKUs, collision warnings.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Modal,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Banner,
  Spinner,
  Divider,
  Box,
} from "@shopify/polaris";
import { generateSkus, type SkuGenerateResponse } from "../api-client.js";

type Props = {
  open: boolean;
  catalogId: string;
  missingCount: number;
  onClose: () => void;
  onGenerated: () => void;
};

const DEFAULT_FORMAT = "{productHandle}-{variantIndex:003}";

export function SkuGenerationModal({
  open,
  catalogId,
  missingCount,
  onClose,
  onGenerated,
}: Props) {
  const [format, setFormat] = useState(DEFAULT_FORMAT);
  const [previews, setPreviews] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<SkuGenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounced preview fetch
  useEffect(() => {
    if (!open || !format.trim()) {
      setPreviews([]);
      return;
    }

    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await generateSkus(catalogId, format, true);
        setPreviews(res.samples ?? []);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
        setPreviews([]);
      } finally {
        setPreviewLoading(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [format, open, catalogId]);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setFormat(DEFAULT_FORMAT);
      setResult(null);
      setError(null);
      setApplying(false);
    }
  }, [open]);

  const handleGenerate = useCallback(async () => {
    setApplying(true);
    setError(null);
    setResult(null);
    try {
      const res = await generateSkus(catalogId, format, false);
      setResult(res);
      if (res.applied) {
        onGenerated();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplying(false);
    }
  }, [catalogId, format, onGenerated]);

  const hasCollisions = result && !result.applied && (result.collisionCount ?? 0) > 0;
  const wasApplied = result?.applied === true;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate SKUs"
      primaryAction={
        wasApplied
          ? { content: "Done", onAction: onClose }
          : {
              content: `Generate ${missingCount} SKU${missingCount !== 1 ? "s" : ""}`,
              onAction: handleGenerate,
              loading: applying,
              disabled: !format.trim() || applying,
            }
      }
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {/* Success banner */}
          {wasApplied && (
            <Banner title="SKUs generated" tone="success">
              <p>
                {result.successCount} SKU{result.successCount !== 1 ? "s" : ""} generated and applied.
              </p>
            </Banner>
          )}

          {/* Collision banner */}
          {hasCollisions && (
            <Banner title="SKU collisions detected" tone="critical">
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">
                  {result.collisionCount} generated SKU{result.collisionCount !== 1 ? "s" : ""} collide
                  with existing SKUs. Change the format to resolve.
                </Text>
                {result.collisions && result.collisions.length > 0 && (
                  <BlockStack gap="100">
                    {result.collisions.slice(0, 5).map((c, i) => (
                      <Text as="p" variant="bodySm" key={i}>
                        • <strong>{c.generatedSku}</strong> → already belongs to {c.collidesWithDescription}
                      </Text>
                    ))}
                    {result.collisions.length > 5 && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        …and {result.collisions.length - 5} more
                      </Text>
                    )}
                  </BlockStack>
                )}
              </BlockStack>
            </Banner>
          )}

          {error && (
            <Banner title="Error" tone="critical">
              <p>{error}</p>
            </Banner>
          )}

          {/* Format input */}
          {!wasApplied && (
            <>
              <TextField
                label="Format"
                value={format}
                onChange={setFormat}
                autoComplete="off"
                helpText="Tokens: {productHandle}, {variantIndex} (with optional padding like :003)"
              />

              <Divider />

              {/* Preview section */}
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Preview
                </Text>
                {previewLoading ? (
                  <InlineStack gap="200" blockAlign="center">
                    <Spinner size="small" />
                    <Text as="p" variant="bodySm" tone="subdued">
                      Generating preview…
                    </Text>
                  </InlineStack>
                ) : previews.length > 0 ? (
                  <Box
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <BlockStack gap="100">
                      {previews.map((sku, i) => (
                        <Text as="p" variant="bodyMd" key={i}>
                          <code>{sku}</code>
                        </Text>
                      ))}
                    </BlockStack>
                  </Box>
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Enter a format to see a preview.
                  </Text>
                )}
              </BlockStack>

              <Divider />

              <Text as="p" variant="bodySm" tone="subdued">
                This will generate SKUs for {missingCount} variant{missingCount !== 1 ? "s" : ""} that
                are currently missing a SKU. Existing SKUs will not be changed.
              </Text>
            </>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
