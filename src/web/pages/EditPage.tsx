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
  Divider,
} from "@shopify/polaris";
import {
  getEditIssues,
  getEditPreview,
  editProduct,
  runAutoFix,
  clearAllOverrides,
  findSimilarIssues,
  runReconciliation as runReconApi,
  applyUpdates,
  getCatalog,
  getCatalogVendor,
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
  { id: "ready", content: "Ready" },
  { id: "blocking", content: "Blocking" },
  { id: "warning", content: "Warnings" },
  { id: "updates", content: "Updates" },
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
      onDoubleClick={(e) => { e.stopPropagation(); setDraft(value); setEditing(true); }}
      style={{
        cursor: "text",
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
  const [catalogLevelWarningCount, setCatalogLevelWarningCount] = useState(0);
  const [totalProducts, setTotalProducts] = useState(0);
  const [page, setPage] = useState(1);
  const [fileName, setFileName] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);
  const [overrideStats, setOverrideStats] = useState({ productsWithOverrides: 0, totalOverrides: 0 });

  // Auto-fix state
  const [autoFixResult, setAutoFixResult] = useState<AutoFixResult | null>(null);

  // Reset state
  const [resetting, setResetting] = useState(false);

  // Reconciliation / updates state
  const [updateReview, setUpdateReview] = useState<{
    catalogId: string;
    catalogRunId: string;
    totalWithChanges: number;
    products: import("../api-client.js").ProductDiffItem[];
  } | null>(null);
  const [reconLoading, setReconLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Loading catalog...");
  const [missingProducts, setMissingProducts] = useState<Array<{ shopifyProductId: string | null; sourceValue: string | null }>>([]);
  const [applyingUpdates, setApplyingUpdates] = useState(false);
  const [updateResult, setUpdateResult] = useState<{ applied: number; failed: number; failures: Array<{ sourceProductKey: string; error?: string }> } | null>(null);

  // Side panel state
  const [selectedProductIssues, setSelectedProductIssues] = useState<EditIssue[]>([]);
  const [similarDataMap, setSimilarDataMap] = useState<Map<string, SimilarIssuesResponse>>(new Map());
  const [loadingSimilar, setLoadingSimilar] = useState(false);

  // Expanded product rows (shows variant sub-rows)
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

  // Selected product for side panel (shown for all rows, not just issues)
  const [selectedProductKey, setSelectedProductKey] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  const loadData = useCallback(async (p: number) => {
    setLoading(true);
    setLoadingMessage("Loading catalog...");
    try {
      const selectedTab = FILTER_TABS[activeTab];

      const issueOpts: { type?: string; severity?: string; page?: number; pageSize?: number } = { page: 1, pageSize: 100 };

      // Map tab to filter
      if (selectedTab.id === "blocking") issueOpts.severity = "blocking";
      else if (selectedTab.id === "warning") issueOpts.severity = "warning";

      // Build preview filters to match the tab
      const previewFilters: { severity?: string; issueType?: string } = {};
      if (selectedTab.id === "blocking") previewFilters.severity = "blocking";
      else if (selectedTab.id === "warning") previewFilters.severity = "warning";

      if (selectedTab.id === "updates") {
        // Updates tab: just load issue summary for tab counts, recon data already loaded
        const issueRes = await getEditIssues(catalogId, { page: 1, pageSize: 100 });
        setSummary(issueRes.summary);
        setIssues(issueRes.issues);
        setTypeCounts(issueRes.typeCounts);
        setTypeProductCounts(issueRes.typeProductCounts ?? {});
        setSeverityProductCounts(issueRes.severityProductCounts ?? {});
        setCatalogLevelWarningCount(issueRes.catalogLevelWarningCount ?? 0);
        setTotalProducts(issueRes.totalProducts ?? 0);
        setProducts([]);
        setTotalPages(1);
        setTotal(0);
        setOverrideStats({ productsWithOverrides: 0, totalOverrides: 0 });
        setLoading(false);
        return;
      }

      const [issueRes, previewRes] = await Promise.all([
        getEditIssues(catalogId, issueOpts),
        getEditPreview(catalogId, p, 20, (selectedTab.id === "blocking" || selectedTab.id === "warning") ? previewFilters : undefined),
      ]);

      setSummary(issueRes.summary);
      setIssues(issueRes.issues);
      setTypeCounts(issueRes.typeCounts);
      setTypeProductCounts(issueRes.typeProductCounts ?? {});
      setSeverityProductCounts(issueRes.severityProductCounts ?? {});
      setCatalogLevelWarningCount(issueRes.catalogLevelWarningCount ?? 0);
      setTotalProducts(issueRes.totalProducts ?? 0);

      // For the Ready tab, filter to only products without issues
      if (selectedTab.id === "ready") {
        const issueKeys = new Set(issueRes.issues.map((i) => i.sourceKey).filter(Boolean));
        const readyProducts = previewRes.products.filter((p) => !issueKeys.has(p.sourceKey));
        setProducts(readyProducts);
        setTotalPages(1);
        setTotal(readyProducts.length);
      } else {
        setProducts(previewRes.products);
        setTotalPages(previewRes.totalPages);
        setTotal(previewRes.total);
      }
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
  // Also fetch catalog metadata (fileName, vendor) for display throughout
  useEffect(() => {
    Promise.all([
      getCatalog(catalogId),
      getCatalogVendor(catalogId),
    ]).then(([catalogRes, vendorRes]) => {
      setFileName(catalogRes.fileName ?? null);
      setVendorName(vendorRes.vendor?.name ?? null);
    }).catch(() => {});

    if (!autoFixResult) {
      runAutoFix(catalogId).then((result) => {
        if (result.totalFixed > 0) {
          setAutoFixResult(result);
          loadData(1);
        }
      }).catch(() => {});
    }
  }, [catalogId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Run reconciliation at page load in parallel with the main data fetch.
  // This populates the Updates tab count and data without waiting for the user
  // to click that tab.
  useEffect(() => {
    setReconLoading(true);
    setLoadingMessage("Checking for updates against Shopify...");
    runReconApi(catalogId)
      .then((reconResult) => {
        setUpdateReview(
          reconResult.diffs && reconResult.diffs.length > 0
            ? {
                catalogId,
                catalogRunId: reconResult.catalogRunId,
                totalWithChanges: reconResult.diffs.length,
                products: reconResult.diffs,
              }
            : null,
        );
        setMissingProducts(reconResult.missingProducts ?? []);
      })
      .catch(() => {})
      .finally(() => {
        setReconLoading(false);
        setLoadingMessage("Loading catalog...");
      });
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

  const handleIssueClick = useCallback(async (productIssues: EditIssue[]) => {
    setSelectedProductIssues(productIssues);
    setSelectedProductKey(productIssues[0]?.sourceKey ?? null);
    setLoadingSimilar(true);
    setSimilarDataMap(new Map());
    try {
      const newMap = new Map<string, SimilarIssuesResponse>();
      const seenCodes = new Set<string>();
      for (const issue of productIssues) {
        if (seenCodes.has(issue.code)) continue;
        seenCodes.add(issue.code);
        const data = await findSimilarIssues(catalogId, issue.code, issue.field ?? undefined, issue.sourceKey ?? undefined);
        newMap.set(issue.code, data);
      }
      setSimilarDataMap(newMap);
    } catch {
      // silent
    } finally {
      setLoadingSimilar(false);
    }
  }, [catalogId]);

  const handleSidePanelClose = useCallback(() => {
    setSelectedProductIssues([]);
    setSelectedProductKey(null);
    setSimilarDataMap(new Map());
  }, []);

  const handleSidePanelResolved = useCallback(() => {
    setSelectedProductIssues([]);
    setSelectedProductKey(null);
    setSimilarDataMap(new Map());
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
            <Text as="p">{loadingMessage}</Text>
          </InlineStack>
        </Card>
      </Page>
    );
  }

  const readyCount = total - (summary?.blocking ?? 0);
  const hasEdits = overrideStats.totalOverrides > 0;
  const sidebarOpen = selectedProductKey !== null;

  // Tab content with counts
  const tabs = FILTER_TABS.map((tab) => {
    let count: number;
    if (tab.id === "ready") count = totalProducts - (severityProductCounts["blocking"] ?? 0) - (severityProductCounts["warning"] ?? 0);
    else if (tab.id === "blocking") count = severityProductCounts["blocking"] ?? 0;
    else if (tab.id === "warning") count = (severityProductCounts["warning"] ?? 0) + catalogLevelWarningCount;
    else if (tab.id === "updates") count = updateReview?.totalWithChanges ?? 0;
    else count = 0;
    return {
      ...tab,
      content: `${tab.content} (${count})`,
    };
  });

  // Product rows with expandable variant sub-rows
  const rowMarkup: React.ReactNode[] = [];
  let position = 0;

  for (const p of products) {
    const resolved = p.resolved as CatalogProduct;
    const source = (p.source ?? p.resolved) as CatalogProduct;
    const firstVariant = resolved.variants?.[0];
    const sourceFirstVariant = source.variants?.[0];
    const productIssues = issues.filter((i) => i.sourceKey === p.sourceKey);
    const isExpanded = expandedProducts.has(p.id);
    const variantCount = resolved.variants?.length ?? 0;

    // Product row
    rowMarkup.push(
      <IndexTable.Row
        id={p.id}
        key={p.id}
        position={position++}
        onClick={() => {
          if (productIssues.length > 0) {
            handleIssueClick(productIssues);
          } else {
            // Ready row — show product details in side panel without issues
            setSelectedProductIssues([]);
            setSelectedProductKey(p.sourceKey);
            setSimilarDataMap(new Map());
            // Load detected fields for the product
            setLoadingSimilar(true);
            findSimilarIssues(catalogId, "MISSING_SKU", undefined, p.sourceKey)
              .then((data) => {
                const fieldMap = new Map<string, SimilarIssuesResponse>();
                fieldMap.set("__product_details__", data);
                setSimilarDataMap(fieldMap);
              })
              .catch(() => {})
              .finally(() => setLoadingSimilar(false));
          }
        }}
      >
        <IndexTable.Cell>
          {productIssues.length > 0 ? (
            productIssues.some((i) => i.severity === "blocking")
              ? <Badge tone="critical">Blocked</Badge>
              : <Badge tone="warning">Review</Badge>
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
          {variantCount > 1 ? (
            <span
              role="button"
              tabIndex={0}
              style={{ cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                setExpandedProducts((prev) => {
                  const next = new Set(prev);
                  if (next.has(p.id)) next.delete(p.id);
                  else next.add(p.id);
                  return next;
                });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  setExpandedProducts((prev) => {
                    const next = new Set(prev);
                    if (next.has(p.id)) next.delete(p.id);
                    else next.add(p.id);
                    return next;
                  });
                }
              }}
            >
              <Text as="span" variant="bodySm">
                {isExpanded ? "▾" : "▸"} {String(variantCount)} variants
              </Text>
            </span>
          ) : (
            <Text as="span" variant="bodySm">{variantCount}</Text>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">{resolved.images?.length ?? 0}</Text>
        </IndexTable.Cell>
      </IndexTable.Row>,
    );

    // Variant sub-rows (when expanded)
    if (isExpanded && variantCount > 1) {
      for (let vi = 0; vi < resolved.variants.length; vi++) {
        const variant = resolved.variants[vi];
        const sourceVariant = source.variants?.[vi];
        const optionStr = Object.entries(variant.options ?? {})
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ") || "—";

        rowMarkup.push(
          <IndexTable.Row
            id={`${p.id}-v${vi}`}
            key={`${p.id}-v${vi}`}
            position={position++}
          >
            <IndexTable.Cell>
              <span style={{ paddingLeft: "20px", color: "var(--p-color-text-subdued)" }}>
                ↳
              </span>
            </IndexTable.Cell>
            <IndexTable.Cell>
              <Text as="span" variant="bodySm" tone="subdued">
                {variant.sku ?? "—"}
              </Text>
            </IndexTable.Cell>
            <IndexTable.Cell>
              <Text as="span" variant="bodySm" tone="subdued">
                {optionStr}
              </Text>
            </IndexTable.Cell>
            <IndexTable.Cell>
              <EditableCell
                value={variant.price ?? ""}
                originalValue={p.hasOverrides ? (sourceVariant?.price ?? "") : undefined}
                field={`variants[${vi}].price`}
                productId={p.id}
                catalogId={catalogId}
                onSave={reload}
              />
            </IndexTable.Cell>
            <IndexTable.Cell>
              <Text as="span" variant="bodySm" tone="subdued">
                {variant.barcode ?? "—"}
              </Text>
            </IndexTable.Cell>
            <IndexTable.Cell>
              <Text as="span" variant="bodySm" tone="subdued">
                {variant.inventoryQuantity ?? "—"}
              </Text>
            </IndexTable.Cell>
            <IndexTable.Cell>
              {variant.weight != null ? (
                <Text as="span" variant="bodySm" tone="subdued">
                  {variant.weight} {variant.weightUnit ?? ""}
                </Text>
              ) : (
                <Text as="span" variant="bodySm" tone="subdued">—</Text>
              )}
            </IndexTable.Cell>
          </IndexTable.Row>,
        );
      }
    }
  }

  return (
    <Page
      title={vendorName ? `Edit Catalog — ${vendorName}` : "Edit Catalog"}
      subtitle={[fileName, `${totalProducts} products${overrideStats.productsWithOverrides > 0 ? ` · ${overrideStats.productsWithOverrides} edited` : ""}`].filter(Boolean).join(" · ")}
      backAction={{ onAction: onBack }}
      primaryAction={{
        content: "Review Catalog Changes",
        onAction: () => onImport(catalogId),
        disabled: readyCount === 0 && (updateReview?.totalWithChanges ?? 0) === 0,
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
        {/* Reconciliation in-progress indicator — shown on all tabs while recon runs */}
        {reconLoading && (
          <Banner tone="info">
            <InlineStack gap="200" blockAlign="center">
              <Spinner size="small" />
              <Text as="p" variant="bodySm">Checking for updates against Shopify...</Text>
            </InlineStack>
          </Banner>
        )}

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

        {/* Catalog-level issues — shown inside the active tab context */}
        {(() => {
          const selectedTab = FILTER_TABS[activeTab];
          if (selectedTab.id === "ready") return null; // Ready tab stays clean

          const catalogIssues = issues.filter((i) => !i.sourceKey);

          let filtered = catalogIssues;
          if (selectedTab.id === "blocking") {
            filtered = catalogIssues.filter((i) => i.severity === "blocking");
          } else if (selectedTab.id === "warning") {
            filtered = catalogIssues.filter((i) => i.severity === "warning");
          }
          // "all" shows everything

          if (filtered.length === 0) return null;

          const hasBlocking = filtered.some((i) => i.severity === "blocking");
          return (
            <Banner
              title={`${filtered.length} catalog-level issue${filtered.length !== 1 ? "s" : ""}`}
              tone={hasBlocking ? "critical" : "warning"}
            >
              <BlockStack gap="100">
                {filtered.map((w, i) => (
                  <Text as="p" variant="bodySm" key={i}>
                    • <strong>{w.code}</strong>: {w.message}
                  </Text>
                ))}
              </BlockStack>
            </Banner>
          );
        })()}

        {/* Per-product issue summary — grouped by issue code */}
        {(() => {
          const selectedTab = FILTER_TABS[activeTab];
          if (selectedTab.id === "ready") return null;

          const relevantIssues = selectedTab.id === "blocking"
            ? issues.filter((i) => i.severity === "blocking" && i.sourceKey)
            : selectedTab.id === "warning"
              ? issues.filter((i) => i.severity === "warning" && i.sourceKey)
              : issues.filter((i) => i.sourceKey);

          if (relevantIssues.length === 0) return null;

          const grouped = new Map<string, Set<string>>();
          for (const issue of relevantIssues) {
            const keys = grouped.get(issue.code) ?? new Set();
            if (issue.sourceKey) keys.add(issue.sourceKey);
            grouped.set(issue.code, keys);
          }

          return (
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  {grouped.size} issue type{grouped.size !== 1 ? "s" : ""} across {
                    new Set(relevantIssues.map((i) => i.sourceKey).filter(Boolean)).size
                  } product{new Set(relevantIssues.map((i) => i.sourceKey).filter(Boolean)).size !== 1 ? "s" : ""}
                </Text>
                <BlockStack gap="100">
                  {[...grouped.entries()].map(([code, keys]) => (
                    <Text as="p" variant="bodySm" key={code}>
                      • <strong>{code}</strong> — {keys.size} product{keys.size !== 1 ? "s" : ""}
                    </Text>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          );
        })()}

        {/* Updates Tab Content */}
        {FILTER_TABS[activeTab]?.id === "updates" && (
          <Card>
            <BlockStack gap="400">
              {reconLoading ? (
                <InlineStack align="center" gap="200">
                  <Spinner size="small" />
                  <Text as="p">Analyzing catalog against Shopify...</Text>
                </InlineStack>
              ) : updateReview && updateReview.totalWithChanges > 0 ? (
                <>
                  <InlineStack align="space-between">
                    <Text as="h3" variant="headingSm">
                      {updateReview.totalWithChanges} product{updateReview.totalWithChanges !== 1 ? "s" : ""} with updates
                    </Text>
                    <Button
                      onClick={async () => {
                        setApplyingUpdates(true);
                        try {
                          const selections = updateReview.products.map((p) => ({
                            sourceProductKey: p.sourceProductKey,
                            fields: [
                              ...p.productChanges.map((c) => ({ field: c.field, selected: true })),
                              ...p.variantChanges.flatMap((v) =>
                                v.changes.map((c) => ({ field: `variants.${c.field}`, selected: true })),
                              ),
                            ],
                          }));
                          const result = await applyUpdates(catalogId, selections);
                          setUpdateResult({
                            applied: result.applied,
                            failed: result.failed,
                            failures: result.results.filter((r) => !r.success),
                          });
                          loadData(1);
                        } catch { /* silent */ } finally {
                          setApplyingUpdates(false);
                        }
                      }}
                      loading={applyingUpdates}
                    >
                      Apply All Updates
                    </Button>
                  </InlineStack>

                  {updateResult && (
                    <Banner
                      title={`${updateResult.applied} applied, ${updateResult.failed} failed`}
                      tone={updateResult.failed > 0 ? "warning" : "success"}
                    >
                      {updateResult.failures.length > 0 && (
                        <BlockStack gap="100">
                          {updateResult.failures.map((f) => (
                            <Text as="p" variant="bodySm" key={f.sourceProductKey}>
                              • <strong>{f.sourceProductKey}</strong>
                              {f.error ? `: ${f.error}` : ""}
                            </Text>
                          ))}
                        </BlockStack>
                      )}
                    </Banner>
                  )}

                  <Text as="p" variant="bodySm" tone="subdued">
                    These products exist in Shopify but the supplier data differs.
                  </Text>

                  <Divider />

                  {updateReview.products.map((product) => (
                    <BlockStack key={product.sourceProductKey} gap="200">
                      <Text as="p" fontWeight="semibold">{product.sourceProductKey}</Text>
                      <BlockStack gap="100">
                        {product.productChanges.map((c, i) => (
                          <InlineStack key={`p-${i}`} gap="200">
                            <Badge>{c.field}</Badge>
                            <Text as="span" variant="bodySm" tone="subdued" textDecorationLine="line-through">
                              {c.shopifyValue ?? "(empty)"}
                            </Text>
                            <Text as="span" variant="bodySm">→</Text>
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              {c.supplierValue ?? "(empty)"}
                            </Text>
                          </InlineStack>
                        ))}
                        {product.variantChanges.map((v) => {
                          if (v.status === "added") {
                            return (
                              <InlineStack key={`v-added-${v.sourceVariantKey}`} gap="200" blockAlign="center">
                                <Badge tone="success">New variant</Badge>
                                <Badge tone="info">{v.sourceVariantKey}</Badge>
                                <Text as="span" variant="bodySm" tone="success">Will be added to Shopify</Text>
                              </InlineStack>
                            );
                          }
                          if (v.status === "discontinued") {
                            return (
                              <InlineStack key={`v-disc-${v.sourceVariantKey}`} gap="200" blockAlign="center">
                                <Badge tone="warning">Not in supplier file</Badge>
                                <Badge tone="info">{v.sourceVariantKey}</Badge>
                                <Text as="span" variant="bodySm" tone="subdued">Still in Shopify — no action taken</Text>
                              </InlineStack>
                            );
                          }
                          // status === "changed" — field-level diffs
                          return v.changes.map((c, i) => (
                            <InlineStack key={`v-${v.sourceVariantKey}-${i}`} gap="200">
                              <Badge tone="info">{v.sourceVariantKey}</Badge>
                              <Badge>{c.field}</Badge>
                              <Text as="span" variant="bodySm" tone="subdued" textDecorationLine="line-through">
                                {c.shopifyValue ?? "(empty)"}
                              </Text>
                              <Text as="span" variant="bodySm">→</Text>
                              <Text as="span" variant="bodySm" fontWeight="semibold">
                                {c.supplierValue ?? "(empty)"}
                              </Text>
                            </InlineStack>
                          ));
                        })}
                      </BlockStack>
                      <Divider />
                    </BlockStack>
                  ))}
                </>
              ) : (
                <Text as="p" variant="bodySm" tone="subdued">
                  No updates detected — all existing products match the supplier data.
                </Text>
              )}
            </BlockStack>
          </Card>
        )}

        {/* MISSING products — Catalog Update with vendor assigned */}
        {FILTER_TABS[activeTab]?.id === "updates" && missingProducts.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {missingProducts.length} product{missingProducts.length !== 1 ? "s" : ""} missing from this upload
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                These products belong to this vendor in Shopify but were not included in the uploaded file.
                No action is taken — review them manually if needed.
              </Text>
              <BlockStack gap="100">
                {missingProducts.map((p, i) => (
                  <InlineStack key={i} gap="300" blockAlign="center">
                    <Text as="span" variant="bodySm">{p.sourceValue ?? p.shopifyProductId ?? "Unknown product"}</Text>
                    {p.shopifyProductId && (
                      <a
                        href={`https://admin.shopify.com/store/products/${p.shopifyProductId.replace("gid://shopify/Product/", "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: "12px" }}
                      >
                        View in Shopify ↗
                      </a>
                    )}
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        {/* Product Grid — hidden on Updates tab */}
        {FILTER_TABS[activeTab]?.id !== "updates" && <Card padding="0">
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
        </Card>}

        {/* Pagination — hidden on Updates tab */}
        {FILTER_TABS[activeTab]?.id !== "updates" && totalPages > 1 && (
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

      {/* Right sidebar overlay — shows ALL issues for the selected product */}
      {sidebarOpen && (
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
                <Text as="p">Loading product details...</Text>
              </InlineStack>
            </Card>
          ) : (
            <BlockStack gap="400">
              {/* Header + close button */}
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  {selectedProductIssues.length > 0
                    ? `${selectedProductIssues.length} issue${selectedProductIssues.length !== 1 ? "s" : ""} for this product`
                    : "Product Details"}
                </Text>
                <Button variant="plain" onClick={handleSidePanelClose}>✕</Button>
              </InlineStack>

              {/* Product details card — shown for all rows */}
              {(() => {
                const detailsData = similarDataMap.get(selectedProductIssues[0]?.code ?? "__product_details__");
                if (detailsData?.detectedFields && detailsData.detectedFields.length > 0) {
                  return (
                    <Card>
                      <BlockStack gap="100">
                        {detailsData.detectedFields.map((f, i) => (
                          <InlineStack key={i} gap="200" align="space-between">
                            <Text as="span" variant="bodySm" tone="subdued">{f.label}</Text>
                            <Text as="span" variant="bodySm" fontWeight="semibold">{f.value}</Text>
                          </InlineStack>
                        ))}
                      </BlockStack>
                    </Card>
                  );
                }
                return null;
              })()}

              {/* Issue cards — only for rows with issues */}
              {[...new Map(selectedProductIssues.map((i) => [i.code, i])).values()].map((issue) => {
                const similar = similarDataMap.get(issue.code);
                return (
                  <IssueSidePanel
                    key={issue.code}
                    issue={issue}
                    catalogId={catalogId}
                    similarCount={similar?.affectedCount ?? 1}
                    similarKeys={similar?.affectedKeys ?? (issue.sourceKey ? [issue.sourceKey] : [])}
                    detectedFields={similar?.detectedFields}
                    suggestedFix={similar?.suggestedFix ?? undefined}
                    onClose={() => {}}
                    onResolved={handleSidePanelResolved}
                  />
                );
              })}

              {selectedProductIssues.length === 0 && (
                <Card>
                  <Text as="p" variant="bodySm" tone="success">
                    ✓ No issues — this product is ready for import.
                  </Text>
                </Card>
              )}
            </BlockStack>
          )}
        </div>
      )}

      {/* Backdrop when sidebar is open */}
      {sidebarOpen && (
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
