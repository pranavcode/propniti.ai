"use client";

import * as React from "react";
import { cn } from "cn";
import { autoHeight, MAX_ROWS, rowsHeight, type Box } from "./auto-height";

function measure(el: HTMLTextAreaElement): Box {
  const s = getComputedStyle(el);
  const px = (v: string) => parseFloat(v) || 0;
  return {
    lineHeight: px(s.lineHeight) || px(s.fontSize) * 1.2,
    padding: px(s.paddingTop) + px(s.paddingBottom),
    border: px(s.borderTopWidth) + px(s.borderBottomWidth),
  };
}

const fieldSizing = () => typeof CSS !== "undefined" && CSS.supports("field-sizing", "content");

// A textarea that grows with its text from `rows` lines (default 1) to 10, then scrolls inside.
// Uses CSS field-sizing where the browser has it; elsewhere sets the height from scrollHeight.
// Unstyled apart from sizing: callers keep their own look and key handling.
function AutoTextarea({ className, rows = 1, ref, onInput, ...props }: React.ComponentProps<"textarea">) {
  const inner = React.useRef<HTMLTextAreaElement | null>(null);
  const setRef = React.useCallback((el: HTMLTextAreaElement | null) => {
    inner.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  }, [ref]);

  const fit = React.useCallback(() => {
    const el = inner.current;
    if (!el) return;
    const box = measure(el);
    el.style.minHeight = `${rowsHeight(box, rows)}px`;
    el.style.maxHeight = `${rowsHeight(box, MAX_ROWS)}px`;
    if (fieldSizing()) return;
    el.style.height = "auto";
    const { height, scrolls } = autoHeight(box, el.scrollHeight, rows);
    el.style.height = `${height}px`;
    el.style.overflowY = scrolls ? "auto" : "hidden";
  }, [rows]);

  React.useLayoutEffect(fit, [fit, props.value]);
  React.useEffect(() => {
    const el = inner.current;
    if (!el || fieldSizing()) return;
    // Width changes (resized panel, rotated phone) rewrap the text. Height changes are our own.
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; fit(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  return <textarea ref={setRef} rows={rows} onInput={(e) => { fit(); onInput?.(e); }} className={cn("field-sizing-content resize-none overflow-y-auto", className)} {...props} />;
}

export { AutoTextarea };
