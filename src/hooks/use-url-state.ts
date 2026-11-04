"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// URL-held page state (plan §4: useSearchParams + router.replace, no nuqs). `set` merges a patch:
// null/"" deletes a key. `pending` is true while the server re-renders for the new URL, which is
// how server-driven tables show their loading state.
export function useUrlState() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const href = useCallback((patch: Record<string, string | number | null | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [params, pathname]);

  const set = useCallback((patch: Record<string, string | number | null | undefined>, opts: { push?: boolean } = {}) => {
    const url = href(patch);
    startTransition(() => (opts.push ? router.push(url, { scroll: false }) : router.replace(url, { scroll: false })));
  }, [href, router]);

  // Replace the whole query (used by saved views and "clear all").
  const reset = useCallback((next: URLSearchParams) => {
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }, [pathname, router]);

  return { params, pathname, set, reset, href, pending };
}
