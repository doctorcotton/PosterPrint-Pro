/**
 * 大图裁切 / 分页打印前端逻辑（TypeScript + PDF.js，由 Vite 打包）
 */
import "../crop.css";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import {
  buildSourceFingerprint,
  ensureRemoteSource,
  prepareSingleExport,
  prepareTileExport,
  requestDownloadUrl,
  type UploadedSource,
} from "./export-client";
import {
  buildPdfRasterizePlan,
  computeOutputPixelSize,
  evaluateExportQuality,
  scaleCropRect,
  type CropRect,
  type ExportMode,
} from "./export-resolution";
import {
  openPendingDownloadTab,
  type PendingDownloadTab,
} from "./download-tab";
import { pageSizeInch, paperAspectRatio } from "./paper";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/** DOM 回调里将 Event 收窄为 MouseEvent，避免静默当普通点击处理 */
function expectMouseEvent(e: Event): MouseEvent {
  if (!(e instanceof MouseEvent)) {
    throw new Error("期望鼠标事件（MouseEvent）");
  }
  return e;
}

const FIT_MARGIN = 0.95;
const MAX_CANVAS_DIM = 8192;

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`缺少 DOM 元素 #${id}`);
  }
  return el as T;
}

const imageInput = requireEl<HTMLInputElement>("imageInput");
const imageEl = requireEl<HTMLImageElement>("image");
const stage = requireEl<HTMLElement>("stage");
const cropBox = requireEl<HTMLElement>("cropBox");
const hint = requireEl<HTMLElement>("hint");
const zoomSlider = requireEl<HTMLInputElement>("zoom");
const zoomLabel = requireEl<HTMLElement>("zoomLabel");
const dpiInput = requireEl<HTMLInputElement>("dpi");
const orientationSelect = requireEl<HTMLSelectElement>("orientation");
const paperSelect = requireEl<HTMLSelectElement>("paper");
const paperDimHint = requireEl<HTMLElement>("paperDimHint");
const exportBtn = requireEl<HTMLButtonElement>("exportBtn");
const exportTilesBtn = requireEl<HTMLButtonElement>("exportTilesBtn");
const exportStatus = requireEl<HTMLElement>("exportStatus");
const origSizeSpan = requireEl<HTMLElement>("origSize");
const boxRatioSpan = requireEl<HTMLElement>("boxRatio");
const colsInput = requireEl<HTMLInputElement>("cols");
const rowsInput = requireEl<HTMLInputElement>("rows");
const modeToggle = requireEl<HTMLInputElement>("modeToggle");
const modeToggleRow = requireEl<HTMLElement>("modeToggleRow");
const tileSettings = requireEl<HTMLElement>("tileSettings");
const blurOverlayTop = requireEl<HTMLElement>("blurOverlayTop");
const blurOverlayBottom = requireEl<HTMLElement>("blurOverlayBottom");
const blurOverlayLeft = requireEl<HTMLElement>("blurOverlayLeft");
const blurOverlayRight = requireEl<HTMLElement>("blurOverlayRight");
const tileGrid = requireEl<HTMLElement>("tileGrid");
const tileCropBox = requireEl<HTMLElement>("tileCropBox");
const previewContainer = requireEl<HTMLElement>("previewContainer");
const pdfPageRow = requireEl<HTMLElement>("pdfPageRow");
const pdfPageInput = requireEl<HTMLInputElement>("pdfPage");

let origWidth = 0;
let origHeight = 0;
let currentFile: File | null = null;
let lastPdfFile: File | null = null;
let currentMode: "crop" | "tile" = "crop";
let uploadedSource: UploadedSource | null = null;
let uploadSourceTask:
  | { fingerprint: string; task: Promise<UploadedSource> }
  | null = null;

let imgScale = 1.0;
let imgOffsetX = 0;
let imgOffsetY = 0;

let boxX = 0;
let boxY = 0;
let boxW = 0;
let boxH = 0;

let tileCropX = 0;
let tileCropY = 0;
let tileCropW = 0;
let tileCropH = 0;

let draggingStage = false;
let dragStartX = 0;
let dragStartY = 0;
let dragOrigOffsetX = 0;
let dragOrigOffsetY = 0;

let draggingBox = false;
let dragBoxStartX = 0;
let dragBoxStartY = 0;
let dragBoxOrigX = 0;
let dragBoxOrigY = 0;

let resizingBox = false;
let resizeStartX = 0;
let resizeStartY = 0;
let resizeOrigW = 0;
let resizeOrigH = 0;

let draggingTileCrop = false;
let dragTileCropStartX = 0;
let dragTileCropStartY = 0;
let dragTileCropOrigX = 0;
let dragTileCropOrigY = 0;
let resizingTileCrop = false;
let resizeTileCropStartX = 0;
let resizeTileCropStartY = 0;
let resizeTileCropOrigX = 0;
let resizeTileCropOrigY = 0;
let resizeTileCropOrigW = 0;
let resizeTileCropOrigH = 0;
let resizeTileCropHandle = "";

let resizeFitTimer = 0;

