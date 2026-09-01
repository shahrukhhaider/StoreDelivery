/**
 * Import History Page — read-only list of past uploads.
 */

import React from "react";
import {
  Page,
  Card,
  EmptyState,
  Text,
  BlockStack,
} from "@shopify/polaris";

type Props = {
  onUpload: () => void;
};

export function HistoryPage({ onUpload }: Props) {
  return (
    <Page title="Import History">
      <Card>
        <EmptyState
          heading="No imports yet"
          image=""
          action={{ content: "Upload catalog", onAction: onUpload }}
        >
          <Text as="p" variant="bodySm" tone="subdued">
            Your import history will appear here once you complete your first
            catalog import.
          </Text>
        </EmptyState>
      </Card>
    </Page>
  );
}
