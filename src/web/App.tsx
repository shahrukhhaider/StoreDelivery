/**
 * Root app component — Polaris-wrapped with state-machine routing.
 *
 * Flow: Welcome → Upload → Mapping → Preview → Results
 * Back:                   Upload ← Mapping ← Preview ← Results
 */

import React, { useState, useCallback } from "react";
import { AppProvider, Frame, TopBar } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { WelcomePage } from "./pages/WelcomePage.js";
import { UploadPage } from "./pages/UploadPage.js";
import { MappingPage } from "./pages/MappingPage.js";
import { PreviewPage } from "./pages/PreviewPage.js";
import { ResultsPage } from "./pages/ResultsPage.js";
import { HistoryPage } from "./pages/HistoryPage.js";

type Route =
  | { page: "welcome" }
  | { page: "upload" }
  | { page: "mapping"; uploadId: string; catalogId: string }
  | { page: "preview"; uploadId: string; catalogId: string }
  | { page: "results"; operationId: string; uploadId?: string; catalogId?: string }
  | { page: "history" };

export function App() {
  const [route, setRoute] = useState<Route>(() => {
    const visited = typeof localStorage !== "undefined" && localStorage.getItem("sk_visited");
    return visited ? { page: "history" } : { page: "welcome" };
  });

  const navigateToUpload = useCallback(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("sk_visited", "1");
    }
    setRoute({ page: "upload" });
  }, []);

  const navigateToMapping = useCallback(
    (uploadId: string, catalogId: string) => {
      setRoute({ page: "mapping", uploadId, catalogId });
    },
    [],
  );

  const navigateToPreview = useCallback((catalogId: string, uploadId?: string) => {
    setRoute({ page: "preview", catalogId, uploadId: uploadId ?? "" });
  }, []);

  const navigateToResults = useCallback((operationId: string, uploadId?: string, catalogId?: string) => {
    setRoute({ page: "results", operationId, uploadId, catalogId });
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
            onClick={navigateToHistory}
            style={{
              background: "none",
              border: "none",
              color: "var(--p-color-text)",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: route.page === "history" ? "600" : "400",
            }}
          >
            Dashboard
          </button>
          <button
            onClick={navigateToUpload}
            style={{
              background: "none",
              border: "none",
              color: "var(--p-color-text)",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: route.page === "upload" ? "600" : "400",
            }}
          >
            New Import
          </button>
        </div>
      }
    />
  );

  let content: React.ReactNode;
  switch (route.page) {
    case "welcome":
      content = <WelcomePage onStart={navigateToUpload} />;
      break;
    case "upload":
      content = <UploadPage onComplete={navigateToMapping} />;
      break;
    case "mapping":
      content = (
        <MappingPage
          catalogId={route.catalogId}
          onComplete={(catalogId) => navigateToPreview(catalogId, route.uploadId)}
          onBack={navigateToUpload}
        />
      );
      break;
    case "preview":
      content = (
        <PreviewPage
          catalogId={route.catalogId}
          onBack={() => navigateToMapping(route.uploadId, route.catalogId)}
          onExecute={(operationId) =>
            navigateToResults(operationId, route.uploadId, route.catalogId)
          }
        />
      );
      break;
    case "results":
      content = (
        <ResultsPage
          operationId={route.operationId}
          onBack={navigateToHistory}
        />
      );
      break;
    case "history":
      content = (
        <HistoryPage
          onUpload={navigateToUpload}
          onViewResults={(operationId) => navigateToResults(operationId)}
          onViewCatalog={(catalogId) => navigateToPreview(catalogId)}
        />
      );
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
