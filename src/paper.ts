/**
 * ISO 216 纸张尺寸（英寸），与 crop_server.page_size_inch 保持一致
 */

export const A4_WIDTH_INCH = 8.27;
export const A4_HEIGHT_INCH = 11.69;
export const A3_WIDTH_INCH = 11.69;
export const A3_HEIGHT_INCH = 16.54;

/** 竖版宽高（宽 × 高），单位英寸 */
export const PAPER_INCH = {
  a4: { w: A4_WIDTH_INCH, h: A4_HEIGHT_INCH },
  a3: { w: A3_WIDTH_INCH, h: A3_HEIGHT_INCH },
} as const;

export type PaperKey = keyof typeof PAPER_INCH;

/**
 * 返回单页 PDF 的页面尺寸 (宽英寸, 高英寸)。
 * paper: a4 | a3；orientation: portrait | landscape
 */
export function pageSizeInch(
  paper: string,
  orientation: string
): { w: number; h: number } {
  const paper_n = (paper || "a4").toLowerCase().trim();
  const orient_n = (orientation || "portrait").toLowerCase().trim();
  let w0: number;
  let h0: number;
  if (paper_n === "a3") {
    w0 = A3_WIDTH_INCH;
    h0 = A3_HEIGHT_INCH;
  } else if (paper_n === "a4") {
    w0 = A4_WIDTH_INCH;
    h0 = A4_HEIGHT_INCH;
  } else {
    throw new Error(
      `不支持的纸张规格: ${JSON.stringify(paper)}，仅支持 a4、a3`
    );
  }
  if (orient_n === "landscape") {
    return { w: h0, h: w0 };
  }
  if (orient_n === "portrait") {
    return { w: w0, h: h0 };
  }
  throw new Error(
    `不支持的纸张方向: ${JSON.stringify(orientation)}，仅支持 portrait、landscape`
  );
}

/** 取景框高/宽比 = 页高/页宽 */
export function paperAspectRatio(page: { w: number; h: number }): number {
  return page.h / page.w;
}
