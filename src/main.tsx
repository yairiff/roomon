import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // Best-effort: failure only affects installability.
  });
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
