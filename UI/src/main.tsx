import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PrefsProvider } from "./ui/prefs";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("عنصر الجذر مفقود في index.html");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <PrefsProvider>
      <App />
    </PrefsProvider>
  </React.StrictMode>,
);
