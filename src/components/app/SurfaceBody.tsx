"use client";

import { useEffect } from "react";

// Radix portals (dialogs, popovers, sheets, toasts) render into <body>, outside the app root, so
// the app marks <body> too; the tokens in globals.css are scoped to [data-surface="app"].
export function SurfaceBody() {
  useEffect(() => {
    document.body.dataset.surface = "app";
    return () => void delete document.body.dataset.surface;
  }, []);
  return null;
}
