/**
 * Mapping Review Page — show auto-detected mappings, let merchant correct them.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  Select,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Text,
  Checkbox,
  Spinner,
} from "@shopify/polaris";
import {
  getMappings,
  updateMappings,
  getCatalogVendor,
  type MappingItem,
  type MappingUpdate,
} from "../api-client.js";

type Props = {
  catalogId: string;
  onComplete: (catalogId: string) => void;
  onBack: () => void;
};

const TARGET_FIELD_OPTIONS = [
  { label: "— Not mapped —", value: "" },
  { label: "Product Title", value: "product.title" },
  { label: "Product Description", value: "product.description" },
  { label: "Vendor / Brand", value: "product.vendor" },
  { label: "Product Type", value: "product.productType" },
  { label: "Tags", value: "product.tags" },
  { label: "SKU", value: "variant.sku" },
  { label: "Barcode (UPC/EAN)", value: "variant.barcode" },
  { label: "Price", value: "variant.price" },
  { label: "Compare At Price", value: "variant.compareAtPrice" },
  { label: "Cost", value: "variant.cost" },
  { label: "Inventory Quantity", value: "variant.inventoryQuantity" },
  { label: "Weight", value: "variant.weight" },
  { label: "Option 1 (e.g. Color)", value: "variant.option1" },
  { label: "Option 2 (e.g. Size)", value: "variant.option2" },
  { label: "Option 3", value: "variant.option3" },
  { label: "Option 1 Name", value: "variant.option1Name" },
  { label: "Option 2 Name", value: "variant.option2Name" },
  { label: "Option 3 Name", value: "variant.option3Name" },
  { label: "Weight Unit", value: "variant.weightUnit" },
  { label: "Image URL", value: "image.url" },
  { label: "Image Alt Text", value: "image.altText" },
  { label: "Parent / Group ID", value: "grouping.parentKey" },
  { label: "Ignore", value: "ignore" },
];

function confidenceBadge(confidence: string) {
  switch (confidence) {
    case "high":
      return <Badge tone="success">High</Badge>;
    case "medium":
      return <Badge tone="warning">Review</Badge>;
    default:
      return <Badge tone="critical">Unmapped</Badge>;
  }
}

export function MappingPage({ catalogId, onComplete, onBack }: Props) {
  const [mappings, setMappings] = useState<MappingItem[]>([]);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edited, setEdited] = useState<Map<string, MappingUpdate>>(new Map());

  useEffect(() => {
    Promise.all([
      getMappings(catalogId),
      getCatalogVendor(catalogId),
    ])
      .then(([mappingsRes, vendorRes]) => {
        setMappings(mappingsRes.mappings);
        setVendorId(mappingsRes.vendorId ?? null);
        setVendorName(vendorRes.vendor?.name ?? null);
        setLoading(false);
      })
      .catch((err) => {
        setError((err as Error).message);
        setLoading(false);
      });
  }, [catalogId]);

  const handleFieldChange = useCallback(
    (sourceColumn: string, value: string) => {
      setEdited((prev) => {
        const next = new Map(prev);
        const current = next.get(sourceColumn) ?? {
          sourceColumn,
          targetField: null,
          ignored: false,
        };
        if (value === "ignore") {
          next.set(sourceColumn, { ...current, targetField: null, ignored: true });
        } else {
          next.set(sourceColumn, {
            ...current,
            targetField: value || null,
            ignored: false,
          });
        }
        return next;
      });
    },
    [],
  );

  const handleIgnoreToggle = useCallback(
    (sourceColumn: string, checked: boolean) => {
      setEdited((prev) => {
        const next = new Map(prev);
        const current = next.get(sourceColumn) ?? {
          sourceColumn,
          targetField: null,
          ignored: false,
        };
        next.set(sourceColumn, { ...current, ignored: checked });
        return next;
      });
    },
    [],
  );

  const getEffectiveMapping = (m: MappingItem): MappingUpdate => {
    return (
      edited.get(m.sourceColumn) ?? {
        sourceColumn: m.sourceColumn,
        targetField: m.targetField,
        ignored: m.ignored,
      }
    );
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);

    try {
      const updates: MappingUpdate[] = mappings.map((m) => getEffectiveMapping(m));
      await updateMappings(catalogId, updates);
      onComplete(catalogId);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }, [mappings, edited, catalogId, onComplete]);

  if (loading) {
    return (
      <Page title="Review Column Mappings">
        <Card>
          <InlineStack align="center" gap="200">
            <Spinner size="small" />
            <Text as="p">Loading mappings...</Text>
          </InlineStack>
        </Card>
      </Page>
    );
  }

  const highCount = mappings.filter((m) => m.confidence === "high").length;
  const reviewCount = mappings.filter(
    (m) => m.confidence === "medium" || m.confidence === "low",
  ).length;

  const rowMarkup = mappings.map((m, index) => {
    const effective = getEffectiveMapping(m);
    const selectValue = effective.ignored
      ? "ignore"
      : effective.targetField ?? "";

    return (
      <IndexTable.Row id={m.sourceColumn} key={m.sourceColumn} position={index}>
        <IndexTable.Cell>
          <Text as="span" fontWeight="semibold">
            {m.sourceColumn}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{confidenceBadge(m.confidence)}</IndexTable.Cell>
        <IndexTable.Cell>
          <Select
            label=""
            labelHidden
            options={TARGET_FIELD_OPTIONS}
            value={selectValue}
            onChange={(val) => handleFieldChange(m.sourceColumn, val)}
          />
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Checkbox
            label=""
            labelHidden
            checked={effective.ignored}
            onChange={(checked) => handleIgnoreToggle(m.sourceColumn, checked)}
          />
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      title="Review Column Mappings"
      subtitle={`${highCount} auto-mapped, ${reviewCount} need review`}
      backAction={{ onAction: onBack }}
      primaryAction={{
        content: "Save & Preview",
        onAction: handleSave,
        loading: saving,
      }}
    >
      <BlockStack gap="400">
        {/* Vendor pill — shows which supplier this catalog belongs to */}
        {vendorName && (
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="bodySm" tone="subdued">Supplier:</Text>
            <Badge tone="info">{vendorName}</Badge>
            {mappings.some((m) => m.fromVendor) && (
              <Text as="span" variant="bodySm" tone="subdued">
                · Column mapping loaded from vendor history
              </Text>
            )}
          </InlineStack>
        )}

        {error && (
          <Banner title="Error" tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

        {reviewCount > 0 && (
          <Banner title="Some columns need review" tone="warning">
            <p>
              We couldn't confidently map {reviewCount} column(s). Please review
              and assign the correct Shopify field, or mark them as ignored.
            </p>
          </Banner>
        )}

        <Card padding="0">
          <IndexTable
            itemCount={mappings.length}
            headings={[
              { title: "Source Column" },
              { title: "Confidence" },
              { title: "Maps To" },
              { title: "Ignore" },
            ]}
            selectable={false}
          >
            {rowMarkup}
          </IndexTable>
        </Card>
      </BlockStack>
    </Page>
  );
}