function setExportStatus(
  message: string,
  tone: "idle" | "working" | "error" | "success" = "idle"
): void {
  exportStatus.textContent = message;
  exportStatus.dataset.tone = tone;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resetRemoteSourceCache(): void {
  uploadedSource = null;
  uploadSourceTask = null;
}

setExportStatus("等待选择文件", "idle");

async function ensureUploadedSource(file: File): Promise<UploadedSource> {
  const fingerprint = buildSourceFingerprint(file);
  if (uploadedSource?.fingerprint === fingerprint) {
    return uploadedSource;
  }
  if (uploadSourceTask?.fingerprint === fingerprint) {
    return uploadSourceTask.task;
  }

  setExportStatus("正在上传源文件到 Vercel Blob…", "working");
  const task = ensureRemoteSource(file, fingerprint, (percentage) => {
    setExportStatus(
      `正在上传源文件到 Vercel Blob…${Math.round(percentage)}%`,
      "working"
    );
  })
    .then((result) => {
      uploadedSource = result;
      return result;
    })
    .finally(() => {
      if (uploadSourceTask?.fingerprint === fingerprint) {
        uploadSourceTask = null;
      }
    });
  uploadSourceTask = { fingerprint, task };
  return task;
}

/** 当前选中纸张的宽高（英寸），已考虑竖版/横版 */
function getPageInches(): { w: number; h: number } {
  return pageSizeInch(paperSelect.value, orientationSelect.value);
}

/** 取景框高/宽比 = 页高/页宽 */
function getPaperRatio(): number {
  return paperAspectRatio(getPageInches());
}

function updatePaperLabels(): void {
  const p = getPageInches();
  const paperLabel = paperSelect.value.toUpperCase();
  const orientLabel = orientationSelect.value === "portrait" ? "竖版" : "横版";
  paperDimHint.textContent = `${orientLabel} ${paperLabel}：${p.w} × ${p.h} in`;
  boxRatioSpan.textContent = `${paperLabel} ${orientLabel}（${p.w} × ${p.h} in）`;
}

function rectRelStage(
  el: HTMLElement,
  stageRect: DOMRect
): { left: number; top: number; width: number; height: number } {
  const r = el.getBoundingClientRect();
  return {
    left: r.left - stageRect.left,
    top: r.top - stageRect.top,
    width: r.width,
    height: r.height,
  };
}

function unionRect(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number }
): { left: number; top: number; width: number; height: number } {
  const ax2 = a.left + a.width;
  const ay2 = a.top + a.height;
  const bx2 = b.left + b.width;
  const by2 = b.top + b.height;
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(ax2, bx2);
  const bottom = Math.max(ay2, by2);
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * 将「整图 ∪ 取景框（或分页截取框）」完整纳入 stage，可选缩小与居中平移。
 */
function fitUnionToStage(): void {
  if (!origWidth || !origHeight) return;
  const stageRect = stage.getBoundingClientRect();
  const stageW = stageRect.width;
  const stageH = stageRect.height;
  const usableW = stageW * FIT_MARGIN;
  const usableH = stageH * FIT_MARGIN;

  const imgR = rectRelStage(imageEl, stageRect);
  let union = { ...imgR };
  if (currentMode === "crop" && cropBox.style.display !== "none") {
    union = unionRect(union, rectRelStage(cropBox, stageRect));
  } else if (currentMode === "tile" && tileCropBox.style.display !== "none") {
    union = unionRect(union, rectRelStage(tileCropBox, stageRect));
  }

  const unionW = union.width;
  const unionH = union.height;
  if (unionW <= 0 || unionH <= 0) return;

  const fResize = Math.min(usableW / unionW, usableH / unionH, 1);
  const ucx = union.left + unionW / 2;
  const ucy = union.top + unionH / 2;

  if (fResize < 1) {
    imgScale *= fResize;
    imgOffsetX = ucx - fResize * (ucx - imgOffsetX);
    imgOffsetY = ucy - fResize * (ucy - imgOffsetY);
    boxX = ucx - fResize * (ucx - boxX);
    boxY = ucy - fResize * (ucy - boxY);
    boxW *= fResize;
    boxH *= fResize;
    tileCropX = ucx - fResize * (ucx - tileCropX);
    tileCropY = ucy - fResize * (ucy - tileCropY);
    tileCropW *= fResize;
    tileCropH *= fResize;
    updateImageTransform();
    applyBoxStyle();
    applyTileCropBoxStyle();
  }

  const imgR2 = rectRelStage(imageEl, stageRect);
  let union2 = { ...imgR2 };
  if (currentMode === "crop" && cropBox.style.display !== "none") {
    union2 = unionRect(union2, rectRelStage(cropBox, stageRect));
  } else if (currentMode === "tile" && tileCropBox.style.display !== "none") {
    union2 = unionRect(union2, rectRelStage(tileCropBox, stageRect));
  }
  const dx = (stageW - union2.width) / 2 - union2.left;
  const dy = (stageH - union2.height) / 2 - union2.top;
  imgOffsetX += dx;
  imgOffsetY += dy;
  boxX += dx;
  boxY += dy;
  tileCropX += dx;
  tileCropY += dy;
  updateImageTransform();
  applyBoxStyle();
  applyTileCropBoxStyle();

  const sv = Math.max(1, Math.min(100, Math.round(scaleToSlider(imgScale))));
  zoomSlider.value = String(sv);
  zoomLabel.textContent = `${Math.round(imgScale * 100)}%`;

  if (currentMode === "crop") {
    clampBoxInsideImage();
    updateBlurMask();
  } else {
    setTimeout(drawTileGrid, 10);
  }
}

// 非线性缩放映射：滑块值(1-100) -> 实际缩放比例
function sliderToScale(sliderValue: number): number {
  const normalized = (sliderValue - 1) / 99;
  if (normalized < 0.5) {
    const t = normalized * 2;
    return 0.01 + (0.2 - 0.01) * Math.pow(t, 0.5);
  }
  const t = (normalized - 0.5) * 2;
  return 0.2 + (1.0 - 0.2) * Math.pow(t, 2);
}

function scaleToSlider(scale: number): number {
  if (scale <= 0.2) {
    const t = (scale - 0.01) / (0.2 - 0.01);
    const normalized = Math.pow(t, 2) / 2;
    return 1 + normalized * 49;
  }
  const t = (scale - 0.2) / (1.0 - 0.2);
  const normalized = 0.5 + Math.pow(t, 0.5) / 2;
  return 1 + normalized * 99;
}

function updateImageTransform(): void {
  imageEl.style.transform = `translate(${imgOffsetX}px, ${imgOffsetY}px) scale(${imgScale})`;
}

function layoutInitial(): void {
  const stageRect = stage.getBoundingClientRect();
  const stageW = stageRect.width;
  const stageH = stageRect.height;

  const scaleX = stageW / origWidth;
  const scaleY = stageH / origHeight;
  imgScale = Math.min(scaleX, scaleY) * FIT_MARGIN;

  const sliderValue = Math.max(
    1,
    Math.min(100, Math.round(scaleToSlider(imgScale)))
  );
  zoomSlider.value = String(sliderValue);
  zoomLabel.textContent = `${Math.round(imgScale * 100)}%`;

  const displayW = origWidth * imgScale;
  const displayH = origHeight * imgScale;
  imgOffsetX = (stageW - displayW) / 2;
  imgOffsetY = (stageH - displayH) / 2;
  updateImageTransform();

  const ratio = getPaperRatio();
  boxW = displayW * 0.5;
  boxH = boxW * ratio;
  if (boxH > displayH * 0.8) {
    boxH = displayH * 0.8;
    boxW = boxH / ratio;
  }
  boxX = imgOffsetX + (displayW - boxW) / 2;
  boxY = imgOffsetY + (displayH - boxH) / 2;
  applyBoxStyle();

  tileCropW = displayW * 0.9;
  tileCropH = displayH * 0.9;
  tileCropX = imgOffsetX + (displayW - tileCropW) / 2;
  tileCropY = imgOffsetY + (displayH - tileCropH) / 2;
  applyTileCropBoxStyle();
}

function applyTileCropBoxStyle(): void {
  tileCropBox.style.left = `${tileCropX}px`;
  tileCropBox.style.top = `${tileCropY}px`;
  tileCropBox.style.width = `${tileCropW}px`;
  tileCropBox.style.height = `${tileCropH}px`;
  if (currentMode === "tile") {
    setTimeout(drawTileGrid, 10);
  }
}

function applyBoxStyle(): void {
  cropBox.style.left = `${boxX}px`;
  cropBox.style.top = `${boxY}px`;
  cropBox.style.width = `${boxW}px`;
  cropBox.style.height = `${boxH}px`;
  updateBlurMask();
}

function updateBlurMask(): void {
  if (currentMode !== "crop" || !origWidth || !origHeight) return;
  const stageRect = stage.getBoundingClientRect();
  const boxRect = cropBox.getBoundingClientRect();

  const boxLeft = boxRect.left - stageRect.left;
  const boxTop = boxRect.top - stageRect.top;
  const boxRight = boxRect.right - stageRect.left;
  const boxBottom = boxRect.bottom - stageRect.top;
  const stageWidth = stageRect.width;
  const stageHeight = stageRect.height;

  if (boxTop > 0) {
    blurOverlayTop.style.display = "block";
    blurOverlayTop.style.top = "0";
    blurOverlayTop.style.left = "0";
    blurOverlayTop.style.right = "0";
    blurOverlayTop.style.height = `${Math.max(0, boxTop)}px`;
  } else {
    blurOverlayTop.style.display = "none";
  }

  if (boxBottom < stageHeight) {
    blurOverlayBottom.style.display = "block";
    blurOverlayBottom.style.bottom = "0";
    blurOverlayBottom.style.left = "0";
    blurOverlayBottom.style.right = "0";
    blurOverlayBottom.style.height = `${Math.max(0, stageHeight - boxBottom)}px`;
  } else {
    blurOverlayBottom.style.display = "none";
  }

  if (boxLeft > 0) {
    blurOverlayLeft.style.display = "block";
    blurOverlayLeft.style.top = `${Math.max(0, boxTop)}px`;
    blurOverlayLeft.style.left = "0";
    blurOverlayLeft.style.bottom = `${Math.max(0, stageHeight - boxBottom)}px`;
    blurOverlayLeft.style.width = `${Math.max(0, boxLeft)}px`;
  } else {
    blurOverlayLeft.style.display = "none";
  }

  if (boxRight < stageWidth) {
    blurOverlayRight.style.display = "block";
    blurOverlayRight.style.top = `${Math.max(0, boxTop)}px`;
    blurOverlayRight.style.right = "0";
    blurOverlayRight.style.bottom = `${Math.max(0, stageHeight - boxBottom)}px`;
    blurOverlayRight.style.width = `${Math.max(0, stageWidth - boxRight)}px`;
  } else {
    blurOverlayRight.style.display = "none";
  }
}

function drawTileGrid(): void {
  if (currentMode !== "tile" || !origWidth || !origHeight) {
    tileGrid.innerHTML = "";
    return;
  }

  const cols = Math.max(1, parseInt(colsInput.value || "2", 10));
  const rows = Math.max(1, parseInt(rowsInput.value || "2", 10));
  const page = getPageInches();

  const pageW = page.w;
  const pageH = page.h;
  const totalRatio = (cols * pageW) / (rows * pageH);

  const stageRect = stage.getBoundingClientRect();
  const tileCropRect = tileCropBox.getBoundingClientRect();

  if (tileCropRect.width <= 0 || tileCropRect.height <= 0 || !tileCropBox.offsetParent) {
    tileGrid.innerHTML = "";
    return;
  }

  const cropWidth = tileCropRect.width;
  const cropHeight = tileCropRect.height;

  const cropRatio = cropWidth / cropHeight;
  let gridWidth: number;
  let gridHeight: number;
  let gridOffsetX: number;
  let gridOffsetY: number;

  if (cropRatio > totalRatio) {
    gridHeight = cropHeight;
    gridWidth = gridHeight * totalRatio;
    gridOffsetX = (cropWidth - gridWidth) / 2;
    gridOffsetY = 0;
  } else {
    gridWidth = cropWidth;
    gridHeight = gridWidth / totalRatio;
    gridOffsetX = 0;
    gridOffsetY = (cropHeight - gridHeight) / 2;
  }

  const cropLeftOnStage = tileCropRect.left - stageRect.left;
  const cropTopOnStage = tileCropRect.top - stageRect.top;

  const gridLeft = cropLeftOnStage + gridOffsetX;
  const gridTop = cropTopOnStage + gridOffsetY;

  tileGrid.innerHTML = "";
  tileGrid.style.display = "block";

  for (let i = 1; i < cols; i++) {
    const x = (gridWidth / cols) * i;
    const line = document.createElement("div");
    line.className = "tile-grid-line vertical";
    line.style.left = `${gridLeft + x}px`;
    line.style.top = `${gridTop}px`;
    line.style.height = `${gridHeight}px`;
    tileGrid.appendChild(line);
  }

  for (let j = 1; j < rows; j++) {
    const y = (gridHeight / rows) * j;
    const line = document.createElement("div");
    line.className = "tile-grid-line horizontal";
    line.style.left = `${gridLeft}px`;
    line.style.top = `${gridTop + y}px`;
    line.style.width = `${gridWidth}px`;
    tileGrid.appendChild(line);
  }

  const borderBox = document.createElement("div");
  borderBox.className = "tile-grid-border";
  borderBox.style.left = `${gridLeft}px`;
  borderBox.style.top = `${gridTop}px`;
  borderBox.style.width = `${gridWidth}px`;
  borderBox.style.height = `${gridHeight}px`;
  tileGrid.appendChild(borderBox);
}

function switchMode(isTile: boolean): void {
  currentMode = isTile ? "tile" : "crop";

  if (isTile) {
    stage.classList.remove("mode-crop");
    stage.classList.add("mode-tile");
    modeToggleRow.classList.remove("active-crop");
    modeToggleRow.classList.add("active-tile");
    tileSettings.style.display = "block";
    exportBtn.style.display = "none";
    exportTilesBtn.style.display = "block";
    exportTilesBtn.disabled = false;
    cropBox.style.display = "none";
    blurOverlayTop.style.display = "none";
    blurOverlayBottom.style.display = "none";
    blurOverlayLeft.style.display = "none";
    blurOverlayRight.style.display = "none";
    if (origWidth && origHeight) {
      tileCropBox.style.display = "block";
      setTimeout(drawTileGrid, 10);
    }
  } else {
    stage.classList.remove("mode-tile");
    stage.classList.add("mode-crop");
    modeToggleRow.classList.remove("active-tile");
    modeToggleRow.classList.add("active-crop");
    tileSettings.style.display = "none";
    exportBtn.style.display = "block";
    exportTilesBtn.style.display = "none";
    tileCropBox.style.display = "none";
    tileGrid.innerHTML = "";
    if (origWidth && origHeight) {
      cropBox.style.display = "block";
      blurOverlayTop.style.display = "block";
      blurOverlayBottom.style.display = "block";
      blurOverlayLeft.style.display = "block";
      blurOverlayRight.style.display = "block";
    }
    updateBlurMask();
  }
}

function applyZoomFromSlider(): void {
  if (!origWidth || !origHeight) return;
  const stageRect = stage.getBoundingClientRect();
  const stageW = stageRect.width;
  const stageH = stageRect.height;

  const oldScale = imgScale;
  const sliderValue = parseInt(zoomSlider.value, 10);
  const newScale = sliderToScale(sliderValue);
  imgScale = newScale;
  zoomLabel.textContent = `${Math.round(newScale * 100)}%`;

  const stageCenterX = stageW / 2;
  const stageCenterY = stageH / 2;

  const imgCenterX = imgOffsetX + (origWidth * oldScale) / 2;
  const imgCenterY = imgOffsetY + (origHeight * oldScale) / 2;
  const dx = imgCenterX - stageCenterX;
  const dy = imgCenterY - stageCenterY;

  const newImgCenterX = stageCenterX + dx * (newScale / oldScale);
  const newImgCenterY = stageCenterY + dy * (newScale / oldScale);
  imgOffsetX += imgCenterX - newImgCenterX;
  imgOffsetY += imgCenterY - newImgCenterY;
  updateImageTransform();
}

function clampBoxInsideImage(): void {
  const imgRect = imageEl.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();

  const minX = Math.max(stageRect.left, imgRect.left);
  const minY = Math.max(stageRect.top, imgRect.top);
  const maxX = Math.min(stageRect.right, imgRect.right);
  const maxY = Math.min(stageRect.bottom, imgRect.bottom);

  const boxRect = cropBox.getBoundingClientRect();
  let newLeft = boxRect.left;
  let newTop = boxRect.top;
  let newRight = boxRect.right;
  let newBottom = boxRect.bottom;

  const width = boxRect.width;
  const height = boxRect.height;

  if (width > maxX - minX) {
    newLeft = minX;
    newRight = maxX;
  } else {
    if (boxRect.left < minX) {
      newLeft = minX;
      newRight = minX + width;
    }
    if (boxRect.right > maxX) {
      newRight = maxX;
      newLeft = maxX - width;
    }
  }

  if (height > maxY - minY) {
    newTop = minY;
    newBottom = maxY;
  } else {
    if (boxRect.top < minY) {
      newTop = minY;
      newBottom = minY + height;
    }
    if (boxRect.bottom > maxY) {
      newBottom = maxY;
      newTop = maxY - height;
    }
  }

  const rdx = newLeft - boxRect.left;
  const rdy = newTop - boxRect.top;
  boxX += rdx;
  boxY += rdy;
  applyBoxStyle();
}

function scheduleResizeFit(): void {
  if (!origWidth || !origHeight) return;
  if (resizeFitTimer) window.clearTimeout(resizeFitTimer);
  resizeFitTimer = window.setTimeout(() => {
    resizeFitTimer = 0;
    fitUnionToStage();
  }, 120);
}

function finishImageLoaded(): void {
  origWidth = imageEl.naturalWidth;
  origHeight = imageEl.naturalHeight;
  if (!origWidth || !origHeight) {
    alert("图片尺寸无效，请换一张图或检查 PDF 页是否为空。");
    return;
  }
  origSizeSpan.textContent = `${origWidth} × ${origHeight} px`;
  hint.style.display = "none";
  imageEl.style.display = "block";
  cropBox.style.display = "block";
  blurOverlayTop.style.display = "block";
  blurOverlayBottom.style.display = "block";
  blurOverlayLeft.style.display = "block";
  blurOverlayRight.style.display = "block";
  updatePaperLabels();
  layoutInitial();
  exportBtn.disabled = false;
  exportTilesBtn.disabled = false;
  switchMode(!modeToggle.checked);
  fitUnionToStage();
  if (currentMode === "crop") {
    updateBlurMask();
  }
  setExportStatus("文件已就绪，可以开始导出 PDF", "idle");
}

function loadImageFromFile(file: File): void {
  resetRemoteSourceCache();
  currentFile = file;
  lastPdfFile = null;
  pdfPageRow.style.display = "none";

  const reader = new FileReader();
  reader.onload = (ev: ProgressEvent<FileReader>) => {
    const result = ev.target?.result;
    if (typeof result !== "string") {
      alert("读取文件结果无效。");
      return;
    }
    imageEl.onload = () => finishImageLoaded();
    imageEl.onerror = () => {
      alert("图片加载失败。");
    };
    imageEl.src = result;
  };
  reader.onerror = () => {
    alert("读取文件失败。");
  };
  reader.readAsDataURL(file);
}

interface RasterizedPdfPage {
  file: File;
  width: number;
  height: number;
}

interface RasterizePdfOptions {
  targetWidth?: number;
  targetHeight?: number;
  replaceCurrentFile?: boolean;
}

async function rasterizePdfPageToImage(
  pdfFile: File,
  options: RasterizePdfOptions = {}
): Promise<RasterizedPdfPage> {
  const buf = await pdfFile.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const numPages = pdf.numPages;
  pdfPageInput.max = String(numPages);

  let pageNum = parseInt(pdfPageInput.value, 10);
  if (!Number.isFinite(pageNum) || pageNum < 1) pageNum = 1;
  pageNum = Math.min(pageNum, numPages);
  pdfPageInput.value = String(pageNum);
  pdfPageRow.style.display = "block";

  const page = await pdf.getPage(pageNum);
  const baseVp = page.getViewport({ scale: 1 });
  let scale = 2;
  if (options.targetWidth && options.targetHeight) {
    scale = Math.min(
      options.targetWidth / baseVp.width,
      options.targetHeight / baseVp.height
    );
  }
  let vw = baseVp.width * scale;
  let vh = baseVp.height * scale;
  const maxDim = Math.max(vw, vh);
  if (maxDim > MAX_CANVAS_DIM) {
    scale *= MAX_CANVAS_DIM / maxDim;
  }
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    alert("无法创建 Canvas，PDF 渲染失败。");
    return;
  }
  const renderTask = page.render({ canvasContext: ctx, viewport });
  await renderTask.promise;

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG 编码失败"))),
      "image/png"
    );
  });

  const baseName = pdfFile.name.replace(/\.pdf$/i, "") || "document";
  const pngName = `${baseName}_p${pageNum}.png`;
  const pngFile = new File([blob], pngName, {
    type: "image/png",
    lastModified: pdfFile.lastModified,
  });
  const result = {
    file: pngFile,
    width: canvas.width,
    height: canvas.height,
  };

  if (options.replaceCurrentFile !== false) {
    resetRemoteSourceCache();
    currentFile = pngFile;

    const url = URL.createObjectURL(blob);
    imageEl.onload = () => {
      URL.revokeObjectURL(url);
      finishImageLoaded();
    };
    imageEl.onerror = () => {
      URL.revokeObjectURL(url);
      alert("PDF 转图片后无法显示。");
    };
    imageEl.src = url;
  }

  return result;
}

