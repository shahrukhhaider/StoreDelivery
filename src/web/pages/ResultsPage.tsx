/**
 * Results Page — import progress, completion summary, item-level results, retry.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  Banner,
  Button,
  BlockStack,
  InlineStack,
  Text,
  ProgressBar,
  Pagination,
  Spinner,
  Divider,
} from "@shopify/polaris";
import {
  getImportStatus,
  getImportItems,
  retryImport,
  type ImportStatus,
  type ImportItemEntry,
} from "../api-client.js";

type Props = {
  operationId: string;
  onBack: () => void;
};

export function ResultsPage({ operationId, onBack }: Props) {
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [items, setItems] = useState<ImportItemEntry[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await getImportStatus(operationId);
      setStatus(s);
      return s;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, [operationId]);

  const loadItems = useCallback(
    async (p: number) => {
      try {
        const res = await getImportItems(operationId, p, filter);
        setItems(res.items);
        setTotalPages(res.totalPages);
        setTotal(res.total);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [operationId, filter],
  );

  // Initial load
  useEffect(() => {
    (async () => {
      await loadStatus();
      await loadItems(1);
      setLoading(false);
    })();
  }, [loadStatus, loadItems]);

  // Poll while in_progress
  useEffect(() => {
    if (status?.status === "in_progress") {
      pollRef.current = setInterval(async () => {
        const s = await loadStatus();
        await loadItems(page);
        if (s && s.status !== "in_progress") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
        }
      }, 3000);
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status?.status, loadStatus, loadItems, page]);

  // Reload items on page/filter change
  useEffect(() => {
    loadItems(page);
  }, [page, filter, loadItems]);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    setError(null);
    try {
      await retryImport(operationId);
      await loadStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRetrying(false);
    }
  }, [operationId, loadStatus]);

  if (loading) {
    return (
      <Page title="Import Results">
        <Card>
          <InlineStack align="center" gap="200">
            <Spinner size="small" />
            <Text as="p">Loading results...</Text>
          </InlineStack>
        </Card>
      </Page>
    );
  }

  const isRunning = status?.status === "in_progress";
  const isComplete = status?.status === "completed" || status?.status === "failed";
  const hasFailed = (status?.failedCount ?? 0) > 0;

  function itemStatusBadge(itemStatus: string) {
    switch (itemStatus) {
      case "success":
        return <Badge tone="success">Created</Badge>;
      case "failed":
        return <Badge tone="critical">Failed</Badge>;
      case "skipped":
        return <Badge>Skipped</Badge>;
      case "pending":
        return <Badge tone="attention">Pending</Badge>;
      default:
        return <Badge>{itemStatus}</Badge>;
    }
  }

  const rowMarkup = items.map((item, index) => (
    <IndexTable.Row id={item.id} key={item.id} position={index}>
      <IndexTable.Cell>
        <Text as="span" fontWeight="semibold">
          {item.sourceProductKey}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{item.action}</IndexTable.Cell>
      <IndexTable.Cell>{itemStatusBadge(item.status)}</IndexTable.Cell>
      <IndexTable.Cell>
        {item.shopifyProductId ? (
          <Text as="span" variant="bodySm" tone="subdued">
            {item.shopifyProductId}
          </Text>
        ) : (
          "—"
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {item.errorMessage ? (
          <Text as="span" variant="bodySm" tone="critical">
            {item.errorMessage}
          </Text>
        ) : (
          "—"
        )}
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Import Results"
      backAction={{ onAction: onBack }}
      secondaryActions={
        isComplete && hasFailed
          ? [
              {
                content: "Retry Failed",
                onAction: handleRetry,
                loading: retrying,
              },
            ]
          : undefined
      }
    >
      <BlockStack gap="400">
        {error && (
          <Banner title="Error" tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

        {/* Progress / Summary */}
        <Card>
          <BlockStack gap="300">
            {isRunning && (
              <>
                <Text as="h3" variant="headingSm">
                  Import in progress...
                </Text>
                <ProgressBar progress={status?.progress ?? 0} size="small" />
              </>
            )}

            {isComplete && (
              <Text as="h3" variant="headingSm">
                Import {status?.status === "completed" ? "complete" : "finished with errors"}
              </Text>
            )}

            <InlineStack gap="600">
              <BlockStack gap="100">
                <Text as="p" variant="headingLg" tone="success">
                  {status?.successCount ?? 0}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  created
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="p" variant="headingLg" tone="critical">
                  {status?.failedCount ?? 0}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  failed
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="p" variant="headingLg">
                  {status?.skippedCount ?? 0}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  skipped
                </Text>
              </BlockStack>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Filter Tabs */}
        <InlineStack gap="200">
          <Button
            pressed={!filter}
            onClick={() => { setFilter(undefined); setPage(1); }}
          >
            All ({String(total)})
          </Button>
          <Button
            pressed={filter === "success"}
            onClick={() => { setFilter("success"); setPage(1); }}
          >
            Created
          </Button>
          <Button
            pressed={filter === "failed"}
            onClick={() => { setFilter("failed"); setPage(1); }}
          >
            Failed
          </Button>
          <Button
            pressed={filter === "skipped"}
            onClick={() => { setFilter("skipped"); setPage(1); }}
          >
            Skipped
          </Button>
        </InlineStack>

        {/* Items Table */}
        <Card padding="0">
          <IndexTable
            itemCount={items.length}
            headings={[
              { title: "Product Key" },
              { title: "Action" },
              { title: "Status" },
              { title: "Shopify ID" },
              { title: "Error" },
            ]}
            selectable={false}
          >
            {rowMarkup}
          </IndexTable>
        </Card>

        {totalPages > 1 && (
          <InlineStack align="center">
            <Pagination
              hasPrevious={page > 1}
              hasNext={page < totalPages}
              onPrevious={() => setPage((p) => p - 1)}
              onNext={() => setPage((p) => p + 1)}
              label={`Page ${page} of ${totalPages}`}
            />
          </InlineStack>
        )}
      </BlockStack>
    </Page>
  );
}
