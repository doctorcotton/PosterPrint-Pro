const A4_RATIO_PORTRAIT = 11.69 / 8.27;  // 高 / 宽
const A4_RATIO_LANDSCAPE = 8.27 / 11.69;

const imageInput = document.getElementById("imageInput");
const imageEl = document.getElementById("image");
const stage = document.getElementById("stage");
const cropBox = document.getElementById("cropBox");
const hint = document.getElementById("hint");
const zoomSlider = document.getElementById("zoom");
const zoomLabel = document.getElementById("zoomLabel");
const dpiInput = document.getElementById("dpi");
const orientationSelect = document.getElementById("orientation");
const exportBtn = document.getElementById("exportBtn");
const exportTilesBtn = document.getElementById("exportTilesBtn");
const origSizeSpan = document.getElementById("origSize");
const boxRatioSpan = document.getElementById("boxRatio");
const colsInput = document.getElementById("cols");
const rowsInput = document.getElementById("rows");
const modeToggle = document.getElementById("modeToggle");
const modeToggleRow = document.getElementById("modeToggleRow");
const tileSettings = document.getElementById("tileSettings");
const blurOverlayTop = document.getElementById("blurOverlayTop");
const blurOverlayBottom = document.getElementById("blurOverlayBottom");
const blurOverlayLeft = document.getElementById("blurOverlayLeft");
const blurOverlayRight = document.getElementById("blurOverlayRight");
const tileGrid = document.getElementById("tileGrid");
const tileCropBox = document.getElementById("tileCropBox");

let origWidth = 0;
let origHeight = 0;
let currentFile = null;
let currentMode = "crop"; // "crop" 或 "tile"

let imgScale = 1.0;
let imgOffsetX = 0;
let imgOffsetY = 0;

let boxX = 0;
let boxY = 0;
let boxW = 0;
let boxH = 0;

// 整体截取框（分页模式用）
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

// 整体截取框拖动状态
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

function getA4Ratio() {
  return orientationSelect.value === "portrait"
    ? A4_RATIO_PORTRAIT
    : A4_RATIO_LANDSCAPE;
}

// 非线性缩放映射：滑块值(1-100) -> 实际缩放比例
// 前面慢（1-50对应1%-20%），后面快（50-100对应20%-100%）
function sliderToScale(sliderValue) {
  const normalized = (sliderValue - 1) / 99; // 0-1
  if (normalized < 0.5) {
    // 前半段：1-50 -> 1%-20%，使用平方根函数让前面更慢
    const t = normalized * 2; // 0-1
    return 0.01 + (0.20 - 0.01) * Math.pow(t, 0.5);
  } else {
    // 后半段：50-100 -> 20%-100%，使用平方函数让后面更快
    const t = (normalized - 0.5) * 2; // 0-1
    return 0.20 + (1.0 - 0.20) * Math.pow(t, 2);
  }
}

// 实际缩放比例 -> 滑块值(1-100)
function scaleToSlider(scale) {
  if (scale <= 0.20) {
    // 前半段
    const t = (scale - 0.01) / (0.20 - 0.01);
    const normalized = Math.pow(t, 2) / 2;
    return 1 + normalized * 49;
  } else {
    // 后半段
    const t = (scale - 0.20) / (1.0 - 0.20);
    const normalized = 0.5 + Math.pow(t, 0.5) / 2;
    return 1 + normalized * 99;
  }
}

function updateImageTransform() {
  imageEl.style.transform = `translate(${imgOffsetX}px, ${imgOffsetY}px) scale(${imgScale})`;
}