async function processSelectedFile(file: File): Promise<void> {
  if (!file) return;
  setExportStatus("正在读取文件…", "working");
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    lastPdfFile = file;
    try {
      await rasterizePdfPageToImage(file);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setExportStatus(`PDF 处理失败：${msg}`, "error");
      alert(`PDF 处理失败：${msg}`);
    }
  } else if (file.type.startsWith("image/")) {
    loadImageFromFile(file);
  } else {
    setExportStatus("请选择图片文件或 PDF", "error");
    alert("请选择图片文件或 PDF。");
  }
}

function repositionCropForPaperChange(): void {
  if (!origWidth || !origHeight) return;
  const ratio = getPaperRatio();
  const displayH = origHeight * imgScale;
  const displayW = origWidth * imgScale;
  boxW = displayW * 0.5;
  boxH = boxW * ratio;
  if (boxH > displayH * 0.8) {
    boxH = displayH * 0.8;
    boxW = boxH / ratio;
  }
  boxX = imgOffsetX + (displayW - boxW) / 2;
  boxY = imgOffsetY + (displayH - boxH) / 2;
  applyBoxStyle();
  clampBoxInsideImage();
}

modeToggle.addEventListener("change", (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement)) return;
  switchMode(!t.checked);
  if (origWidth && origHeight) {
    fitUnionToStage();
  }
});

