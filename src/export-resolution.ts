import { pageSizeInch } from "./paper";

export type ExportMode = "single" | "tiles";

export interface PixelSize {
  width: number;
  height: number;
}

export interface OutputPixelSizeOptions {
  paper: string;
  orientation: string;
  dpi: number;
  mode: ExportMode;
  cols?: number;
  rows?: number;
}

export interface PdfRasterizePlanOptions extends OutputPixelSizeOptions {
  previewWidth: number;
  previewHeight: number;
  cropWidth: number;
  cropHeight: number;
  maxCanvasDim: number;
}

export interface PdfRasterizePlan {
  outputWidth: number;
  outputHeight: number;
  desiredRasterWidth: number;
  desiredRasterHeight: number;
  rasterWidth: number;
  rasterHeight: number;
  clamped: boolean;
  exportUpscaleRatio: number;
}

export interface ExportQualityWarning {
  upscaleRatio: number;
  message: string;
}

export interface CropRect {
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
}

/** 计算最终输出页面的目标像素尺寸。 */
export function computeOutputPixelSize(
  options: OutputPixelSizeOptions
): PixelSize {
  const page = pageSizeInch(options.paper, options.orientation);
  const pageWidth = Math.round(page.w * options.dpi);
  const pageHeight = Math.round(page.h * options.dpi);
  if (options.mode === "tiles") {
    return {
      width: pageWidth * Math.max(1, options.cols ?? 1),
      height: pageHeight * Math.max(1, options.rows ?? 1),
    };
  }
  return {
    width: pageWidth,
    height: pageHeight,
  };
}

/** 根据当前裁剪区域反推 PDF 整页应栅格化到的像素尺寸。 */
export function buildPdfRasterizePlan(
  options: PdfRasterizePlanOptions
): PdfRasterizePlan {
  const output = computeOutputPixelSize(options);
  const cropWidth = Math.max(1, options.cropWidth);
  const cropHeight = Math.max(1, options.cropHeight);
  const renderScale = Math.max(
    output.width / cropWidth,
    output.height / cropHeight
  );

  const desiredRasterWidth = Math.max(
    1,
    Math.round(options.previewWidth * renderScale)
  );
  const desiredRasterHeight = Math.max(
    1,
    Math.round(options.previewHeight * renderScale)
  );

  const maxDim = Math.max(desiredRasterWidth, desiredRasterHeight);
  const clampScale =
    maxDim > options.maxCanvasDim ? options.maxCanvasDim / maxDim : 1;
  const rasterWidth = Math.max(1, Math.round(desiredRasterWidth * clampScale));
  const rasterHeight = Math.max(
    1,
    Math.round(desiredRasterHeight * clampScale)
  );

  const actualCropWidth = cropWidth * (rasterWidth / options.previewWidth);
  const actualCropHeight = cropHeight * (rasterHeight / options.previewHeight);
  const exportUpscaleRatio = Math.max(
    output.width / Math.max(1, actualCropWidth),
    output.height / Math.max(1, actualCropHeight)
  );

  return {
    outputWidth: output.width,
    outputHeight: output.height,
    desiredRasterWidth,
    desiredRasterHeight,
    rasterWidth,
    rasterHeight,
    clamped: clampScale < 0.999999,
    exportUpscaleRatio,
  };
}

/** 判断当前源裁剪像素是否足以支撑目标输出像素。 */
export function evaluateExportQuality(options: {
  sourceCropWidth: number;
  sourceCropHeight: number;
  targetWidth: number;
  targetHeight: number;
  targetDpi?: number;
}): ExportQualityWarning | null {
  const upscaleRatio = Math.max(
    options.targetWidth / Math.max(1, options.sourceCropWidth),
    options.targetHeight / Math.max(1, options.sourceCropHeight)
  );
  if (upscaleRatio <= 1.01) {
    return null;
  }
  const dpiText = options.targetDpi ? `目标 ${options.targetDpi} DPI` : "目标 DPI";
  return {
    upscaleRatio,
    message: `当前源像素不足，导出时会放大约 ${upscaleRatio.toFixed(
      2
    )} 倍，实际清晰度低于${dpiText}。`,
  };
}

/** 把裁剪框从预览像素空间映射到导出像素空间。 */
export function scaleCropRect(
  rect: CropRect,
  from: PixelSize,
  to: PixelSize
): CropRect {
  const scaleX = to.width / Math.max(1, from.width);
  const scaleY = to.height / Math.max(1, from.height);
  return {
    cropX: rect.cropX * scaleX,
    cropY: rect.cropY * scaleY,
    cropW: rect.cropW * scaleX,
    cropH: rect.cropH * scaleY,
  };
}
