// Height of a growing textarea: at least `minRows` lines, at most MAX_ROWS lines, then it scrolls.
// Sizes are border-box pixels (padding and border included), as Tailwind's preflight sets.
export const MAX_ROWS = 10;

export type Box = { lineHeight: number; padding: number; border: number };

export function rowsHeight(box: Box, rows: number) {
  return rows * box.lineHeight + box.padding + box.border;
}

// scrollHeight covers content and padding, not the border.
export function autoHeight(box: Box, scrollHeight: number, minRows = 1) {
  const max = rowsHeight(box, MAX_ROWS);
  const content = scrollHeight + box.border;
  return { height: Math.min(Math.max(content, rowsHeight(box, minRows)), max), scrolls: content > max + 1 };
}