imageInput.addEventListener("change", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLInputElement)) return;
  const file = target.files?.[0];
  if (file) {
    void processSelectedFile(file);
  }
  target.value = "";
});

const fitWindowBtn = requireEl<HTMLButtonElement>("fitWindowBtn");
fitWindowBtn.addEventListener("click", () => {
  fitUnionToStage();
});

zoomSlider.addEventListener("input", () => {
  applyZoomFromSlider();
  clampBoxInsideImage();
  if (currentMode === "tile") {
    setTimeout(drawTileGrid, 10);
  }
});

stage.addEventListener(
  "wheel",
  (e) => {
    if (!origWidth || !origHeight) return;
    if (e.metaKey || e.altKey) {
      e.preventDefault();
      const oldScale = imgScale;
      const oldSliderValue = scaleToSlider(oldScale);

      const delta = e.deltaY > 0 ? -1 : 1;
      const newSliderValue = Math.max(1, Math.min(100, oldSliderValue + delta));
      const newScale = sliderToScale(newSliderValue);
      imgScale = newScale;

      zoomSlider.value = String(Math.round(newSliderValue));
      zoomLabel.textContent = `${Math.round(newScale * 100)}%`;

      const stageRect = stage.getBoundingClientRect();
      const mouseX = e.clientX - stageRect.left;
      const mouseY = e.clientY - stageRect.top;

      const scaleRatio = newScale / oldScale;
      const imgX = mouseX - imgOffsetX;
      const imgY = mouseY - imgOffsetY;
      imgOffsetX = mouseX - imgX * scaleRatio;
      imgOffsetY = mouseY - imgY * scaleRatio;

      updateImageTransform();

      if (currentMode === "crop") {
        clampBoxInsideImage();
        updateBlurMask();
      } else {
        setTimeout(drawTileGrid, 10);
      }
    }
  },
  { passive: false }
);

