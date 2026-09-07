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
import { SkuGenerationModal } from "../components/SkuGenerationModal.js";

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
  const [skuModalOpen, setSkuModalOpen] = useState(false);

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
      <Page title="Catalog Update Review">
        <Card>
          <InlineStack align="center" gap="200">
            <Spinner size="small" />
            <Text as="p">Loading review...</Text>
          </InlineStack>
        </Card>
      </Page>
    );
  }

  const hasBlocking = (issues?.summary.blocked ?? 0) > 0;
  const readyCount = (issues?.summary.ready ?? 0) + (issues?.summary.needsReview ?? 0);
  const allBlocked = readyCount === 0 && hasBlocking;

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
      title="Catalog Update Review"
      subtitle={catalog?.fileName}
      backAction={{ onAction: onBack }}
      primaryAction={{
        content: allBlocked
          ? "No products to import"
          : `Import ${readyCount} product${readyCount !== 1 ? "s" : ""}`,
        onAction: handleCreatePlan,
        loading: planLoading,
        disabled: allBlocked,
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
          <Banner title={`${issues?.summary.blocked} product(s) will be skipped`} tone="critical">
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                These products have issues that prevent import. The remaining
                {readyCount > 0 ? ` ${readyCount}` : ""} valid product(s) can still be imported.
              </Text>
              {issues?.blocking && issues.blocking.length > 0 && (
                <BlockStack gap="100">
                  {(() => {
                    const groups = new Map<string, { message: string; keys: Set<string> }>();
                    for (const issue of issues.blocking) {
                      const existing = groups.get(issue.code);
                      if (existing) {
                        if (issue.sourceKey) existing.keys.add(issue.sourceKey);
                      } else {
                        const keys = new Set<string>();
                        if (issue.sourceKey) keys.add(issue.sourceKey);
                        groups.set(issue.code, { message: issue.message, keys });
                      }
                    }
                    return [...groups.entries()].map(([code, { message, keys }]) => (
                      <Text as="p" variant="bodySm" key={code}>
                        • <strong>{code}</strong>: {message} — {keys.size} product{keys.size !== 1 ? "s" : ""} affected
                      </Text>
                    ));
                  })()}
                </BlockStack>
              )}
            </BlockStack>
          </Banner>
        )}

        {/* SKU Coverage Summary */}
        {issues?.skuCoverage && issues.skuCoverage.totalVariants > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                SKU coverage
              </Text>
              <InlineStack gap="600">
                <BlockStack gap="100">
                  <Text as="p" variant="headingLg">
                    {issues.skuCoverage.withSku + issues.skuCoverage.generatedSku}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {issues.skuCoverage.generatedSku > 0
                      ? `${issues.skuCoverage.withSku} source + ${issues.skuCoverage.generatedSku} generated`
                      : "supplier/merchant SKUs"}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="headingLg" tone={issues.skuCoverage.missingSku > 0 ? "caution" : "success"}>
                    {issues.skuCoverage.missingSku}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    missing SKUs
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="headingLg">
                    {issues.skuCoverage.duplicateSkus}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    duplicate SKUs
                  </Text>
                </BlockStack>
              </InlineStack>
              {issues.skuCoverage.missingSku > 0 && (
                <>
                  <Text as="p" variant="bodySm" tone="subdued">
                    ✓ Missing SKUs won't block this import
                  </Text>
                  <InlineStack gap="200">
                    <Button variant="plain" onClick={() => setSkuModalOpen(true)}>
                      Generate SKUs…
                    </Button>
                  </InlineStack>
                </>
              )}
            </BlockStack>
          </Card>
        )}

        {/* MISSING_SKU Warning Banner — separate from other warnings */}
        {issues?.skuCoverage && issues.skuCoverage.missingSku > 0 && (
          <Banner
            title={`${issues.skuCoverage.missingSku} variant${issues.skuCoverage.missingSku !== 1 ? "s" : ""} do not have SKUs`}
            tone="warning"
          >
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                Shopify allows products to be imported without SKUs. However, unique SKUs
                can make inventory operations, fulfillment, supplier matching, and
                third-party integrations easier.
              </Text>
              <InlineStack gap="200">
                <Button variant="plain" onClick={() => setSkuModalOpen(true)}>
                  Generate SKUs…
                </Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        )}

        {/* Other Warnings (excluding MISSING_SKU which has its own banner) */}
        {issues && issues.warning && issues.warning.filter((w) => w.code !== "MISSING_SKU").length > 0 && (
          <Banner title="Warnings" tone="warning">
            <BlockStack gap="100">
              {(() => {
                // Group warnings by code and count unique products, excluding MISSING_SKU
                const groups = new Map<string, { message: string; keys: Set<string> }>();
                for (const issue of issues.warning.filter((w) => w.code !== "MISSING_SKU")) {
                  const existing = groups.get(issue.code);
                  if (existing) {
                    if (issue.sourceKey) existing.keys.add(issue.sourceKey);
                  } else {
                    const keys = new Set<string>();
                    if (issue.sourceKey) keys.add(issue.sourceKey);
                    groups.set(issue.code, { message: issue.message, keys });
                  }
                }
                return [...groups.entries()].map(([code, { message, keys }]) => (
                  <Text as="p" variant="bodySm" key={code}>
                    • <strong>{code}</strong>: {message} — {keys.size} product{keys.size !== 1 ? "s" : ""} affected
                  </Text>
                ));
              })()}
              <Text as="p" variant="bodySm" tone="subdued">
                Go back to Edit to resolve these issues before importing.
              </Text>
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

                {/* SKU Summary in Import Plan */}
                {issues?.skuCoverage && (
                  <>
                    <Divider />
                    <Text as="h3" variant="headingSm">
                      SKU coverage
                    </Text>
                    <BlockStack gap="100">
                      {issues.skuCoverage.withSku > 0 && (
                        <Text as="p" variant="bodyMd">
                          {issues.skuCoverage.withSku} supplier/merchant SKUs
                        </Text>
                      )}
                      {issues.skuCoverage.generatedSku > 0 && (
                        <Text as="p" variant="bodyMd">
                          {issues.skuCoverage.generatedSku} StoreDelivery-generated SKUs
                        </Text>
                      )}
                      {issues.skuCoverage.missingSku > 0 && (
                        <Text as="p" variant="bodyMd" tone="subdued">
                          {issues.skuCoverage.missingSku} missing (won't block import)
                        </Text>
                      )}
                    </BlockStack>
                  </>
                )}

                <Divider />
                <Text as="p" variant="bodySm" tone="subdued">
                  Existing products will not be modified.
                </Text>
              </BlockStack>
            </Modal.Section>
          </Modal>
        )}

        {/* SKU Generation Modal */}
        <SkuGenerationModal
          open={skuModalOpen}
          catalogId={catalogId}
          missingCount={issues?.skuCoverage?.missingSku ?? 0}
          onClose={() => setSkuModalOpen(false)}
          onGenerated={() => {
            setSkuModalOpen(false);
            loadData(page);
          }}
        />
      </BlockStack>
    </Page>
  );
}
