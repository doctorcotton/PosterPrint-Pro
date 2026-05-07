import { describe, expect, it } from "vitest";
import {
  A3_HEIGHT_INCH,
  A3_WIDTH_INCH,
  A4_HEIGHT_INCH,
  A4_WIDTH_INCH,
  pageSizeInch,
} from "./paper";

describe("pageSizeInch", () => {
  it.each([
    ["a4", "portrait", { w: A4_WIDTH_INCH, h: A4_HEIGHT_INCH }],
    ["a4", "landscape", { w: A4_HEIGHT_INCH, h: A4_WIDTH_INCH }],
    ["a3", "portrait", { w: A3_WIDTH_INCH, h: A3_HEIGHT_INCH }],
    ["a3", "landscape", { w: A3_HEIGHT_INCH, h: A3_WIDTH_INCH }],
    ["A4", "Portrait", { w: A4_WIDTH_INCH, h: A4_HEIGHT_INCH }],
  ] as const)("合法: %s + %s", (paper, orientation, expected) => {
    expect(pageSizeInch(paper, orientation)).toEqual(expected);
  });

  it("拒绝未知纸张", () => {
    expect(() => pageSizeInch("a2", "portrait")).toThrow(/不支持/);
  });

  it("拒绝未知方向", () => {
    expect(() => pageSizeInch("a4", "square")).toThrow(/不支持/);
  });
});
