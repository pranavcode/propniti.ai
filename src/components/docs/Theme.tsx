"use client";

import { useEffect } from "react";

// Applies the docs (or portal) theme the way the app shell does: .dark on <html> and on the root, so
// the lightbox and overscroll match. "system" follows the OS and its changes. Undone on leaving.
export function DocsTheme({ theme, root: selector = "[data-docs]" }: { theme: "light" | "dark" | "system"; root?: string }) {
  useEffect(() => {
    const root = document.querySelector(selector);
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
  }, [theme, selector]);
  return null;
}
