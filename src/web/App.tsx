/**
 * Root app component — Polaris-wrapped with simple state-machine routing.
 */

import React, { useState, useCallback } from "react";
import { AppProvider, Frame, TopBar } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { UploadPage } from "./pages/UploadPage.js";
import { MappingPage } from "./pages/MappingPage.js";
import { PreviewPage } from "./pages/PreviewPage.js";
import { HistoryPage } from "./pages/HistoryPage.js";

type Route =
  | { page: "upload" }
  | { page: "mapping"; uploadId: string; catalogId: string }
  | { page: "preview"; catalogId: string }
  | { page: "history" };

export function App() {
  const [route, setRoute] = useState<Route>({ page: "upload" });

  const navigateToMapping = useCallback(
    (uploadId: string, catalogId: string) => {
      setRoute({ page: "mapping", uploadId, catalogId });
    },
    [],
  );

  const navigateToPreview = useCallback((catalogId: string) => {
    setRoute({ page: "preview", catalogId });
  }, []);

  const navigateToUpload = useCallback(() => {
    setRoute({ page: "upload" });
  }, []);

  const navigateToHistory = useCallback(() => {
    setRoute({ page: "history" });
  }, []);

  const topBar = (
    <TopBar
      showNavigationToggle={false}
      secondaryMenu={
        <div style={{ display: "flex", gap: "12px", padding: "0 16px" }}>
          <button
            onClick={navigateToUpload}
            style={{
              background: "none",
              border: "none",
              color: "var(--p-color-text)",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            Upload
          </button>
          <button
            onClick={navigateToHistory}
            style={{
              background: "none",
              border: "none",
              color: "var(--p-color-text)",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            History
          </button>
        </div>
      }
    />
  );

  let content: React.ReactNode;
  switch (route.page) {
    case "upload":
      content = <UploadPage onComplete={navigateToMapping} />;
      break;
    case "mapping":
      content = (
        <MappingPage
          catalogId={route.catalogId}
          onComplete={navigateToPreview}
          onBack={navigateToUpload}
        />
      );
      break;
    case "preview":
      content = (
        <PreviewPage
          catalogId={route.catalogId}
          onBack={navigateToUpload}
        />
      );
      break;
    case "history":
      content = <HistoryPage onUpload={navigateToUpload} />;
      break;
  }

  return (
    <AppProvider i18n={enTranslations}>
      <Frame topBar={topBar}>
        {content}
      </Frame>
    </AppProvider>
  );
}
