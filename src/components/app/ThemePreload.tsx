"use client";
import { useSyncExternalStore } from "react";
import { themePreload, type ThemeMode } from "@/lib/theme";

const noop = () => () => {};

// The theme script only matters in the server HTML, before the first paint. A client-side
// navigation into the layout would create it in the browser, where it never runs and React warns,
// so after hydration it renders nothing (AppShell and DocsTheme keep the theme from then on).
export function ThemePreload({ mode }: { mode: ThemeMode }) {
  const client = useSyncExternalStore(noop, () => true, () => false);
  return client ? null : <script dangerouslySetInnerHTML={{ __html: themePreload(mode) }} />;
}
