/**
 * Import History Page — lists past uploads and import operations.
 */

import React, { useState, useEffect } from "react";
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
  Button,
} from "@shopify/polaris";

type Props = {
  onUpload: () => void;
  onViewResults?: (operationId: string) => void;
};

type HistoryEntry = {
  id: string;
  fileName: string;
  status: string;
  productCount: number;
  successCount: number;
  failedCount: number;
  createdAt: string;
};

export function HistoryPage({ onUpload, onViewResults }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch from the uploads + operations endpoints
    (async () => {
      try {
        const res = await fetch("/api/health");
        // For now, show empty state — full implementation would query
        // import_operations joined with catalog_uploads
        setEntries([]);
      } catch {
        setEntries([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
              Your import history will appear here once you complete your
              first catalog import.
            </Text>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  function statusBadge(status: string) {
    switch (status) {
      case "completed":
        return <Badge tone="success">Completed</Badge>;
      case "in_progress":
        return <Badge tone="attention">In Progress</Badge>;
      case "failed":
        return <Badge tone="critical">Failed</Badge>;
      case "planned":
        return <Badge>Planned</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  }

  const rowMarkup = entries.map((entry, index) => (
    <IndexTable.Row id={entry.id} key={entry.id} position={index}>
      <IndexTable.Cell>
        <Text as="span" fontWeight="semibold">
          {entry.fileName}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{statusBadge(entry.status)}</IndexTable.Cell>
      <IndexTable.Cell>{entry.productCount}</IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" tone="success">{entry.successCount}</Text>
        {entry.failedCount > 0 && (
          <Text as="span" tone="critical"> / {entry.failedCount} failed</Text>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {new Date(entry.createdAt).toLocaleDateString()}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {onViewResults && (
          <Button size="slim" onClick={() => onViewResults(entry.id)}>
            View
          </Button>
        )}
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Import History"
      primaryAction={{ content: "New Import", onAction: onUpload }}
    >
      <Card padding="0">
        <IndexTable
          itemCount={entries.length}
          headings={[
            { title: "File" },
            { title: "Status" },
            { title: "Products" },
            { title: "Results" },
            { title: "Date" },
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
