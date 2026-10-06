import React from "react";
import ReactDOM from "react-dom/client";
import "katex/dist/katex.min.css";
import "./styles/index.css";
import App from "./App";
import { initializeSidebarPlacement } from "./app/sidebarPlacement";
import { initializeAppTheme } from "./app/theme";
import { FileGlyphSprite } from "./shared/icons/FileGlyphs";
import { AppErrorBoundary } from "./app/AppErrorBoundary";
import { NotePdfDocument } from "./features/files/NotePdfDocument";

initializeAppTheme();
initializeSidebarPlacement();

const notePdfExportToken = new URLSearchParams(window.location.search).get("notePdfExportToken");

// strict mode enables some extra checks and warnings for development
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <>
    <FileGlyphSprite />
    <AppErrorBoundary>{notePdfExportToken ? <NotePdfDocument token={notePdfExportToken} /> : <App />}</AppErrorBoundary>
  </>,
);
