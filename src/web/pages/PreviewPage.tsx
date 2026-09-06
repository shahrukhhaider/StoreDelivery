/**
 * Preview & Issues Page — product table, issue summary, import plan confirmation.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  Banner,
  Button,
  Modal,
  BlockStack,
  InlineStack,
  Text,
  Pagination,
  Spinner,
  Divider,
} from "@shopify/polaris";
import {
  getCatalog,
  getProducts,
  getIssues,
  createPlan,
  executeImport,
  type CatalogSummary,
  type ProductListItem,
  type IssuesResponse,
  type PlanResponse,
} from "../api-client.js";

type Props = {
  catalogId: string;
  onBack: () => void;
  onExecute?: (operationId: string) => void;
};

export function PreviewPage({ catalogId, onBack, onExecute }: Props) {
  const [catalog, setCatalog] = useState<CatalogSummary | null>(null);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [issues, setIssues] = useState<IssuesResponse | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  const loadData = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const [catalogRes, productsRes, issuesRes] = await Promise.all([
          getCatalog(catalogId),
          getProducts(catalogId, p),
          getIssues(catalogId),
        ]);
        setCatalog(catalogRes);
        setProducts(productsRes.products);
        setTotalPages(productsRes.totalPages);
        setTotal(productsRes.total);
        setIssues(issuesRes);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [catalogId],
  );

  useEffect(() => {
    loadData(page);
  }, [page, loadData]);

  const handleCreatePlan = useCallback(async () => {
    setPlanLoading(true);
    try {
      const result = await createPlan(catalogId);
      setPlan(result);
      setPlanModalOpen(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPlanLoading(false);
    }
  }, [catalogId]);

  if (loading && !catalog) {
    return (
      <Page title="Catalog Preview">
        <Card>
          <InlineStack align="center" gap="200">
            <Spinner size="small" />
            <Text as="p">Loading preview...</Text>
          </InlineStack>
        </Card>
      </Page>
    );
  }

  const hasBlocking = (issues?.summary.blocked ?? 0) > 0;

  function statusBadge(status: string) {
    switch (status) {
      case "ready":
        return <Badge tone="success">Ready</Badge>;
      case "needs_review":
        return <Badge tone="warning">Review</Badge>;
      case "blocked":
        return <Badge tone="critical">Blocked</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  }

  const rowMarkup = products.map((p, index) => (
    <IndexTable.Row id={p.id} key={p.id} position={index}>
      <IndexTable.Cell>
        <Text as="span" fontWeight="semibold">
          {p.title || "(no title)"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{p.vendor ?? "—"}</IndexTable.Cell>
      <IndexTable.Cell>{p.firstSku ?? "—"}</IndexTable.Cell>
      <IndexTable.Cell>{p.firstPrice ? `$${p.firstPrice}` : "—"}</IndexTable.Cell>
      <IndexTable.Cell>{p.variantCount}</IndexTable.Cell>
      <IndexTable.Cell>{p.imageCount}</IndexTable.Cell>
      <IndexTable.Cell>{statusBadge(p.status)}</IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Catalog Preview"
      subtitle={catalog?.fileName}
      backAction={{ onAction: onBack }}
      primaryAction={{
        content: "Create Import Plan",
        onAction: handleCreatePlan,
        loading: planLoading,
        disabled: hasBlocking,
      }}
    >
      <BlockStack gap="400">
        {error && (
          <Banner title="Error" tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

        {/* Summary Banner */}
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              Summary
            </Text>
            <InlineStack gap="600">
              <BlockStack gap="100">
                <Text as="p" variant="headingLg">
                  {total}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  products detected
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="p" variant="headingLg" tone="success">
                  {issues?.summary.ready ?? 0}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  ready
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="p" variant="headingLg" tone="caution">
                  {issues?.summary.needsReview ?? 0}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  need review
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="p" variant="headingLg" tone="critical">
                  {issues?.summary.blocked ?? 0}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  blocked
                </Text>
              </BlockStack>
            </InlineStack>
          </BlockStack>
        </Card>

        {hasBlocking && (
          <Banner title="Blocking issues found" tone="critical">
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                {issues?.summary.blocked} product(s) have blocking issues that
                must be resolved before importing. These products will be excluded
                from the import.
              </Text>
              {issues?.blocking && issues.blocking.length > 0 && (
                <BlockStack gap="100">
                  {issues.blocking.slice(0, 10).map((issue, i) => (
                    <Text as="p" variant="bodySm" key={i}>
                      • <strong>{issue.code}</strong>
                      {issue.sourceKey ? ` [${issue.sourceKey}]` : ""}: {issue.message}
                      {issue.field ? ` (field: ${issue.field})` : ""}
                    </Text>
                  ))}
                  {issues.blocking.length > 10 && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      …and {issues.blocking.length - 10} more blocking issues
                    </Text>
                  )}
                </BlockStack>
              )}
            </BlockStack>
          </Banner>
        )}

        {issues && issues.warning && issues.warning.length > 0 && (
          <Banner title={`${issues.warning.length} warning(s)`} tone="warning">
            <BlockStack gap="100">
              {issues.warning.slice(0, 5).map((issue, i) => (
                <Text as="p" variant="bodySm" key={i}>
                  • <strong>{issue.code}</strong>
                  {issue.sourceKey ? ` [${issue.sourceKey}]` : ""}: {issue.message}
                </Text>
              ))}
              {issues.warning.length > 5 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  …and {issues.warning.length - 5} more warnings
                </Text>
              )}
            </BlockStack>
          </Banner>
        )}

        {/* Product Table */}
        <Card padding="0">
          <IndexTable
            itemCount={products.length}
            headings={[
              { title: "Product" },
              { title: "Vendor" },
              { title: "SKU" },
              { title: "Price" },
              { title: "Variants" },
              { title: "Images" },
              { title: "Status" },
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

        {/* Import Plan Modal */}
        {plan && (
          <Modal
            open={planModalOpen}
            onClose={() => setPlanModalOpen(false)}
            title="Import Plan"
            primaryAction={{
              content: "Start Import",
              onAction: async () => {
                if (plan && onExecute) {
                  try {
                    await executeImport(plan.id);
                    setPlanModalOpen(false);
                    onExecute(plan.id);
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }
              },
            }}
            secondaryActions={[
              { content: "Cancel", onAction: () => setPlanModalOpen(false) },
            ]}
          >
            <Modal.Section>
              <BlockStack gap="300">
                <Text as="p" variant="bodyMd">
                  This import will:
                </Text>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd">
                    Create <strong>{plan.productCount}</strong> products
                  </Text>
                  <Text as="p" variant="bodyMd">
                    Create <strong>{plan.variantCount}</strong> variants
                  </Text>
                  <Text as="p" variant="bodyMd">
                    Attach <strong>{plan.imageCount}</strong> images
                  </Text>
                  {(plan.skippedCount ?? 0) > 0 && (
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Skip {plan.skippedCount} blocked product(s)
                    </Text>
                  )}
                </BlockStack>
                <Divider />
                <Text as="p" variant="bodySm" tone="subdued">
                  Existing products will not be modified.
                </Text>
              </BlockStack>
            </Modal.Section>
          </Modal>
        )}
      </BlockStack>
    </Page>
  );
}
