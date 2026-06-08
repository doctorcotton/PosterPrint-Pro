import { describe, expect, it } from "vitest";

import {
  buildPdfRasterizePlan,
  computeOutputPixelSize,
  evaluateExportQuality,
} from "./export-resolution";

describe("computeOutputPixelSize", () => {
  it("单页 A4 300DPI 输出应接近 2481x3507", () => {
    expect(
      computeOutputPixelSize({
        paper: "a4",
        orientation: "portrait",
        dpi: 300,
        mode: "single",
      })
    ).toEqual({
      width: 2481,
      height: 3507,
    });
  });

  it("分页模式会把行列数折算进总目标像素", () => {
    expect(
      computeOutputPixelSize({
        paper: "a4",
        orientation: "portrait",
        dpi: 300,
        mode: "tiles",
        cols: 2,
        rows: 3,
      })
    ).toEqual({
      width: 4962,
      height: 10521,
    });
  });
});

describe("buildPdfRasterizePlan", () => {
  it("会按裁剪区域反推整页 PDF 的目标栅格尺寸，而不是固定 scale=2", () => {
    const plan = buildPdfRasterizePlan({
      previewWidth: 1190,
      previewHeight: 1684,
      cropWidth: 595,
      cropHeight: 842,
      paper: "a4",
      orientation: "portrait",
      dpi: 300,
      mode: "single",
      maxCanvasDim: 8192,
    });

    expect(plan.outputWidth).toBe(2481);
    expect(plan.outputHeight).toBe(3507);
    expect(plan.desiredRasterWidth).toBe(4962);
    expect(plan.desiredRasterHeight).toBe(7022);
    expect(plan.rasterWidth).toBe(4962);
    expect(plan.rasterHeight).toBe(7022);
    expect(plan.exportUpscaleRatio).toBeCloseTo(1, 4);
  });

  it("超过画布上限时会降采样，并暴露实际放大比", () => {
    const plan = buildPdfRasterizePlan({
      previewWidth: 1190,
      previewHeight: 1684,
      cropWidth: 595,
      cropHeight: 842,
      paper: "a4",
      orientation: "portrait",
      dpi: 300,
      mode: "tiles",
      cols: 2,
      rows: 3,
      maxCanvasDim: 8192,
    });

    expect(plan.desiredRasterWidth).toBe(14869);
    expect(plan.desiredRasterHeight).toBe(21042);
    expect(plan.rasterHeight).toBe(8192);
    expect(plan.clamped).toBe(true);
    expect(plan.exportUpscaleRatio).toBeGreaterThan(1);
  });
});

describe("evaluateExportQuality", () => {
  it("当源裁剪像素不足时返回提示文案与放大比", () => {
    const warning = evaluateExportQuality({
      sourceCropWidth: 800,
      sourceCropHeight: 1200,
      targetWidth: 2481,
      targetHeight: 3507,
      targetDpi: 300,
    });

    expect(warning).not.toBeNull();
    expect(warning?.upscaleRatio).toBeGreaterThan(2.9);
    expect(warning?.message).toContain("实际清晰度低于目标 300 DPI");
  });

  it("当源裁剪像素足够时不提示", () => {
    expect(
      evaluateExportQuality({
        sourceCropWidth: 2481,
        sourceCropHeight: 3507,
        targetWidth: 2481,
        targetHeight: 3507,
      })
    ).toBeNull();
  });
});
