"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-renders the server page every few seconds while a background agent run is still going.
export function Refresh({ every = 3000, max = 10 }: { every?: number; max?: number }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => (++n > max ? clearInterval(id) : router.refresh()), every);
    return () => clearInterval(id);
  }, [router, every, max]);
  return null;
}