function onPaperOrOrientationChange(): void {
  updatePaperLabels();
  if (!origWidth || !origHeight) return;
  if (currentMode === "crop") {
    repositionCropForPaperChange();
    fitUnionToStage();
  } else {
    setTimeout(drawTileGrid, 10);
  }
}

orientationSelect.addEventListener("change", onPaperOrOrientationChange);
paperSelect.addEventListener("change", onPaperOrOrientationChange);

[colsInput, rowsInput].forEach((input) => {
  input.addEventListener("input", () => {
    if (currentMode === "tile") {
      setTimeout(drawTileGrid, 10);
    }
  });
});

function onPdfPageCommit(): void {
  if (!lastPdfFile) return;
  void rasterizePdfPageToImage(lastPdfFile).catch((err) => {
    console.error(err);
    const msg = err instanceof Error ? err.message : String(err);
    alert(`PDF 重新渲染失败：${msg}`);
  });
}

pdfPageInput.addEventListener("change", onPdfPageCommit);
pdfPageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    onPdfPageCommit();
  }
});

previewContainer.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.dataTransfer!.dropEffect = "copy";
  previewContainer.classList.add("drag-over");
});

previewContainer.addEventListener("dragleave", (e) => {
  const rel = e.relatedTarget;
  if (rel == null || !previewContainer.contains(rel as Node)) {
    previewContainer.classList.remove("drag-over");
  }
});

