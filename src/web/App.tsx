/**
 * Root app component — Polaris-wrapped with state-machine routing.
 *
 * Nav: Home (upload/intro) | Import History
 * Flow: Home → Upload → Mapping → Preview → Results
 */

import React, { useState, useCallback } from "react";
import { AppProvider, Frame, Navigation } from "@shopify/polaris";
import { HomeIcon, ClockIcon } from "@shopify/polaris-icons";
import enTranslations from "@shopify/polaris/locales/en.json";
import { WelcomePage } from "./pages/WelcomePage.js";
import { UploadPage } from "./pages/UploadPage.js";
import { MappingPage } from "./pages/MappingPage.js";
import { PreviewPage } from "./pages/PreviewPage.js";
import { ResultsPage } from "./pages/ResultsPage.js";
import { HistoryPage } from "./pages/HistoryPage.js";

type Route =
  | { page: "home" }
  | { page: "upload" }
  | { page: "mapping"; uploadId: string; catalogId: string }
  | { page: "preview"; uploadId: string; catalogId: string }
  | { page: "results"; operationId: string; uploadId?: string; catalogId?: string }
  | { page: "history" };

export function App() {
  const [route, setRoute] = useState<Route>({ page: "home" });

  const navigateToHome = useCallback(() => {
    setRoute({ page: "home" });
  }, []);

  const navigateToUpload = useCallback(() => {
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

  const navigation = (
    <Navigation location={route.page}>
      <Navigation.Section
        items={[
          {
            label: "Home",
            icon: HomeIcon,
            onClick: navigateToHome,
            selected: route.page === "home" || route.page === "upload",
          },
          {
            label: "Import History",
            icon: ClockIcon,
            onClick: navigateToHistory,
            selected: route.page === "history" || route.page === "results",
          },
        ]}
      />
    </Navigation>
  );

  let content: React.ReactNode;
  switch (route.page) {
    case "home":
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
      <Frame navigation={navigation}>
        {content}
      </Frame>
    </AppProvider>
  );
}
