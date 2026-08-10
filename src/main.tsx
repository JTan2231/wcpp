import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { BrowserCompilerClient } from "./compiler/BrowserCompilerClient";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element");
}

const compilerClient = new BrowserCompilerClient();

createRoot(root).render(
  <StrictMode>
    <App compilerClient={compilerClient} />
  </StrictMode>,
);