function fitToWindow() {
  if (!origWidth || !origHeight) return;
  const stageRect = stage.getBoundingClientRect();
  const stageW = stageRect.width;
  const stageH = stageRect.height;

  const scaleX = stageW / origWidth;
  const scaleY = stageH / origHeight;
  imgScale = Math.min(scaleX, scaleY) * 0.95; // 留一点边距

  const sliderValue = Math.max(1, Math.min(100, Math.round(scaleToSlider(imgScale))));
  zoomSlider.value = sliderValue;
  zoomLabel.textContent = `${Math.round(imgScale * 100)}%`;

  const displayW = origWidth * imgScale;
  const displayH = origHeight * imgScale;
  imgOffsetX = (stageW - displayW) / 2;
  imgOffsetY = (stageH - displayH) / 2;
  updateImageTransform();

  if (currentMode === "crop") {
    clampBoxInsideImage();
    updateBlurMask();
  } else if (currentMode === "tile") {
    setTimeout(drawTileGrid, 10);
  }
}

function layoutInitial() {
  // 初始加载时适应窗口大小
  const stageRect = stage.getBoundingClientRect();
  const stageW = stageRect.width;
  const stageH = stageRect.height;

  const scaleX = stageW / origWidth;
  const scaleY = stageH / origHeight;
  imgScale = Math.min(scaleX, scaleY) * 0.95; // 留一点边距

  // 使用非线性映射转换到滑块值
  const sliderValue = Math.max(1, Math.min(100, Math.round(scaleToSlider(imgScale))));
  zoomSlider.value = sliderValue;
  zoomLabel.textContent = `${Math.round(imgScale * 100)}%`;

  const displayW = origWidth * imgScale;
  const displayH = origHeight * imgScale;
  imgOffsetX = (stageW - displayW) / 2;
  imgOffsetY = (stageH - displayH) / 2;
  updateImageTransform();

  const ratio = getA4Ratio();
  boxW = displayW * 0.5;
  boxH = boxW * ratio;
  if (boxH > displayH * 0.8) {
    boxH = displayH * 0.8;
    boxW = boxH / ratio;
  }
  boxX = imgOffsetX + (displayW - boxW) / 2;
  boxY = imgOffsetY + (displayH - boxH) / 2;
  applyBoxStyle();
  
  // 初始化整体截取框（分页模式用）
  tileCropW = displayW * 0.9;
  tileCropH = displayH * 0.9;
  tileCropX = imgOffsetX + (displayW - tileCropW) / 2;
  tileCropY = imgOffsetY + (displayH - tileCropH) / 2;
  applyTileCropBoxStyle();
}

function applyTileCropBoxStyle() {
  tileCropBox.style.left = tileCropX + "px";
  tileCropBox.style.top = tileCropY + "px";
  tileCropBox.style.width = tileCropW + "px";
  tileCropBox.style.height = tileCropH + "px";
  // 分页模式下始终更新网格线
  if (currentMode === "tile") {
    setTimeout(drawTileGrid, 10);
  }
}

function applyBoxStyle() {
  cropBox.style.left = boxX + "px";
  cropBox.style.top = boxY + "px";
  cropBox.style.width = boxW + "px";
  cropBox.style.height = boxH + "px";
  updateBlurMask();
}

function updateBlurMask() {
  if (currentMode !== "crop" || !origWidth || !origHeight) return;
  const stageRect = stage.getBoundingClientRect();
  const boxRect = cropBox.getBoundingClientRect();
  
  // 转换为相对于stage的坐标
  const boxLeft = boxRect.left - stageRect.left;
  const boxTop = boxRect.top - stageRect.top;
  const boxRight = boxRect.right - stageRect.left;
  const boxBottom = boxRect.bottom - stageRect.top;
  const stageWidth = stageRect.width;
  const stageHeight = stageRect.height;
  
  // 顶部覆盖层
  if (boxTop > 0) {
    blurOverlayTop.style.display = "block";
    blurOverlayTop.style.top = "0";
    blurOverlayTop.style.left = "0";
    blurOverlayTop.style.right = "0";
    blurOverlayTop.style.height = Math.max(0, boxTop) + "px";
  } else {
    blurOverlayTop.style.display = "none";
  }
  
  // 底部覆盖层
  if (boxBottom < stageHeight) {
    blurOverlayBottom.style.display = "block";
    blurOverlayBottom.style.bottom = "0";
    blurOverlayBottom.style.left = "0";
    blurOverlayBottom.style.right = "0";
    blurOverlayBottom.style.height = Math.max(0, stageHeight - boxBottom) + "px";
  } else {
    blurOverlayBottom.style.display = "none";
  }
  
  // 左侧覆盖层
  if (boxLeft > 0) {
    blurOverlayLeft.style.display = "block";
    blurOverlayLeft.style.top = Math.max(0, boxTop) + "px";
    blurOverlayLeft.style.left = "0";
    blurOverlayLeft.style.bottom = Math.max(0, stageHeight - boxBottom) + "px";
    blurOverlayLeft.style.width = Math.max(0, boxLeft) + "px";
  } else {
    blurOverlayLeft.style.display = "none";
  }
  
  // 右侧覆盖层
  if (boxRight < stageWidth) {
    blurOverlayRight.style.display = "block";
    blurOverlayRight.style.top = Math.max(0, boxTop) + "px";
    blurOverlayRight.style.right = "0";
    blurOverlayRight.style.bottom = Math.max(0, stageHeight - boxBottom) + "px";
    blurOverlayRight.style.width = Math.max(0, stageWidth - boxRight) + "px";
  } else {
    blurOverlayRight.style.display = "none";
  }
}

