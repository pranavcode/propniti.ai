"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

// "Updated just now" beside a section header for a few seconds after its figures change under the
// person (an action elsewhere on the page refreshed them). Never on first render.
export function UpdatedStamp({ value }: { value: string | number }) {
  const [prev, setPrev] = useState(value);
  const [shown, setShown] = useState(false);
  if (value !== prev) { setPrev(value); setShown(true); }
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(false), 8000);
    return () => clearTimeout(t);
  }, [shown, prev]);
  if (!shown) return null;
  return (
    <span role="status" data-updated-stamp className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-normal text-tone-success animate-in fade-in-0 duration-300 motion-reduce:animate-none">
      <RefreshCw className="size-3" aria-hidden /> Updated just now
    </span>
  );
}
