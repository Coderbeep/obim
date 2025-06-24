import React from "react";
import ReactDOM from "react-dom/client";
import "./assets/index.css";
import App from "./App";

// strict mode enables some extra checks and warnings for development
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
