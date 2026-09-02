/**
 * Privacy Policy page.
 */

import React from "react";
import { Page, Card, BlockStack, Text } from "@shopify/polaris";

export function PrivacyPage() {
  return (
    <Page title="Privacy Policy" narrowWidth>
      <Card>
        <BlockStack gap="400">
          <Text as="p" variant="bodyMd">
            <strong>Last updated:</strong> {new Date().toLocaleDateString()}
          </Text>

          <Text as="h2" variant="headingMd">What data we collect</Text>
          <Text as="p" variant="bodySm">
            StoreKeeper collects and processes the following data when you use our app:
          </Text>
          <Text as="p" variant="bodySm">
            • <strong>Shop information:</strong> Your Shopify store domain and OAuth access
            token (encrypted at rest) for API access.
          </Text>
          <Text as="p" variant="bodySm">
            • <strong>Uploaded files:</strong> Supplier catalog files (CSV/XLSX) that you
            upload for processing. Raw files are retained for a configurable period
            (default 30 days) and then deleted.
          </Text>
          <Text as="p" variant="bodySm">
            • <strong>Product data:</strong> Parsed product information derived from your
            uploaded files, stored temporarily for import processing.
          </Text>

          <Text as="h2" variant="headingMd">What we don't collect</Text>
          <Text as="p" variant="bodySm">
            We do not collect or store customer data, order data, payment information,
            or any personal data of your customers. We do not request access to customer,
            order, or financial scopes.
          </Text>

          <Text as="h2" variant="headingMd">How we use your data</Text>
          <Text as="p" variant="bodySm">
            Your data is used solely to provide the catalog import functionality:
            parsing supplier files, mapping columns, validating data, and creating
            products in your Shopify store.
          </Text>

          <Text as="h2" variant="headingMd">Data retention</Text>
          <Text as="p" variant="bodySm">
            Uploaded files are automatically deleted after 30 days. Catalog and
            import records are retained while your app is installed. All data is
            permanently deleted within 48 hours of app uninstallation, as required
            by Shopify.
          </Text>

          <Text as="h2" variant="headingMd">Data security</Text>
          <Text as="p" variant="bodySm">
            Access tokens are encrypted at rest using AES-256-GCM. All data
            transmission uses HTTPS. File storage uses private access with signed
            URLs. Strict tenant isolation ensures your data is never accessible to
            other stores.
          </Text>

          <Text as="h2" variant="headingMd">Contact</Text>
          <Text as="p" variant="bodySm">
            For privacy inquiries, contact us at support@storekeeper.app.
          </Text>
        </BlockStack>
      </Card>
    </Page>
  );
}