function drawTileGrid() {
  // 分页模式下始终显示网格线（不需要确认）
  if (currentMode !== "tile" || !origWidth || !origHeight) {
    tileGrid.innerHTML = "";
    return;
  }
  
  const cols = Math.max(1, parseInt(colsInput.value || "2", 10));
  const rows = Math.max(1, parseInt(rowsInput.value || "2", 10));
  const orientation = orientationSelect.value;
  
  // A4 尺寸（英寸）
  const A4_WIDTH_INCH = 8.27;
  const A4_HEIGHT_INCH = 11.69;
  
  // 根据纸张方向确定每页的宽高
  const pageW = orientation === "portrait" ? A4_WIDTH_INCH : A4_HEIGHT_INCH;
  const pageH = orientation === "portrait" ? A4_HEIGHT_INCH : A4_WIDTH_INCH;
  
  // 计算整体打印区域的宽高比（cols 页宽 × rows 页高）
  const totalRatio = (cols * pageW) / (rows * pageH);
  
  const stageRect = stage.getBoundingClientRect();
  const tileCropRect = tileCropBox.getBoundingClientRect();
  
  // 检查整体截取框是否可见
  if (tileCropRect.width <= 0 || tileCropRect.height <= 0 || !tileCropBox.offsetParent) {
    tileGrid.innerHTML = "";
    return;
  }
  
  // 截取框的屏幕尺寸
  const cropWidth = tileCropRect.width;
  const cropHeight = tileCropRect.height;
  
  // 计算在截取框内保持 A4 比例的实际绘制区域
  const cropRatio = cropWidth / cropHeight;
  let gridWidth, gridHeight, gridOffsetX, gridOffsetY;
  
  if (cropRatio > totalRatio) {
    // 截取框更宽，以高度为准
    gridHeight = cropHeight;
    gridWidth = gridHeight * totalRatio;
    gridOffsetX = (cropWidth - gridWidth) / 2;
    gridOffsetY = 0;
  } else {
    // 截取框更高，以宽度为准
    gridWidth = cropWidth;
    gridHeight = gridWidth / totalRatio;
    gridOffsetX = 0;
    gridOffsetY = (cropHeight - gridHeight) / 2;
  }
  
  // 转换为相对于stage的坐标
  const cropLeftOnStage = tileCropRect.left - stageRect.left;
  const cropTopOnStage = tileCropRect.top - stageRect.top;
  
  // 网格区域的起始位置
  const gridLeft = cropLeftOnStage + gridOffsetX;
  const gridTop = cropTopOnStage + gridOffsetY;
  
  tileGrid.innerHTML = "";
  tileGrid.style.display = "block";
  
  // 绘制垂直网格线（按 A4 比例分布）
  for (let i = 1; i < cols; i++) {
    const x = (gridWidth / cols) * i;
    const line = document.createElement("div");
    line.className = "tile-grid-line vertical";
    line.style.left = `${gridLeft + x}px`;
    line.style.top = `${gridTop}px`;
    line.style.height = `${gridHeight}px`;
    tileGrid.appendChild(line);
  }
  
  // 绘制水平网格线（按 A4 比例分布）
  for (let j = 1; j < rows; j++) {
    const y = (gridHeight / rows) * j;
    const line = document.createElement("div");
    line.className = "tile-grid-line horizontal";
    line.style.left = `${gridLeft}px`;
    line.style.top = `${gridTop + y}px`;
    line.style.width = `${gridWidth}px`;
    tileGrid.appendChild(line);
  }
  
  // 绘制网格区域的边框（显示实际打印区域）
  const borderBox = document.createElement("div");
  borderBox.className = "tile-grid-border";
  borderBox.style.left = `${gridLeft}px`;
  borderBox.style.top = `${gridTop}px`;
  borderBox.style.width = `${gridWidth}px`;
  borderBox.style.height = `${gridHeight}px`;
  tileGrid.appendChild(borderBox);
}

