/**
 * Inline Edit Page — issue summary, filter tabs, product grid with inline
 * editing, auto-fix controls, undo, and before/after indicators.
 *
 * Combines P2.1 through P2.5 in one page.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  Banner,
  Button,
  TextField,
  BlockStack,
  InlineStack,
  Text,
  Pagination,
  Spinner,
  Tabs,
  Tooltip,
} from "@shopify/polaris";
import {
  getEditIssues,
  getEditPreview,
  editProduct,
  runAutoFix,
  clearAllOverrides,
  findSimilarIssues,
  type EditIssueSummary,
  type EditIssue,
  type PreviewProduct,
  type AutoFixResult,
  type SimilarIssuesResponse,
} from "../api-client.js";
import { IssueSidePanel } from "../components/IssueSidePanel.js";
import type { CatalogProduct } from "../../shared/types/catalog.js";

type Props = {
  catalogId: string;
  onBack: () => void;
  onImport: (catalogId: string) => void;
};

// ---------------------------------------------------------------------------
// Issue filter tabs
// ---------------------------------------------------------------------------

const FILTER_TABS = [
  { id: "all", content: "All" },
  { id: "blocking", content: "Blocking" },
  { id: "warning", content: "Warnings" },
  { id: "missing_value", content: "Missing Field" },
  { id: "duplicate", content: "Duplicate" },
  { id: "invalid_value", content: "Invalid Value" },
  { id: "image", content: "Image" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityBadge(severity: string) {
  switch (severity) {
    case "blocking": return <Badge tone="critical">Blocking</Badge>;
    case "warning": return <Badge tone="warning">Warning</Badge>;
    case "info": return <Badge tone="info">Info</Badge>;
    default: return <Badge>{severity}</Badge>;
  }
}

function statusBadge(status: string, hasOverrides: boolean) {
  if (hasOverrides) return <Badge tone="attention">Edited</Badge>;
  switch (status) {
    case "ready": return <Badge tone="success">Ready</Badge>;
    case "needs_review": return <Badge tone="warning">Review</Badge>;
    case "blocked": return <Badge tone="critical">Blocked</Badge>;
    default: return <Badge>{status}</Badge>;
  }
}

// ---------------------------------------------------------------------------
// Inline editable cell
// ---------------------------------------------------------------------------

function EditableCell({
  value,
  originalValue,
  field,
  productId,
  catalogId,
  onSave,
}: {
  value: string;
  originalValue?: string;
  field: string;
  productId: string;
  catalogId: string;
  onSave: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const isModified = originalValue !== undefined && originalValue !== value;

  const handleSave = useCallback(async () => {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await editProduct(catalogId, productId, [{ field, value: draft }]);
      onSave();
    } catch {
      // revert on error
      setDraft(value);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }, [draft, value, catalogId, productId, field, onSave]);

  if (editing) {
    return (
      <TextField
        label=""
        labelHidden
        value={draft}
        onChange={setDraft}
        autoComplete="off"
        onBlur={handleSave}
        focused
        disabled={saving}
        connectedRight={
          saving ? <Spinner size="small" /> : undefined
        }
      />
    );
  }

  return (
    <div
      onClick={() => { setDraft(value); setEditing(true); }}
      style={{
        cursor: "pointer",
        padding: "4px 8px",
        borderRadius: "4px",
        background: isModified ? "var(--p-color-bg-surface-warning)" : undefined,
        position: "relative",
        minHeight: "24px",
      }}
    >
      {isModified && (
        <Tooltip content={`Original: ${originalValue}`}>
          <Text as="span" variant="bodySm" tone="subdued" textDecorationLine="line-through">
            {originalValue}
          </Text>
          {" → "}
        </Tooltip>
      )}
      <Text as="span" variant="bodySm">
        {value || "—"}
      </Text>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Edit Page
// ---------------------------------------------------------------------------

export function EditPage({ catalogId, onBack, onImport }: Props) {
  // State
  const [summary, setSummary] = useState<EditIssueSummary | null>(null);
  const [issues, setIssues] = useState<EditIssue[]>([]);
  const [products, setProducts] = useState<PreviewProduct[]>([]);
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({});
  const [typeProductCounts, setTypeProductCounts] = useState<Record<string, number>>({});
  const [severityProductCounts, setSeverityProductCounts] = useState<Record<string, number>>({});
  const [totalProducts, setTotalProducts] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);
  const [overrideStats, setOverrideStats] = useState({ productsWithOverrides: 0, totalOverrides: 0 });

  // Auto-fix state
  const [autoFixResult, setAutoFixResult] = useState<AutoFixResult | null>(null);

  // Reset state
  const [resetting, setResetting] = useState(false);

  // Side panel state
  const [selectedIssue, setSelectedIssue] = useState<EditIssue | null>(null);
  const [similarData, setSimilarData] = useState<SimilarIssuesResponse | null>(null);
  const [loadingSimilar, setLoadingSimilar] = useState(false);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  const loadData = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const selectedTab = FILTER_TABS[activeTab];
      const issueOpts: { type?: string; severity?: string; page?: number; pageSize?: number } = { page: 1, pageSize: 100 };

      // Map tab to filter
      if (selectedTab.id === "blocking") issueOpts.severity = "blocking";
      else if (selectedTab.id === "warning") issueOpts.severity = "warning";
      else if (selectedTab.id !== "all") issueOpts.type = selectedTab.id;

      // Build preview filters to match the tab
      const previewFilters: { severity?: string; issueType?: string } = {};
      if (selectedTab.id === "blocking") previewFilters.severity = "blocking";
      else if (selectedTab.id === "warning") previewFilters.severity = "warning";
      else if (selectedTab.id !== "all") previewFilters.issueType = selectedTab.id;

      const [issueRes, previewRes] = await Promise.all([
        getEditIssues(catalogId, issueOpts),
        getEditPreview(catalogId, p, 20, selectedTab.id === "all" ? undefined : previewFilters),
      ]);

      setSummary(issueRes.summary);
      setIssues(issueRes.issues);
      setTypeCounts(issueRes.typeCounts);
      setTypeProductCounts(issueRes.typeProductCounts ?? {});
      setSeverityProductCounts(issueRes.severityProductCounts ?? {});
      setTotalProducts(issueRes.totalProducts ?? 0);
      setProducts(previewRes.products);
      setTotalPages(previewRes.totalPages);
      setTotal(previewRes.total);
      setOverrideStats(previewRes.overrideStats);
    } catch {
      // handle error silently
    } finally {
      setLoading(false);
    }
  }, [catalogId, activeTab]);

  useEffect(() => {
    loadData(page);
  }, [page, loadData]);

  // Run auto-fix on first load (silently — only shows if it finds something)
  useEffect(() => {
    if (!autoFixResult) {
      runAutoFix(catalogId).then((result) => {
        if (result.totalFixed > 0) {
          setAutoFixResult(result);
          loadData(1);
        }
      }).catch(() => {});
    }
  }, [catalogId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload on tab change
  useEffect(() => {
    setPage(1);
    loadData(1);
  }, [activeTab, loadData]);

  const reload = useCallback(() => loadData(page), [loadData, page]);

  // -------------------------------------------------------------------------
  // Reset all edits
  // -------------------------------------------------------------------------

  const handleUndoAutoFixes = useCallback(async () => {
    await clearAllOverrides(catalogId, "auto_fix");
    setAutoFixResult(null);
    reload();
  }, [catalogId, reload]);

  const handleResetAll = useCallback(async () => {
    setResetting(true);
    try {
      await clearAllOverrides(catalogId);
      setAutoFixResult(null);
      reload();
    } catch {
      // error
    } finally {
      setResetting(false);
    }
  }, [catalogId, reload]);

  // -------------------------------------------------------------------------
  // Issue side panel
  // -------------------------------------------------------------------------

  const handleIssueClick = useCallback(async (issue: EditIssue) => {
    setSelectedIssue(issue);
    setLoadingSimilar(true);
    setSimilarData(null);
    try {
      const data = await findSimilarIssues(catalogId, issue.code, issue.field ?? undefined);
      setSimilarData(data);
    } catch {
      // silent
    } finally {
      setLoadingSimilar(false);
    }
  }, [catalogId]);

  const handleSidePanelClose = useCallback(() => {
    setSelectedIssue(null);
    setSimilarData(null);
  }, []);

  const handleSidePanelResolved = useCallback(() => {
    // Close the sidebar and reload data so counts, review buttons, and grid all update
    setSelectedIssue(null);
    setSimilarData(null);
    reload();
  }, [reload]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading && !summary) {
    return (
      <Page title="Edit Catalog">
        <Card>
          <InlineStack align="center" gap="200">
            <Spinner size="small" />
            <Text as="p">Loading catalog...</Text>
          </InlineStack>
        </Card>
      </Page>
    );
  }

  const readyCount = total - (summary?.blocking ?? 0);
  const hasEdits = overrideStats.totalOverrides > 0;

  // Tab content with counts
  const tabs = FILTER_TABS.map((tab) => {
    let count: number;
    if (tab.id === "all") count = totalProducts;
    else if (tab.id === "blocking") count = severityProductCounts["blocking"] ?? 0;
    else if (tab.id === "warning") count = severityProductCounts["warning"] ?? 0;
    else count = typeProductCounts[tab.id] ?? 0;
    return {
      ...tab,
      content: `${tab.content} (${count})`,
    };
  });

  // Product rows
  const rowMarkup = products.map((p, index) => {
    const resolved = p.resolved as CatalogProduct;
    const source = (p.source ?? p.resolved) as CatalogProduct;
    const firstVariant = resolved.variants?.[0];
    const sourceFirstVariant = source.variants?.[0];

    // Find issues for this product
    const productIssues = issues.filter((i) => i.sourceKey === p.sourceKey);

    return (
      <IndexTable.Row id={p.id} key={p.id} position={index}>
        <IndexTable.Cell>
          {productIssues.length > 0 ? (
            <Button
              size="slim"
              tone={productIssues.some((i) => i.severity === "blocking") ? "critical" : undefined}
              onClick={() => handleIssueClick(productIssues[0])}
            >
              Review
            </Button>
          ) : (
            statusBadge(p.status, p.hasOverrides)
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">{firstVariant?.sku ?? "—"}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <EditableCell
            value={resolved.title ?? ""}
            originalValue={p.hasOverrides ? (source.title ?? "") : undefined}
            field="title"
            productId={p.id}
            catalogId={catalogId}
            onSave={reload}
          />
        </IndexTable.Cell>
        <IndexTable.Cell>
          <EditableCell
            value={firstVariant?.price ?? ""}
            originalValue={p.hasOverrides ? (sourceFirstVariant?.price ?? "") : undefined}
            field="variants[0].price"
            productId={p.id}
            catalogId={catalogId}
            onSave={reload}
          />
        </IndexTable.Cell>
        <IndexTable.Cell>
          <EditableCell
            value={resolved.vendor ?? ""}
            originalValue={p.hasOverrides ? (source.vendor ?? "") : undefined}
            field="vendor"
            productId={p.id}
            catalogId={catalogId}
            onSave={reload}
          />
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">{resolved.variants?.length ?? 0}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">{resolved.images?.length ?? 0}</Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      title="Edit Catalog"
      subtitle={`${total} products${overrideStats.productsWithOverrides > 0 ? ` · ${overrideStats.productsWithOverrides} edited` : ""}`}
      backAction={{ onAction: onBack }}
      primaryAction={{
        content: readyCount > 0 ? `Import ${readyCount} products` : "No products to import",
        onAction: () => onImport(catalogId),
        disabled: readyCount === 0,
      }}
      secondaryActions={
        hasEdits ? [{
          content: `Reset all edits (${overrideStats.productsWithOverrides} products)`,
          onAction: handleResetAll,
          loading: resetting,
          destructive: true,
        }] : undefined
      }
    >
      <BlockStack gap="400">
        {/* Issue Summary Banner */}
        {summary && (
          <Card>
            <InlineStack gap="600">
              <BlockStack gap="100">
                <Text as="p" variant="headingLg">{totalProducts}</Text>
                <Text as="p" variant="bodySm" tone="subdued">products</Text>
              </BlockStack>
              {(severityProductCounts["blocking"] ?? 0) > 0 && (
                <BlockStack gap="100">
                  <Text as="p" variant="headingLg" tone="critical">{severityProductCounts["blocking"]}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">blocked</Text>
                </BlockStack>
              )}
              {(severityProductCounts["warning"] ?? 0) > 0 && (
                <BlockStack gap="100">
                  <Text as="p" variant="headingLg" tone="caution">{severityProductCounts["warning"]}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">with warnings</Text>
                </BlockStack>
              )}
              <BlockStack gap="100">
                <Text as="p" variant="headingLg" tone="success">
                  {totalProducts - (severityProductCounts["blocking"] ?? 0) - (severityProductCounts["warning"] ?? 0)}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">ready</Text>
              </BlockStack>
              {overrideStats.productsWithOverrides > 0 && (
                <BlockStack gap="100">
                  <Text as="p" variant="headingLg" tone="subdued">{overrideStats.productsWithOverrides}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">edited</Text>
                </BlockStack>
              )}
            </InlineStack>
          </Card>
        )}

        {/* Auto-fix — only show result after running, hide if nothing to fix */}
        {autoFixResult && autoFixResult.totalFixed > 0 && (
          <Card>
            <InlineStack align="space-between">
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm">
                  {autoFixResult.totalFixed} issues fixed automatically
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {Object.entries(autoFixResult.breakdown).map(
                    ([type, count]) => `${type}: ${count}`,
                  ).join(" · ")}
                </Text>
              </BlockStack>
              <Button onClick={handleUndoAutoFixes} tone="critical">
                Undo auto-fixes
              </Button>
            </InlineStack>
          </Card>
        )}

        {/* Filter Tabs */}
        <Tabs tabs={tabs} selected={activeTab} onSelect={setActiveTab} />

        {/* Product Grid */}
        <Card padding="0">
          <IndexTable
            itemCount={products.length}
            headings={[
              { title: "Status" },
              { title: "SKU" },
              { title: "Title" },
              { title: "Price" },
              { title: "Vendor" },
              { title: "Variants" },
              { title: "Images" },
            ]}
            selectable={false}
            loading={loading}
          >
            {rowMarkup}
          </IndexTable>
        </Card>

        {/* Pagination */}
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

      {/* Right sidebar overlay for issue resolution */}
      {selectedIssue && (
        <div
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            width: "420px",
            height: "100vh",
            background: "var(--p-color-bg-surface)",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
            zIndex: 1000,
            overflowY: "auto",
            padding: "20px",
          }}
        >
          {loadingSimilar ? (
            <Card>
              <InlineStack align="center" gap="200">
                <Spinner size="small" />
                <Text as="p">Finding similar issues...</Text>
              </InlineStack>
            </Card>
          ) : (
            <IssueSidePanel
              issue={selectedIssue}
              catalogId={catalogId}
              similarCount={similarData?.affectedCount ?? 1}
              similarKeys={similarData?.affectedKeys ?? (selectedIssue.sourceKey ? [selectedIssue.sourceKey] : [])}
              detectedFields={similarData?.detectedFields}
              suggestedFix={similarData?.suggestedFix ?? undefined}
              onClose={handleSidePanelClose}
              onResolved={handleSidePanelResolved}
            />
          )}
        </div>
      )}

      {/* Backdrop when sidebar is open */}
      {selectedIssue && (
        <div
          onClick={handleSidePanelClose}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.3)",
            zIndex: 999,
          }}
        />
      )}

    </Page>
  );
}
