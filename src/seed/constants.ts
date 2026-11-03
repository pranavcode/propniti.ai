// The demo's fixed calendar. Kept apart from generate.ts so server code can import it without
// bundling the generator.
export const AS_OF = "2026-11-04"; // the demo's "today" (also meta.as_of)
export const FIRST_PERIOD = "2025-05"; // 18 closed months (May 2025 – Oct 2026) plus November 2026
export const CURRENT_PERIOD = "2026-11";
// Bump when the generator's output changes on purpose; ensureBase reloads when it differs.
export const BASE_VERSION = "2026-11-04.11";