previewContainer.addEventListener("drop", (e) => {
  e.preventDefault();
  previewContainer.classList.remove("drag-over");
  const f = e.dataTransfer?.files?.[0];
  if (f) {
    void processSelectedFile(f);
  }
});

stage.addEventListener("mousedown", (e) => {
  if (e.target === cropBox || (e.target instanceof Element && e.target.closest("#cropBox")))
    return;
  if (
    e.target === tileCropBox ||
    (e.target instanceof Element && e.target.closest("#tileCropBox"))
  )
    return;
  if (!origWidth || !origHeight) return;
  draggingStage = true;
  stage.classList.add("dragging");
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragOrigOffsetX = imgOffsetX;
  dragOrigOffsetY = imgOffsetY;
});

cropBox.addEventListener("mousedown", (e) => {
  const me = expectMouseEvent(e);
  if (me.target instanceof Element && me.target.classList.contains("handle")) return;
  draggingBox = true;
  dragBoxStartX = me.clientX;
  dragBoxStartY = me.clientY;
  const rect = cropBox.getBoundingClientRect();
  dragBoxOrigX = rect.left;
  dragBoxOrigY = rect.top;
  me.stopPropagation();
});

const handleBr = cropBox.querySelector(".handle.br");
if (!handleBr) {
  throw new Error("缺少取景框右下角手柄 .handle.br");
}
handleBr.addEventListener("mousedown", (e) => {
  const me = expectMouseEvent(e);
  resizingBox = true;
  resizeStartX = me.clientX;
  resizeStartY = me.clientY;
  const rect = cropBox.getBoundingClientRect();
  resizeOrigW = rect.width;
  resizeOrigH = rect.height;
  me.stopPropagation();
});

tileCropBox.addEventListener("mousedown", (e) => {
  const me = expectMouseEvent(e);
  if (me.target instanceof Element && me.target.classList.contains("handle")) return;
  draggingTileCrop = true;
  dragTileCropStartX = me.clientX;
  dragTileCropStartY = me.clientY;
  const rect = tileCropBox.getBoundingClientRect();
  dragTileCropOrigX = rect.left;
  dragTileCropOrigY = rect.top;
  me.stopPropagation();
});

const tileCropHandles = tileCropBox.querySelectorAll(".handle");
tileCropHandles.forEach((handle) => {
  handle.addEventListener("mousedown", (e) => {
    const me = expectMouseEvent(e);
    resizingTileCrop = true;
    resizeTileCropHandle = handle.className.split(" ")[1] ?? "";
    resizeTileCropStartX = me.clientX;
    resizeTileCropStartY = me.clientY;
    const rect = tileCropBox.getBoundingClientRect();
    resizeTileCropOrigX = rect.left;
    resizeTileCropOrigY = rect.top;
    resizeTileCropOrigW = rect.width;
    resizeTileCropOrigH = rect.height;
    me.stopPropagation();
  });
});

window.addEventListener("mousemove", (e) => {
  if (draggingStage) {
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    imgOffsetX = dragOrigOffsetX + dx;
    imgOffsetY = dragOrigOffsetY + dy;
    updateImageTransform();
    if (currentMode === "tile") {
      setTimeout(drawTileGrid, 10);
    }
  } else if (draggingBox) {
    const dx = e.clientX - dragBoxStartX;
    const dy = e.clientY - dragBoxStartY;
    const newLeft = dragBoxOrigX + dx;
    const newTop = dragBoxOrigY + dy;
    const stageRect = stage.getBoundingClientRect();
    boxX = newLeft - stageRect.left;
    boxY = newTop - stageRect.top;
    applyBoxStyle();
    clampBoxInsideImage();
  } else if (resizingBox) {
    const dx = e.clientX - resizeStartX;
    const ratio = getPaperRatio();
    let newW = resizeOrigW + dx;
    newW = Math.max(40, newW);
    const newH = newW * ratio;
    boxW = newW;
    boxH = newH;
    applyBoxStyle();
    clampBoxInsideImage();
  } else if (draggingTileCrop) {
    const dx = e.clientX - dragTileCropStartX;
    const dy = e.clientY - dragTileCropStartY;
    const newLeft = dragTileCropOrigX + dx;
    const newTop = dragTileCropOrigY + dy;
    const stageRect = stage.getBoundingClientRect();
    tileCropX = newLeft - stageRect.left;
    tileCropY = newTop - stageRect.top;
    applyTileCropBoxStyle();
  } else if (resizingTileCrop) {
    const dx = e.clientX - resizeTileCropStartX;
    const dy = e.clientY - resizeTileCropStartY;
    const stageRect = stage.getBoundingClientRect();
    let newX = resizeTileCropOrigX;
    let newY = resizeTileCropOrigY;
    let newW = resizeTileCropOrigW;
    let newH = resizeTileCropOrigH;

    if (resizeTileCropHandle.includes("l")) {
      newX = resizeTileCropOrigX + dx;
      newW = resizeTileCropOrigW - dx;
    }
    if (resizeTileCropHandle.includes("r")) {
      newW = resizeTileCropOrigW + dx;
    }
    if (resizeTileCropHandle.includes("t")) {
      newY = resizeTileCropOrigY + dy;
      newH = resizeTileCropOrigH - dy;
    }
    if (resizeTileCropHandle.includes("b")) {
      newH = resizeTileCropOrigH + dy;
    }

    newW = Math.max(100, newW);
    newH = Math.max(100, newH);

    tileCropX = newX - stageRect.left;
    tileCropY = newY - stageRect.top;
    tileCropW = newW;
    tileCropH = newH;
    applyTileCropBoxStyle();
  }
});

