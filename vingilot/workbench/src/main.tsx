import * as React from "react";
import { createRoot } from "react-dom/client";
import { SpikeHarness } from "./SpikeHarness";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <React.StrictMode>
    <SpikeHarness />
  </React.StrictMode>,
);
