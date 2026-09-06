/**
 * Import History Page — shows past and in-progress imports with
 * Matrixify-style progress: X of Y, elapsed, ETA.
 */

import React, { useState, useEffect, useRef } from "react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  EmptyState,
  Text,
  BlockStack,
  InlineStack,
  Spinner,
  ProgressBar,
  Button,
} from "@shopify/polaris";
import { getHistory, type HistoryEntry } from "../api-client.js";

type Props = {
  onUpload: () => void;
  onViewResults?: (operationId: string) => void;
  onViewCatalog?: (catalogId: string) => void;
};

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec} sec`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min} min ${sec} sec`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr} hr ${remMin} min`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function statusBadge(entry: HistoryEntry) {
  // Upload-level status
  if (entry.uploadStatus === "pending") return <Badge tone="attention">Parsing...</Badge>;
  if (entry.uploadStatus === "parsing") return <Badge tone="attention">Parsing...</Badge>;
  if (entry.uploadStatus === "failed") return <Badge tone="critical">Parse Failed</Badge>;

  // Import-level status
  if (!entry.importStatus) {
    if (entry.catalogId) return <Badge tone="info">Ready</Badge>;
    return <Badge>Uploaded</Badge>;
  }

  switch (entry.importStatus) {
    case "planned":
      return <Badge tone="info">Planned</Badge>;
    case "in_progress":
      return <Badge tone="attention">Importing...</Badge>;
    case "completed":
      return entry.failedCount > 0
        ? <Badge tone="warning">Completed with errors</Badge>
        : <Badge tone="success">Completed</Badge>;
    case "failed":
      return <Badge tone="critical">Failed</Badge>;
    case "cancelled":
      return <Badge>Cancelled</Badge>;
    default:
      return <Badge>{entry.importStatus}</Badge>;
  }
}

function ProgressInfo({ entry }: { entry: HistoryEntry }) {
  if (!entry.importStatus || entry.importStatus === "planned") return null;

  const completed = entry.successCount + entry.failedCount + entry.skippedCount;
  const total = entry.plannedCount || entry.productCount;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isRunning = entry.importStatus === "in_progress";

  // Calculate elapsed and ETA
  let elapsed = "";
  let remaining = "";
  if (entry.startedAt) {
    const startMs = new Date(entry.startedAt).getTime();
    const endMs = entry.completedAt
      ? new Date(entry.completedAt).getTime()
      : Date.now();
    const elapsedMs = endMs - startMs;
    elapsed = formatDuration(elapsedMs);

    if (isRunning && completed > 0 && completed < total) {
      const msPerItem = elapsedMs / completed;
      const remainingItems = total - completed;
      remaining = formatDuration(msPerItem * remainingItems);
    }
  }

  return (
    <BlockStack gap="100">
      <InlineStack gap="200" align="center">
        <Text as="span" variant="bodySm" fontWeight="semibold">
          {completed} of {total}
        </Text>
        {entry.successCount > 0 && (
          <Text as="span" variant="bodySm" tone="success">
            New: {entry.successCount}
          </Text>
        )}
        {entry.failedCount > 0 && (
          <Text as="span" variant="bodySm" tone="critical">
            Failed: {entry.failedCount}
          </Text>
        )}
        {entry.skippedCount > 0 && (
          <Text as="span" variant="bodySm" tone="subdued">
            Skipped: {entry.skippedCount}
          </Text>
        )}
      </InlineStack>
      {isRunning && <ProgressBar progress={progress} size="small" />}
      <InlineStack gap="200">
        {elapsed && (
          <Text as="span" variant="bodySm" tone="subdued">
            Elapsed: {elapsed}
          </Text>
        )}
        {remaining && (
          <Text as="span" variant="bodySm" tone="subdued">
            Remaining: ~{remaining}
          </Text>
        )}
      </InlineStack>
    </BlockStack>
  );
}

export function HistoryPage({ onUpload, onViewResults, onViewCatalog }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadHistory = async () => {
    try {
      const res = await getHistory();
      setEntries(res.history);
    } catch {
      // silently fail — show empty state
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  // Poll while any import is in_progress
  useEffect(() => {
    const hasRunning = entries.some((e) => e.importStatus === "in_progress");
    if (hasRunning && !pollRef.current) {
      pollRef.current = setInterval(loadHistory, 3000);
    } else if (!hasRunning && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [entries]);

  if (loading) {
    return (
      <Page title="Import History">
        <Card>
          <InlineStack align="center" gap="200">
            <Spinner size="small" />
            <Text as="p">Loading history...</Text>
          </InlineStack>
        </Card>
      </Page>
    );
  }

  if (entries.length === 0) {
    return (
      <Page title="Import History">
        <Card>
          <EmptyState
            heading="No imports yet"
            image=""
            action={{ content: "Upload catalog", onAction: onUpload }}
          >
            <Text as="p" variant="bodySm" tone="subdued">
              Your import history will appear here once you upload your
              first supplier catalog.
            </Text>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  const rowMarkup = entries.map((entry, index) => (
    <IndexTable.Row id={entry.uploadId} key={entry.uploadId} position={index}>
      <IndexTable.Cell>
        <BlockStack gap="100">
          <Text as="span" fontWeight="semibold">
            {entry.fileName}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {entry.format.toUpperCase()} · {formatDate(entry.createdAt)}
          </Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>{statusBadge(entry)}</IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">
          {entry.productCount}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <ProgressInfo entry={entry} />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200">
          {entry.operationId && onViewResults && (
            <Button
              size="slim"
              onClick={() => onViewResults(entry.operationId!)}
            >
              Results
            </Button>
          )}
          {entry.catalogId && !entry.operationId && onViewCatalog && (
            <Button
              size="slim"
              onClick={() => onViewCatalog(entry.catalogId!)}
            >
              Preview
            </Button>
          )}
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Import History"
      subtitle="Track all your catalog imports and their progress"
      primaryAction={{ content: "New Import", onAction: onUpload }}
    >
      <Card padding="0">
        <IndexTable
          itemCount={entries.length}
          headings={[
            { title: "File" },
            { title: "Status" },
            { title: "Products" },
            { title: "Progress" },
            { title: "" },
          ]}
          selectable={false}
        >
          {rowMarkup}
        </IndexTable>
      </Card>
    </Page>
  );
}