window.addEventListener("mouseup", () => {
  draggingStage = false;
  draggingBox = false;
  resizingBox = false;
  draggingTileCrop = false;
  resizingTileCrop = false;
  resizeTileCropHandle = "";
  stage.classList.remove("dragging");
});

function computeCropOnOriginal(): {
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
} | null {
  const imgRect = imageEl.getBoundingClientRect();
  const boxRect = cropBox.getBoundingClientRect();
  const intersectLeft = Math.max(boxRect.left, imgRect.left);
  const intersectTop = Math.max(boxRect.top, imgRect.top);
  const intersectRight = Math.min(boxRect.right, imgRect.right);
  const intersectBottom = Math.min(boxRect.bottom, imgRect.bottom);
  if (intersectRight <= intersectLeft || intersectBottom <= intersectTop) {
    return null;
  }
  const cropScreenW = intersectRight - intersectLeft;
  const cropScreenH = intersectBottom - intersectTop;
  const offsetXOnImg = intersectLeft - imgRect.left;
  const offsetYOnImg = intersectTop - imgRect.top;
  const scaleX = origWidth / imgRect.width;
  const scaleY = origHeight / imgRect.height;
  const cropX = offsetXOnImg * scaleX;
  const cropY = offsetYOnImg * scaleY;
  const cropW = cropScreenW * scaleX;
  const cropH = cropScreenH * scaleY;
  return { cropX, cropY, cropW, cropH };
}

/** 导出链路日志。 */
function logExportStep(stage: string, payload: Record<string, unknown>): void {
  console.info(`[export] ${stage}`, {
    ...payload,
    href: window.location.href,
    ts: new Date().toISOString(),
  });
}

function logExportError(
  stage: string,
  err: unknown,
  extra: Record<string, unknown>
): void {
  console.error(`[export] ${stage} failed`, { err, ...extra });
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
}

/** 导出按钮点击后，同步打开空白页签，降低浏览器拦截概率。 */
function openExportDownloadTab(mode: ExportMode): PendingDownloadTab {
  const pendingTab = openPendingDownloadTab();
  logExportStep("download-tab-opened", { mode });
  return pendingTab;
}

/** 下载链接就绪后，让预先打开的页签开始真正下载。 */
function navigateExportDownloadTab(
  pendingTab: PendingDownloadTab,
  mode: ExportMode,
  downloadUrl: string
): void {
  logExportStep("download-tab-navigate", { mode, downloadUrl });
  pendingTab.navigateToDownload(downloadUrl);
}

function parseSelectedDpi(): number {
  return parseInt(dpiInput.value || "300", 10) || 300;
}

function getTileCropOnOriginal(): CropRect {
  const imgRect = imageEl.getBoundingClientRect();
  const tileCropRect = tileCropBox.getBoundingClientRect();
  const scaleX = origWidth / imgRect.width;
  const scaleY = origHeight / imgRect.height;
  const cropX = Math.max(0, (tileCropRect.left - imgRect.left) * scaleX);
  const cropY = Math.max(0, (tileCropRect.top - imgRect.top) * scaleY);
  return {
    cropX,
    cropY,
    cropW: Math.min(origWidth - cropX, tileCropRect.width * scaleX),
    cropH: Math.min(origHeight - cropY, tileCropRect.height * scaleY),
  };
}

async function prepareSourceForExport(options: {
  mode: ExportMode;
  rect: CropRect;
  dpi: number;
  cols?: number;
  rows?: number;
}): Promise<{
  file: File;
  sourceName: string;
  rect: CropRect;
  qualityWarning: string | null;
  qualityMetrics: Record<string, unknown>;
}> {
  if (!currentFile) {
    throw new Error("当前没有可导出的源文件");
  }

  const outputPixels = computeOutputPixelSize({
    paper: paperSelect.value,
    orientation: orientationSelect.value,
    dpi: options.dpi,
    mode: options.mode,
    cols: options.cols,
    rows: options.rows,
  });

  if (!lastPdfFile) {
    const warning = evaluateExportQuality({
      sourceCropWidth: options.rect.cropW,
      sourceCropHeight: options.rect.cropH,
      targetWidth: outputPixels.width,
      targetHeight: outputPixels.height,
      targetDpi: options.dpi,
    });
    return {
      file: currentFile,
      sourceName: currentFile.name,
      rect: options.rect,
      qualityWarning: warning?.message ?? null,
      qualityMetrics: {
        source_px: `${Math.round(options.rect.cropW)}x${Math.round(
          options.rect.cropH
        )}`,
        target_px: `${outputPixels.width}x${outputPixels.height}`,
        upscale_ratio: Number((warning?.upscaleRatio ?? 1).toFixed(4)),
      },
    };
  }

  const plan = buildPdfRasterizePlan({
    previewWidth: origWidth,
    previewHeight: origHeight,
    cropWidth: options.rect.cropW,
    cropHeight: options.rect.cropH,
    paper: paperSelect.value,
    orientation: orientationSelect.value,
    dpi: options.dpi,
    mode: options.mode,
    cols: options.cols,
    rows: options.rows,
    maxCanvasDim: MAX_CANVAS_DIM,
  });
  const rasterized = await rasterizePdfPageToImage(lastPdfFile, {
    targetWidth: plan.rasterWidth,
    targetHeight: plan.rasterHeight,
    replaceCurrentFile: false,
  });
  const scaledRect = scaleCropRect(
    options.rect,
    { width: origWidth, height: origHeight },
    { width: rasterized.width, height: rasterized.height }
  );
  const warning = evaluateExportQuality({
    sourceCropWidth: scaledRect.cropW,
    sourceCropHeight: scaledRect.cropH,
    targetWidth: outputPixels.width,
    targetHeight: outputPixels.height,
    targetDpi: options.dpi,
  });

  return {
    file: rasterized.file,
    sourceName: lastPdfFile.name,
    rect: scaledRect,
    qualityWarning: warning?.message ?? null,
    qualityMetrics: {
      source_px: `${Math.round(scaledRect.cropW)}x${Math.round(
        scaledRect.cropH
      )}`,
      target_px: `${outputPixels.width}x${outputPixels.height}`,
      upscale_ratio: Number((warning?.upscaleRatio ?? 1).toFixed(4)),
      preview_px: `${origWidth}x${origHeight}`,
      desired_raster_px: `${plan.desiredRasterWidth}x${plan.desiredRasterHeight}`,
      raster_px: `${rasterized.width}x${rasterized.height}`,
      raster_clamped: plan.clamped,
    },
  };
}

exportBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  const rect = computeCropOnOriginal();
  if (!rect) {
    alert("当前取景框不在图片区域内，请稍微移动后重试。");
    return;
  }
  const dpi = parseSelectedDpi();
  let pendingTab: PendingDownloadTab | null = null;
  try {
    pendingTab = openExportDownloadTab("single");
  } catch (err) {
    const msg = describeError(err);
    logExportError("download-tab-blocked", err, { mode: "single" });
    setExportStatus(msg, "error");
    alert(msg);
    return;
  }
  logExportStep("start", {
    mode: "single",
    paper: paperSelect.value,
    orientation: orientationSelect.value,
    dpi,
    cropRect: rect,
    fileSize: currentFile.size,
    fileName: currentFile.name,
  });

  exportBtn.disabled = true;
  exportBtn.textContent = "正在导出 PDF…";
  try {
    const preparedSource = await prepareSourceForExport({
      mode: "single",
      rect,
      dpi,
    });
    if (preparedSource.qualityWarning) {
      setExportStatus(`清晰度提示：${preparedSource.qualityWarning}`, "idle");
      console.warn("[export] quality-warning", preparedSource.qualityMetrics);
    }
    const source = await ensureUploadedSource(preparedSource.file);
    setExportStatus("正在生成单页 PDF…", "working");
    const prepared = await prepareSingleExport({
      sourceUrl: source.url,
      sourceName: preparedSource.sourceName,
      cropX: preparedSource.rect.cropX,
      cropY: preparedSource.rect.cropY,
      cropW: preparedSource.rect.cropW,
      cropH: preparedSource.rect.cropH,
      dpi,
      paper: paperSelect.value,
      orientation: orientationSelect.value,
    });
    setExportStatus("正在生成下载链接…", "working");
    const downloadUrl = await requestDownloadUrl(prepared.pathname);
    logExportStep("prepareOk", {
      pathname: prepared.pathname,
      filename: prepared.filename,
      downloadUrl,
      ...preparedSource.qualityMetrics,
    });
    setExportStatus(`导出已就绪：${prepared.filename}`, "success");
    navigateExportDownloadTab(pendingTab, "single", downloadUrl);
    pendingTab = null;
  } catch (err) {
    const msg = describeError(err);
    pendingTab?.closePendingTab();
    logExportError("single-export", err, {});
    setExportStatus(`导出失败：${msg}`, "error");
    alert(msg);
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = "导出当前视野为 PDF";
  }
});

exportTilesBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  const cols = Math.max(1, parseInt(colsInput.value || "2", 10));
  const rows = Math.max(1, parseInt(rowsInput.value || "2", 10));
  const dpi = parseSelectedDpi();
  const orientation = orientationSelect.value || "portrait";
  const tileRect = getTileCropOnOriginal();
  let pendingTab: PendingDownloadTab | null = null;
  try {
    pendingTab = openExportDownloadTab("tiles");
  } catch (err) {
    const msg = describeError(err);
    logExportError("download-tab-blocked", err, { mode: "tiles" });
    setExportStatus(msg, "error");
    alert(msg);
    return;
  }

  logExportStep("start", {
    mode: "tiles",
    paper: paperSelect.value,
    orientation,
    dpi,
    cols,
    rows,
    cropRect: tileRect,
    fileSize: currentFile.size,
    fileName: currentFile.name,
  });

  exportTilesBtn.disabled = true;
  exportTilesBtn.textContent = "正在生成多页 PDF…";
  try {
    const preparedSource = await prepareSourceForExport({
      mode: "tiles",
      rect: tileRect,
      dpi,
      cols,
      rows,
    });
    if (preparedSource.qualityWarning) {
      setExportStatus(`清晰度提示：${preparedSource.qualityWarning}`, "idle");
      console.warn("[export] quality-warning", preparedSource.qualityMetrics);
    }
    const source = await ensureUploadedSource(preparedSource.file);
    setExportStatus("正在生成分页 PDF…", "working");
    const prepared = await prepareTileExport({
      sourceUrl: source.url,
      sourceName: preparedSource.sourceName,
      cols,
      rows,
      dpi,
      orientation,
      paper: paperSelect.value,
      cropX: preparedSource.rect.cropX,
      cropY: preparedSource.rect.cropY,
      cropW: preparedSource.rect.cropW,
      cropH: preparedSource.rect.cropH,
    });
    setExportStatus("正在生成下载链接…", "working");
    const downloadUrl = await requestDownloadUrl(prepared.pathname);
    logExportStep("prepareOk", {
      pathname: prepared.pathname,
      filename: prepared.filename,
      downloadUrl,
      ...preparedSource.qualityMetrics,
    });
    setExportStatus(`分页导出已就绪：${prepared.filename}`, "success");
    navigateExportDownloadTab(pendingTab, "tiles", downloadUrl);
    pendingTab = null;
  } catch (err) {
    const msg = describeError(err);
    pendingTab?.closePendingTab();
    logExportError("tile-export", err, {});
    setExportStatus(`导出失败：${msg}`, "error");
    alert(msg);
  } finally {
    exportTilesBtn.disabled = false;
    exportTilesBtn.textContent = "按分页导出多页 PDF";
  }
});

window.addEventListener("resize", () => {
  if (currentMode === "tile") {
    setTimeout(drawTileGrid, 100);
  } else {
    setTimeout(updateBlurMask, 100);
  }
  scheduleResizeFit();
});

updatePaperLabels();
