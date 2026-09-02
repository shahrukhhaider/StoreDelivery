/**
 * Terms of Service page.
 */

import React from "react";
import { Page, Card, BlockStack, Text } from "@shopify/polaris";

export function TermsPage() {
  return (
    <Page title="Terms of Service" narrowWidth>
      <Card>
        <BlockStack gap="400">
          <Text as="p" variant="bodyMd">
            <strong>Last updated:</strong> {new Date().toLocaleDateString()}
          </Text>

          <Text as="h2" variant="headingMd">Acceptance of Terms</Text>
          <Text as="p" variant="bodySm">
            By installing and using StoreKeeper, you agree to these terms of service.
            If you do not agree, please uninstall the app.
          </Text>

          <Text as="h2" variant="headingMd">Service Description</Text>
          <Text as="p" variant="bodySm">
            StoreKeeper is a Shopify app that helps merchants import supplier
            catalog data (CSV/XLSX) into their Shopify store as new products.
            The app provides file parsing, column mapping, validation, and
            batch product creation.
          </Text>

          <Text as="h2" variant="headingMd">Your Responsibilities</Text>
          <Text as="p" variant="bodySm">
            You are responsible for the accuracy and legality of the data you
            upload. You must have the right to use any product images, descriptions,
            and other content included in your supplier files.
          </Text>

          <Text as="h2" variant="headingMd">Limitations</Text>
          <Text as="p" variant="bodySm">
            StoreKeeper creates new products only. It does not modify or delete
            existing products. While we take care to handle your data safely,
            we recommend reviewing the import preview before confirming any
            import operation.
          </Text>

          <Text as="h2" variant="headingMd">Liability</Text>
          <Text as="p" variant="bodySm">
            StoreKeeper is provided "as is" without warranty. We are not liable
            for any data loss, incorrect product listings, or business impact
            resulting from use of the app. Always verify imported products in
            your Shopify admin.
          </Text>

          <Text as="h2" variant="headingMd">Cancellation</Text>
          <Text as="p" variant="bodySm">
            You may uninstall StoreKeeper at any time through your Shopify admin.
            All your data will be deleted within 48 hours of uninstallation.
          </Text>

          <Text as="h2" variant="headingMd">Contact</Text>
          <Text as="p" variant="bodySm">
            For questions about these terms, contact us at support@storekeeper.app.
          </Text>
        </BlockStack>
      </Card>
    </Page>
  );
}
