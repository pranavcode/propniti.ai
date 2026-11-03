"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

// False on the server and during hydration, true after. Use it for output that depends on the
// visitor's clock or timezone (relative dates), so server and first client render match.
export const useMounted = () => useSyncExternalStore(noop, () => true, () => false);
