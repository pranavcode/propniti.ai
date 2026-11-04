"use client";

import { openPeek } from "./usePeek";
import { isModifiedClick } from "./url";

// A real link to the full record page that opens the peek drawer on a plain click. Cmd/Ctrl-,
// Shift- and middle-click, and "Open in new tab", still go to the page. Server pages can render
// it with plain props.
export function PeekLink({ entity, id, href, onClick, ...rest }: React.ComponentProps<"a"> & { entity: string; id: string; href: string }) {
  return (
    <a
      {...rest}
      href={href}
      data-peek-entity={entity}
      data-peek-id={id}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || isModifiedClick(e)) return;
        e.preventDefault();
        e.stopPropagation();
        openPeek({ entity, id });
      }}
    />
  );
}
