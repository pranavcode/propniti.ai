import { describe, expect, it } from "vitest";
import { autoHeight, MAX_ROWS, rowsHeight } from "./auto-height";

// 20px lines, 8px padding (top + bottom), 2px border: a 1-line box is 30px, the 10-line cap 210px.
const box = { lineHeight: 20, padding: 8, border: 2 };

describe("autoHeight", () => {
  it("starts at one line when empty", () => {
    expect(autoHeight(box, 28)).toEqual({ height: 30, scrolls: false });
  });

  it("grows with each line up to the 10-line cap", () => {
    expect(autoHeight(box, 3 * 20 + 8)).toEqual({ height: 70, scrolls: false });
    expect(autoHeight(box, MAX_ROWS * 20 + 8)).toEqual({ height: rowsHeight(box, 10), scrolls: false });
  });

  it("stops at 10 lines and scrolls inside for 15", () => {
    expect(autoHeight(box, 15 * 20 + 8)).toEqual({ height: 210, scrolls: true });
  });

  it("shrinks back after the text is cleared", () => {
    expect(autoHeight(box, 15 * 20 + 8).height).toBe(210);
    expect(autoHeight(box, 28)).toEqual({ height: 30, scrolls: false });
  });

  it("keeps a larger minimum when the caller asks for more rows", () => {
    expect(autoHeight(box, 28, 4)).toEqual({ height: 90, scrolls: false });
  });
});
