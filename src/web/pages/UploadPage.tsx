/**
 * Upload Page — DropZone for CSV/XLSX, upload progress, parse polling.
 */

import React, { useState, useCallback } from "react";
import {
  Page,
  Card,
  DropZone,
  Banner,
  ProgressBar,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Spinner,
} from "@shopify/polaris";
import { uploadFile, getUpload } from "../api-client.js";

type Props = {
  onComplete: (uploadId: string, catalogId: string) => void;
};

type UploadState =
  | { step: "idle" }
  | { step: "uploading"; fileName: string }
  | { step: "processing"; uploadId: string; fileName: string }
  | { step: "error"; message: string };

export function UploadPage({ onComplete }: Props) {
  const [state, setState] = useState<UploadState>({ step: "idle" });

  const handleDrop = useCallback(
    async (_droppedFiles: File[], acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      // Client-side validation
      const name = file.name.toLowerCase();
      if (
        !name.endsWith(".csv") &&
        !name.endsWith(".tsv") &&
        !name.endsWith(".xlsx") &&
        !name.endsWith(".xls")
      ) {
        setState({
          step: "error",
          message: "Please upload a CSV or XLSX file.",
        });
        return;
      }

      if (file.size > 50 * 1024 * 1024) {
        setState({ step: "error", message: "File exceeds 50MB limit." });
        return;
      }

      setState({ step: "uploading", fileName: file.name });

      try {
        const upload = await uploadFile(file);
        setState({
          step: "processing",
          uploadId: upload.id,
          fileName: file.name,
        });
        pollUpload(upload.id);
      } catch (err) {
        setState({
          step: "error",
          message: (err as Error).message || "Upload failed",
        });
      }
    },
    [],
  );

  const pollUpload = useCallback(
    async (uploadId: string) => {
      const maxAttempts = 60; // 2 min max
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const status = await getUpload(uploadId);
          if (status.status === "parsed" && status.catalogId) {
            onComplete(uploadId, status.catalogId);
            return;
          }
          if (status.status === "failed") {
            setState({
              step: "error",
              message:
                "Failed to process file. Please check the format and try again.",
            });
            return;
          }
        } catch {
          // Network error — keep polling
        }
      }
      setState({ step: "error", message: "Processing timed out. Please try again." });
    },
    [onComplete],
  );

  return (
    <Page title="Import Supplier Catalog" subtitle="Upload a CSV or XLSX file from your supplier">
      <BlockStack gap="400">
        {state.step === "error" && (
          <Banner
            title="Upload failed"
            tone="critical"
            onDismiss={() => setState({ step: "idle" })}
          >
            <p>{state.message}</p>
          </Banner>
        )}

        {state.step === "idle" && (
          <Card>
            <DropZone onDrop={handleDrop} accept=".csv,.tsv,.xlsx,.xls" variableHeight>
              <DropZone.FileUpload
                actionTitle="Add file"
                actionHint="Accepts CSV and XLSX files up to 50MB"
              />
            </DropZone>
          </Card>
        )}

        {state.step === "uploading" && (
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" align="center">
                <Spinner size="small" />
                <Text as="p" variant="bodyMd">
                  Uploading {state.fileName}...
                </Text>
              </InlineStack>
              <ProgressBar progress={50} size="small" />
            </BlockStack>
          </Card>
        )}

        {state.step === "processing" && (
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" align="center">
                <Spinner size="small" />
                <Text as="p" variant="bodyMd">
                  Processing {state.fileName}...
                </Text>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                Parsing file, detecting columns, and building product catalog.
                This usually takes a few seconds.
              </Text>
              <ProgressBar progress={75} size="small" />
            </BlockStack>
          </Card>
        )}

        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              Supported formats
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              CSV (comma, tab, or semicolon delimited) and XLSX spreadsheets.
              The first row should contain column headers like SKU, Product Name,
              Price, etc. We'll automatically detect your columns and map them
              to Shopify fields.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
