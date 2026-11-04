"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { changesPage, navStart } from "@/components/app/shell/progress";

// Use this instead of next/link. Every page renders dynamically from D1, so the default viewport
// prefetch costs one server render per visible link (31 on the dashboard). Prefetch only on intent:
// hover, keyboard focus or touch.
export default function Link({ prefetch, onClick, onMouseEnter, onFocus, onTouchStart, ...props }: React.ComponentProps<typeof NextLink>) {
  const router = useRouter();
  const intent = () => {
    if (prefetch !== false && typeof props.href === "string" && props.href.startsWith("/") && process.env.NODE_ENV === "production") router.prefetch(props.href);
  };
  return (
    <NextLink
      {...props}
      prefetch={false}
      onClick={(e) => {
        onClick?.(e);
        // Starts the top progress bar (app shell) for a plain click that loads another page or filter.
        const plain = !(e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0 || props.target === "_blank" || props.download);
        if (plain && typeof props.href === "string" && changesPage(props.href, window.location)) navStart();
      }}
      onMouseEnter={(e) => { onMouseEnter?.(e); intent(); }}
      onFocus={(e) => { onFocus?.(e); intent(); }}
      onTouchStart={(e) => { onTouchStart?.(e); intent(); }}
    />
  );
}
