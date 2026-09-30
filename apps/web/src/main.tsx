import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// URL windows on Windows do not run Wails' injected navigation script.
// Load the same guarded observer as native settings before React restores theme.
import "../../../bridge/internal/console/static/native-navigation.js";
import { App } from "./App.tsx";
import "./styles.css";
import "./features/auth/owner-recovery.css";
import "./features/navigation/product-shell.css";
import "./visual-system.css";
import "./features/room/conversation-layout.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing application root");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
