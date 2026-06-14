import React from "react";
import ReactDOM from "react-dom/client";
import { GeistSans } from "geist/font/sans";
import { App } from "./App";
import "@fontsource/instrument-serif/400.css";
import "./styles.css";

document.documentElement.classList.add(GeistSans.variable);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
