import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/600.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api/client";
import { ApiProvider } from "./api/context";
import { App } from "./components/App";
import { I18nProvider } from "./i18n/i18n";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <ApiProvider client={api}>
        <App />
      </ApiProvider>
    </I18nProvider>
  </StrictMode>,
);
