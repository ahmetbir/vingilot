import * as React from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/shell.css";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
