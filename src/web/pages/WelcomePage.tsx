/**
 * Welcome Page — first-time onboarding for new users.
 */

import React from "react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Divider,
  Box,
  Icon,
} from "@shopify/polaris";

type Props = {
  onStart: () => void;
};

export function WelcomePage({ onStart }: Props) {
  return (
    <Page>
      <BlockStack gap="600">
        <Card>
          <BlockStack gap="400">
            <Text as="h1" variant="headingXl">
              Welcome to StoreKeeper
            </Text>
            <Text as="p" variant="bodyLg">
              Import your supplier catalogs into Shopify in minutes. Upload a
              CSV or XLSX file, review the column mappings, and create products
              with a single click.
            </Text>
            <Button variant="primary" size="large" onClick={onStart}>
              Upload your first catalog
            </Button>
          </BlockStack>
        </Card>

        <Text as="h2" variant="headingLg">
          How it works
        </Text>

        <InlineStack gap="400" align="start" wrap>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">
                1. Upload
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Drop your supplier spreadsheet (CSV or XLSX). We support
                comma, tab, and semicolon delimiters, European number formats,
                and multi-sheet workbooks.
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">
                2. Review
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                We auto-detect your columns and map them to Shopify fields.
                Review the mappings, fix any that need attention, and check
                the product preview.
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">
                3. Import
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Confirm the import plan and create new products in your
                Shopify store. Track progress in real-time and retry any
                failures individually.
              </Text>
            </BlockStack>
          </Card>
        </InlineStack>

        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              What we support
            </Text>
            <InlineStack gap="400" wrap>
              <Text as="span" variant="bodySm">CSV files</Text>
              <Text as="span" variant="bodySm">XLSX spreadsheets</Text>
              <Text as="span" variant="bodySm">Auto column detection</Text>
              <Text as="span" variant="bodySm">Product variants</Text>
              <Text as="span" variant="bodySm">Image URLs</Text>
              <Text as="span" variant="bodySm">Duplicate detection</Text>
              <Text as="span" variant="bodySm">Batch import</Text>
              <Text as="span" variant="bodySm">Retry failures</Text>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