function switchMode(isTile) {
  currentMode = isTile ? "tile" : "crop";
  
  if (isTile) {
    stage.classList.remove("mode-crop");
    stage.classList.add("mode-tile");
    modeToggleRow.classList.remove("active-crop");
    modeToggleRow.classList.add("active-tile");
    tileSettings.style.display = "block";
    exportBtn.style.display = "none";
    exportTilesBtn.style.display = "block";
    exportTilesBtn.disabled = false; // 分页模式下始终可导出
    cropBox.style.display = "none";
    blurOverlayTop.style.display = "none";
    blurOverlayBottom.style.display = "none";
    blurOverlayLeft.style.display = "none";
    blurOverlayRight.style.display = "none";
    if (origWidth && origHeight) {
      tileCropBox.style.display = "block";
      // 切换到分页模式时立即绘制网格线
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
    tileGrid.innerHTML = ""; // 清空网格线
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

function applyZoomFromSlider() {
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

  const imgCenterX = imgOffsetX + origWidth * oldScale / 2;
  const imgCenterY = imgOffsetY + origHeight * oldScale / 2;
  const dx = imgCenterX - stageCenterX;
  const dy = imgCenterY - stageCenterY;

  const newImgCenterX = stageCenterX + dx * (newScale / oldScale);
  const newImgCenterY = stageCenterY + dy * (newScale / oldScale);
  imgOffsetX += (imgCenterX - newImgCenterX);
  imgOffsetY += (imgCenterY - newImgCenterY);
  updateImageTransform();
}

function clampBoxInsideImage() {
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

  const dx = newLeft - boxRect.left;
  const dy = newTop - boxRect.top;
  boxX += dx;
  boxY += dy;
  applyBoxStyle();
}

modeToggle.addEventListener("change", e => {
  switchMode(!e.target.checked); // checked=true 是单页模式，false 是分页模式
});

imageInput.addEventListener("change", e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  currentFile = file;

  const reader = new FileReader();
  reader.onload = ev => {
    imageEl.onload = () => {
      origWidth = imageEl.naturalWidth;
      origHeight = imageEl.naturalHeight;
      origSizeSpan.textContent = `${origWidth} × ${origHeight} px`;
      hint.style.display = "none";
      imageEl.style.display = "block";
      cropBox.style.display = "block";
      blurOverlayTop.style.display = "block";
      blurOverlayBottom.style.display = "block";
      blurOverlayLeft.style.display = "block";
      blurOverlayRight.style.display = "block";
      layoutInitial();
      exportBtn.disabled = false;
      exportTilesBtn.disabled = false;
      switchMode(!modeToggle.checked);
      updateBlurMask();
    };
    imageEl.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

const fitWindowBtn = document.getElementById("fitWindowBtn");
fitWindowBtn.addEventListener("click", () => {
  fitToWindow();
});

zoomSlider.addEventListener("input", () => {
  applyZoomFromSlider();
  clampBoxInsideImage();
  if (currentMode === "tile") {
    setTimeout(drawTileGrid, 10);
  }
});

// 鼠标滚轮 + Command/Alt 调整缩放
stage.addEventListener("wheel", e => {
  if (!origWidth || !origHeight) return;
  // 检查是否按住了 Command (Mac) 或 Alt (Windows/Linux)
  if (e.metaKey || e.altKey) {
    e.preventDefault();
    const oldScale = imgScale;
    const oldSliderValue = scaleToSlider(oldScale);
    
    // 使用滑动条的非线性曲线，但步进更慢（每次移动1个滑块单位）
    const delta = e.deltaY > 0 ? -1 : 1; // 向下缩小，向上放大
    const newSliderValue = Math.max(1, Math.min(100, oldSliderValue + delta));
    const newScale = sliderToScale(newSliderValue);
    imgScale = newScale;
    
    zoomSlider.value = Math.round(newSliderValue);
    zoomLabel.textContent = `${Math.round(newScale * 100)}%`;
    
    // 以鼠标位置为中心缩放
    const stageRect = stage.getBoundingClientRect();
    const mouseX = e.clientX - stageRect.left;
    const mouseY = e.clientY - stageRect.top;
    
    const imgRect = imageEl.getBoundingClientRect();
    const imgX = mouseX - imgOffsetX;
    const imgY = mouseY - imgOffsetY;
    
    const scaleRatio = newScale / oldScale;
    imgOffsetX = mouseX - imgX * scaleRatio;
    imgOffsetY = mouseY - imgY * scaleRatio;
    
    updateImageTransform();
    
    if (currentMode === "crop") {
      clampBoxInsideImage();
      updateBlurMask();
    } else if (currentMode === "tile") {
      setTimeout(drawTileGrid, 10);
    }
  }
}, { passive: false });

orientationSelect.addEventListener("change", () => {
  const r = getA4Ratio();
  boxRatioSpan.textContent = orientationSelect.value === "portrait"
    ? "A4 竖版"
    : "A4 横版";
  
  if (currentMode === "crop") {
    // 单页模式下，更新取景框尺寸
    const stageRect = stage.getBoundingClientRect();
    const displayH = origHeight * imgScale;
    const displayW = origWidth * imgScale;
    boxW = displayW * 0.5;
    boxH = boxW * r;
    if (boxH > displayH * 0.8) {
      boxH = displayH * 0.8;
      boxW = boxH / r;
    }
    boxX = imgOffsetX + (displayW - boxW) / 2;
    boxY = imgOffsetY + (displayH - boxH) / 2;
    applyBoxStyle();
    clampBoxInsideImage();
  } else if (currentMode === "tile") {
    // 分页模式下，重新绘制网格线
    setTimeout(drawTileGrid, 10);
  }
});

[colsInput, rowsInput].forEach(input => {
  input.addEventListener("input", () => {
    if (currentMode === "tile") {
      setTimeout(drawTileGrid, 10);
    }
  });
});


stage.addEventListener("mousedown", e => {
  if (e.target === cropBox || e.target.closest("#cropBox")) return;
  if (e.target === tileCropBox || e.target.closest("#tileCropBox")) return;
  if (!origWidth || !origHeight) return;
  draggingStage = true;
  stage.classList.add("dragging");
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragOrigOffsetX = imgOffsetX;
  dragOrigOffsetY = imgOffsetY;
});

cropBox.addEventListener("mousedown", e => {
  if (e.target.classList.contains("handle")) return;
  draggingBox = true;
  dragBoxStartX = e.clientX;
  dragBoxStartY = e.clientY;
  const rect = cropBox.getBoundingClientRect();
  dragBoxOrigX = rect.left;
  dragBoxOrigY = rect.top;
  e.stopPropagation();
});

const handleBr = cropBox.querySelector(".handle.br");
handleBr.addEventListener("mousedown", e => {
  resizingBox = true;
  resizeStartX = e.clientX;
  resizeStartY = e.clientY;
  const rect = cropBox.getBoundingClientRect();
  resizeOrigW = rect.width;
  resizeOrigH = rect.height;
  e.stopPropagation();
});

// 整体截取框拖动
tileCropBox.addEventListener("mousedown", e => {
  if (e.target.classList.contains("handle")) return;
  draggingTileCrop = true;
  dragTileCropStartX = e.clientX;
  dragTileCropStartY = e.clientY;
  const rect = tileCropBox.getBoundingClientRect();
  dragTileCropOrigX = rect.left;
  dragTileCropOrigY = rect.top;
  e.stopPropagation();
});

// 整体截取框调整大小
const tileCropHandles = tileCropBox.querySelectorAll(".handle");
tileCropHandles.forEach(handle => {
  handle.addEventListener("mousedown", e => {
    resizingTileCrop = true;
    resizeTileCropHandle = handle.className.split(" ")[1]; // tl, tr, bl, br
    resizeTileCropStartX = e.clientX;
    resizeTileCropStartY = e.clientY;
    const rect = tileCropBox.getBoundingClientRect();
    resizeTileCropOrigX = rect.left;
    resizeTileCropOrigY = rect.top;
    resizeTileCropOrigW = rect.width;
    resizeTileCropOrigH = rect.height;
    e.stopPropagation();
  });
});

window.addEventListener("mousemove", e => {
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
    const ratio = getA4Ratio();
    let newW = resizeOrigW + dx;
    newW = Math.max(40, newW);
    let newH = newW * ratio;
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

function computeCropOnOriginal() {
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

exportBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  const rect = computeCropOnOriginal();
  if (!rect) {
    alert("当前取景框不在图片区域内，请稍微移动后重试。");
    return;
  }
  const dpi = parseInt(dpiInput.value || "300", 10) || 300;
  const form = new FormData();
  form.append("image", currentFile);
  form.append("crop_x", rect.cropX);
  form.append("crop_y", rect.cropY);
  form.append("crop_w", rect.cropW);
  form.append("crop_h", rect.cropH);
  form.append("dpi", dpi);

  exportBtn.disabled = true;
  exportBtn.textContent = "正在导出 PDF…";
  try {
    const resp = await fetch("/export", {
      method: "POST",
      body: form
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      alert("导出失败：" + (data.error || resp.statusText));
    } else {
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "view.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    alert("导出出错：" + err);
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = "导出当前视野为 PDF";
  }
});

exportTilesBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  const cols = Math.max(1, parseInt(colsInput.value || "2", 10));
  const rows = Math.max(1, parseInt(rowsInput.value || "2", 10));
  const dpi = parseInt(dpiInput.value || "300", 10) || 300;
  const orientation = orientationSelect.value || "portrait";

  // 计算整体截取区域在原图中的坐标
  const imgRect = imageEl.getBoundingClientRect();
  const tileCropRect = tileCropBox.getBoundingClientRect();
  const scaleX = origWidth / imgRect.width;
  const scaleY = origHeight / imgRect.height;
  const cropX = Math.max(0, (tileCropRect.left - imgRect.left) * scaleX);
  const cropY = Math.max(0, (tileCropRect.top - imgRect.top) * scaleY);
  const cropW = Math.min(origWidth - cropX, tileCropRect.width * scaleX);
  const cropH = Math.min(origHeight - cropY, tileCropRect.height * scaleY);

  const form = new FormData();
  form.append("image", currentFile);
  form.append("cols", cols);
  form.append("rows", rows);
  form.append("dpi", dpi);
  form.append("orientation", orientation);
  form.append("crop_x", cropX);
  form.append("crop_y", cropY);
  form.append("crop_w", cropW);
  form.append("crop_h", cropH);

  exportTilesBtn.disabled = true;
  exportTilesBtn.textContent = "正在生成多页 PDF…";
  try {
    const resp = await fetch("/tile_export", {
      method: "POST",
      body: form
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      alert("分页导出失败：" + (data.error || resp.statusText));
    } else {
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `poster_${cols}x${rows}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    alert("分页导出出错：" + err);
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
});

