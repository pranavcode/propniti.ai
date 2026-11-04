// Light or dark for the app surface (staff app, portals, docs). The pn_theme cookie holds an
// explicit choice; with none, the OS decides.
export type ThemeMode = "light" | "dark" | "system";
export const themeMode = (cookie: string | undefined): ThemeMode => (cookie === "light" || cookie === "dark" ? cookie : "system");

// An inline script for the top of the surface root. It runs while the page is parsed, before the
// first paint, so a dark page never draws light first. The elements it changes need
// suppressHydrationWarning (<html>, <body>, the root).
export const themePreload = (mode: ThemeMode) =>
  `(function(){try{var d=document,h=d.documentElement,r=d.currentScript&&d.currentScript.parentElement,m=${JSON.stringify(mode)},k=m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);d.body.dataset.surface="app";h.classList.toggle("dark",k);r&&r.classList.toggle("dark",k);h.style.colorScheme=k?"dark":"light"}catch(e){}})()`;
