import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AgentPulseClient } from "../app/agent-pulse-client";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AgentPulseClient />
  </StrictMode>,
);
