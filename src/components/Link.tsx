"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";

// Use this instead of next/link. Every page renders dynamically from D1, so the default viewport
// prefetch costs one server render per visible link (31 on the dashboard). Prefetch only on intent:
// hover, keyboard focus or touch.
export default function Link({ prefetch, onMouseEnter, onFocus, onTouchStart, ...props }: React.ComponentProps<typeof NextLink>) {
  const router = useRouter();
  const intent = () => {
    if (prefetch !== false && typeof props.href === "string" && props.href.startsWith("/") && process.env.NODE_ENV === "production") router.prefetch(props.href);
  };
  return (
    <NextLink
      {...props}
      prefetch={false}
      onMouseEnter={(e) => { onMouseEnter?.(e); intent(); }}
      onFocus={(e) => { onFocus?.(e); intent(); }}
      onTouchStart={(e) => { onTouchStart?.(e); intent(); }}
    />
  );
}
