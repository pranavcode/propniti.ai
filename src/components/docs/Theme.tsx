"use client";

import { useEffect } from "react";

// Applies the docs theme the way the app shell does: .dark on <html> and on the docs root, so the
// lightbox and overscroll match. "system" follows the OS and its changes. Undone on leaving /docs.
export function DocsTheme({ theme }: { theme: "light" | "dark" | "system" }) {
  useEffect(() => {
    const root = document.querySelector("[data-docs]");
    const html = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      html.classList.toggle("dark", dark);
      root?.classList.toggle("dark", dark);
      html.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    document.body.dataset.surface = "app";
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      html.classList.remove("dark");
      html.style.colorScheme = "";
      delete document.body.dataset.surface;
    };
  }, [theme]);
  return null;
}
