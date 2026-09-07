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
  Icon,
  Modal,
  Select,
  Divider,
  Box,
} from "@shopify/polaris";
import {
  getEditIssues,
  getEditPreview,
  editProduct,
  runAutoFix,
  clearAllOverrides,
  bulkEdit,
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
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);
  const [overrideStats, setOverrideStats] = useState({ productsWithOverrides: 0, totalOverrides: 0 });

  // Auto-fix state
  const [autoFixResult, setAutoFixResult] = useState<AutoFixResult | null>(null);
  const [autoFixing, setAutoFixing] = useState(false);

  // Bulk edit modal
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkField, setBulkField] = useState("vendor");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkAction, setBulkAction] = useState<"set_value" | "replace_value" | "clear_value">("set_value");
  const [bulkApplying, setBulkApplying] = useState(false);

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

  // Reload on tab change
  useEffect(() => {
    setPage(1);
    loadData(1);
  }, [activeTab, loadData]);

  const reload = useCallback(() => loadData(page), [loadData, page]);

  // -------------------------------------------------------------------------
  // Auto-fix
  // -------------------------------------------------------------------------

  const handleAutoFix = useCallback(async () => {
    setAutoFixing(true);
    try {
      const result = await runAutoFix(catalogId);
      setAutoFixResult(result);
      reload();
    } catch {
      // error
    } finally {
      setAutoFixing(false);
    }
  }, [catalogId, reload]);

  const handleUndoAutoFixes = useCallback(async () => {
    await clearAllOverrides(catalogId, "auto_fix");
    setAutoFixResult(null);
    reload();
  }, [catalogId, reload]);

  // -------------------------------------------------------------------------
  // Reset all edits
  // -------------------------------------------------------------------------

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
  // Bulk edit
  // -------------------------------------------------------------------------

  const handleBulkApply = useCallback(async () => {
    setBulkApplying(true);
    try {
      await bulkEdit(catalogId, bulkAction, bulkField, bulkValue);
      setBulkModalOpen(false);
      setBulkValue("");
      reload();
    } catch {
      // error
    } finally {
      setBulkApplying(false);
    }
  }, [catalogId, bulkAction, bulkField, bulkValue, reload]);

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
    reload();
    // Keep panel open so merchant can see the "Apply to all" option
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
    let count: number | undefined;
    if (tab.id === "all") count = summary?.total ?? 0;
    else if (tab.id === "blocking") count = summary?.blocking ?? 0;
    else if (tab.id === "warning") count = summary?.warning ?? 0;
    else count = typeCounts[tab.id] ?? 0;
    return {
      ...tab,
      content: `${tab.content}${count !== undefined ? ` (${count})` : ""}`,
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
              Review ({String(productIssues.length)})
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
      subtitle={`${total} products · ${overrideStats.totalOverrides} edits`}
      backAction={{ onAction: onBack }}
      primaryAction={{
        content: readyCount > 0 ? `Import ${readyCount} products` : "No products to import",
        onAction: () => onImport(catalogId),
        disabled: readyCount === 0,
      }}
      secondaryActions={[
        ...(hasEdits ? [{
          content: `Reset all edits (${overrideStats.totalOverrides})`,
          onAction: handleResetAll,
          loading: resetting,
          destructive: true,
        }] : []),
        {
          content: "Bulk edit",
          onAction: () => setBulkModalOpen(true),
        },
      ]}
    >
      <BlockStack gap="400">
        {/* Issue Summary Banner */}
        {summary && (summary.blocking > 0 || summary.warning > 0) && (
          <Card>
            <InlineStack gap="600">
              <BlockStack gap="100">
                <Text as="p" variant="headingLg">{total}</Text>
                <Text as="p" variant="bodySm" tone="subdued">products</Text>
              </BlockStack>
              {summary.blocking > 0 && (
                <BlockStack gap="100">
                  <Text as="p" variant="headingLg" tone="critical">{summary.blocking}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">blocking</Text>
                </BlockStack>
              )}
              {summary.warning > 0 && (
                <BlockStack gap="100">
                  <Text as="p" variant="headingLg" tone="caution">{summary.warning}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">warnings</Text>
                </BlockStack>
              )}
              {overrideStats.totalOverrides > 0 && (
                <BlockStack gap="100">
                  <Text as="p" variant="headingLg" tone="success">{overrideStats.totalOverrides}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">edits applied</Text>
                </BlockStack>
              )}
            </InlineStack>
          </Card>
        )}

        {/* Auto-fix */}
        {!autoFixResult ? (
          <Card>
            <InlineStack align="space-between">
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm">Auto-fix</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Automatically fix whitespace, currency symbols, weight units, and other safe corrections.
                </Text>
              </BlockStack>
              <Button onClick={handleAutoFix} loading={autoFixing}>
                Run auto-fix
              </Button>
            </InlineStack>
          </Card>
        ) : (
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

      {/* Bulk Edit Modal */}
      <Modal
        open={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
        title="Bulk Edit"
        primaryAction={{
          content: "Apply",
          onAction: handleBulkApply,
          loading: bulkApplying,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setBulkModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Select
              label="Action"
              options={[
                { label: "Set value", value: "set_value" },
                { label: "Replace value", value: "replace_value" },
                { label: "Clear value", value: "clear_value" },
              ]}
              value={bulkAction}
              onChange={(v) => setBulkAction(v as typeof bulkAction)}
            />
            <Select
              label="Field"
              options={[
                { label: "Title", value: "title" },
                { label: "Vendor", value: "vendor" },
                { label: "Product Type", value: "productType" },
                { label: "Description", value: "description" },
                { label: "Price (first variant)", value: "variants[0].price" },
                { label: "SKU (first variant)", value: "variants[0].sku" },
              ]}
              value={bulkField}
              onChange={setBulkField}
            />
            {bulkAction !== "clear_value" && (
              <TextField
                label={bulkAction === "replace_value" ? "Replace with" : "Value"}
                value={bulkValue}
                onChange={setBulkValue}
                autoComplete="off"
              />
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
