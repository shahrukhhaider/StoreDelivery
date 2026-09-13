/**
 * Vendor Confirm Page — step between Upload and Mapping.
 *
 * Asks the merchant: "Who is this catalog from?"
 *
 * Shows:
 *   - Detected vendor (if any) with confidence indicator
 *   - Option to use an existing vendor (pre-selected when HIGH confidence)
 *   - Option to create a new vendor
 *   - Skip option (assigns no vendor — some features will be unavailable)
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Select,
  TextField,
  Banner,
  Badge,
  Spinner,
  Divider,
} from "@shopify/polaris";
import {
  getVendors,
  detectCatalogVendor,
  assignCatalogVendor,
  getCatalog,
  type VendorItem,
  type VendorDetectionResult,
} from "../api-client.js";

type Props = {
  catalogId: string;
  onComplete: (catalogId: string) => void;
  onBack: () => void;
};

type Mode = "existing" | "create" | "skip";

export function VendorConfirmPage({ catalogId, onComplete, onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const [vendors, setVendors] = useState<VendorItem[]>([]);
  const [detection, setDetection] = useState<VendorDetectionResult | null>(null);

  const [mode, setMode] = useState<Mode>("existing");
  const [selectedVendorId, setSelectedVendorId] = useState<string>("");
  const [newVendorName, setNewVendorName] = useState<string>("");

  // Load vendors + run detection in parallel
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      getVendors(),
      detectCatalogVendor(catalogId),
      getCatalog(catalogId),
    ])
      .then(([vendorsRes, detectionRes, catalogRes]) => {
        if (cancelled) return;
        setVendors(vendorsRes.vendors);
        setDetection(detectionRes);
        setFileName(catalogRes.fileName ?? null);

        // Pre-select based on confidence
        if (detectionRes.confidence === "HIGH" && detectionRes.matchedVendorId) {
          setMode("existing");
          setSelectedVendorId(detectionRes.matchedVendorId);
        } else if (detectionRes.confidence === "MEDIUM" && detectionRes.matchedVendorId) {
          setMode("existing");
          setSelectedVendorId(detectionRes.matchedVendorId);
        } else if (detectionRes.candidateVendorName) {
          // Unknown vendor but we have a name candidate — default to create
          if (vendorsRes.vendors.length === 0) {
            setMode("create");
            setNewVendorName(detectionRes.candidateVendorName);
          } else {
            setMode("create");
            setNewVendorName(detectionRes.candidateVendorName);
          }
        } else {
          setMode(vendorsRes.vendors.length > 0 ? "existing" : "create");
        }
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [catalogId]);

  const handleContinue = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      if (mode === "skip") {
        // Proceed without assigning a vendor
        onComplete(catalogId);
        return;
      }

      if (mode === "existing") {
        if (!selectedVendorId) {
          setError("Please select a vendor or choose to create a new one.");
          return;
        }
        await assignCatalogVendor(catalogId, { vendorId: selectedVendorId });
      } else {
        // create
        const name = newVendorName.trim();
        if (!name) {
          setError("Please enter a vendor name.");
          return;
        }
        await assignCatalogVendor(catalogId, { vendorName: name });
      }

      onComplete(catalogId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [catalogId, mode, selectedVendorId, newVendorName, onComplete]);

  if (loading) {
    return (
      <Page title={fileName ? `Who is this catalog from? — ${fileName}` : "Who is this catalog from?"} backAction={{ onAction: onBack }}>
        <Card>
          <InlineStack align="center" gap="200">
            <Spinner size="small" />
            <Text as="p">Detecting vendor...</Text>
          </InlineStack>
        </Card>
      </Page>
    );
  }

  const vendorOptions = [
    { label: "— Select a vendor —", value: "" },
    ...vendors.map((v) => ({ label: v.name, value: v.id })),
  ];

  const confidenceBadge = detection && detection.confidence !== "NONE" ? (
    <Badge tone={detection.confidence === "HIGH" ? "success" : "attention"}>
      {detection.confidence === "HIGH" ? "Detected" : "Possible match"}
    </Badge>
  ) : null;

  return (
    <Page
      title={fileName ? `Who is this catalog from? — ${fileName}` : "Who is this catalog from?"}
      backAction={{ onAction: onBack }}
      primaryAction={{
        content: mode === "skip" ? "Skip and continue" : "Confirm vendor",
        onAction: handleContinue,
        loading: saving,
      }}
    >
      <BlockStack gap="400">
        {error && (
          <Banner tone="critical" title="Error">
            <Text as="p">{error}</Text>
          </Banner>
        )}

        {/* Detection result */}
        {detection && detection.confidence !== "NONE" && (
          <Banner
            tone={detection.confidence === "HIGH" ? "success" : "warning"}
            title={
              detection.confidence === "HIGH"
                ? `Detected: ${detection.matchedVendorName}`
                : `Possible match: ${detection.matchedVendorName}`
            }
          >
            <Text as="p" variant="bodySm">
              {detection.confidence === "HIGH"
                ? "We recognized this supplier from the file structure or vendor name."
                : "The supplier name in this file partially matches an existing vendor. Please confirm."}
            </Text>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingSm">Select supplier</Text>

            {/* Mode: existing vendor */}
            {vendors.length > 0 && (
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <input
                    type="radio"
                    id="mode-existing"
                    checked={mode === "existing"}
                    onChange={() => setMode("existing")}
                  />
                  <label htmlFor="mode-existing">
                    <Text as="span" variant="bodyMd">Use existing vendor</Text>
                  </label>
                  {mode === "existing" && confidenceBadge}
                </InlineStack>

                {mode === "existing" && (
                  <Select
                    label="Vendor"
                    labelHidden
                    options={vendorOptions}
                    value={selectedVendorId}
                    onChange={setSelectedVendorId}
                  />
                )}
              </BlockStack>
            )}

            <Divider />

            {/* Mode: create new vendor */}
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <input
                  type="radio"
                  id="mode-create"
                  checked={mode === "create"}
                  onChange={() => setMode("create")}
                />
                <label htmlFor="mode-create">
                  <Text as="span" variant="bodyMd">Create new vendor</Text>
                </label>
              </InlineStack>

              {mode === "create" && (
                <TextField
                  label="Vendor name"
                  labelHidden
                  placeholder="e.g. Acme Distribution"
                  value={newVendorName}
                  onChange={setNewVendorName}
                  autoComplete="off"
                />
              )}
            </BlockStack>

            <Divider />

            {/* Mode: skip */}
            <InlineStack gap="200" blockAlign="center">
              <input
                type="radio"
                id="mode-skip"
                checked={mode === "skip"}
                onChange={() => setMode("skip")}
              />
              <label htmlFor="mode-skip">
                <Text as="span" variant="bodyMd">Skip — don't assign a vendor</Text>
              </label>
            </InlineStack>

            {mode === "skip" && (
              <Banner tone="warning">
                <Text as="p" variant="bodySm">
                  Without a vendor, column mappings won't be saved for reuse and
                  future uploads from this supplier will start from scratch.
                </Text>
              </Banner>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
