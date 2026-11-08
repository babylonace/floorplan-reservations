import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/600.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "../styles.css";
import "./booking.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { api } from "../api/client";
import { ApiProvider } from "../api/context";
import { BookingPage, slugFromPath } from "./BookingPage";
import { BookingI18nProvider } from "./i18n";

const root = document.getElementById("root");
if (!root) throw new Error("reservar/index.html has no #root element");

createRoot(root).render(
  <StrictMode>
    <BookingI18nProvider>
      <ApiProvider client={api}>
        <BookingPage slug={slugFromPath(window.location.pathname)} />
      </ApiProvider>
    </BookingI18nProvider>
  </StrictMode>,
);
