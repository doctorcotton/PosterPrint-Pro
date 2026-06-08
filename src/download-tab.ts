/** 浏览器拦截新页签时给用户的统一提示。 */
export const DOWNLOAD_TAB_BLOCKED_MESSAGE =
  "浏览器拦截了新页签，请允许弹窗后重试。";

const DOWNLOAD_TAB_CLOSED_MESSAGE = "下载页签已关闭，请重新导出。";
const DEFAULT_PENDING_TITLE = "正在生成 PDF";
const DEFAULT_PENDING_MESSAGE =
  "正在生成 PDF，请稍候，下载会在这个页签中自动开始。";

interface PopupDocumentLike {
  title?: string;
  body?: {
    textContent: string;
  } | null;
}

interface PopupLocationLike {
  href?: string;
  replace?: (url: string) => void;
}

interface PopupWindowLike {
  closed?: boolean;
  close?: () => void;
  focus?: () => void;
  opener?: unknown;
  document?: PopupDocumentLike;
  location?: PopupLocationLike;
}

export interface PendingDownloadTab {
  navigateToDownload(downloadUrl: string): void;
  closePendingTab(): void;
}

export interface OpenPendingDownloadTabOptions {
  open?: (
    url?: string,
    target?: string,
    features?: string
  ) => PopupWindowLike | null;
  currentHref?: string;
  title?: string;
  message?: string;
}

/** 给 about:blank 页签写入轻量等待提示，避免用户看到纯空白页。 */
function paintPendingState(
  popup: PopupWindowLike,
  title: string,
  message: string
): void {
  const doc = popup.document;
  if (!doc) return;
  doc.title = title;
  if (doc.body) {
    doc.body.textContent = message;
  }
}

/** 判断页签是否还可用，避免在用户手动关闭后继续跳转。 */
function ensurePopupAvailable(popup: PopupWindowLike): void {
  if (popup.closed) {
    throw new Error(DOWNLOAD_TAB_CLOSED_MESSAGE);
  }
}

/** 主动断开新页签对 opener 的引用，避免下载页反向操作当前编辑页。 */
function detachPopupOpener(popup: PopupWindowLike): void {
  try {
    popup.opener = null;
  } catch {
    // 某些浏览器环境可能不允许写 opener，这里静默跳过即可。
  }
}

/** 把相对下载地址解析成绝对 URL，避免 about:blank 新页签丢失端口/基址。 */
function resolveDownloadUrl(downloadUrl: string, currentHref: string): string {
  return new URL(downloadUrl, currentHref).toString();
}

/** 读取当前页面 URL；非浏览器环境（如 node 单测）退回稳定占位地址。 */
function resolveCurrentHref(explicitHref?: string): string {
  if (explicitHref) {
    return explicitHref;
  }
  if (typeof window !== "undefined" && window.location?.href) {
    return window.location.href;
  }
  return "http://127.0.0.1/";
}

/**
 * 在用户点击导出按钮的同步时机预先打开空白页签，
 * 后续异步生成好下载地址后再让该页签跳转。
 */
export function openPendingDownloadTab(
  options: OpenPendingDownloadTabOptions = {}
): PendingDownloadTab {
  const open =
    options.open ??
    ((url?: string, target?: string, features?: string) =>
      window.open(url, target, features));
  const currentHref = resolveCurrentHref(options.currentHref);
  const popup = open("about:blank", "_blank");
  if (!popup) {
    throw new Error(DOWNLOAD_TAB_BLOCKED_MESSAGE);
  }
  detachPopupOpener(popup);

  paintPendingState(
    popup,
    options.title ?? DEFAULT_PENDING_TITLE,
    options.message ?? DEFAULT_PENDING_MESSAGE
  );
  popup.focus?.();

  return {
    navigateToDownload(downloadUrl: string): void {
      ensurePopupAvailable(popup);
      const absoluteDownloadUrl = resolveDownloadUrl(downloadUrl, currentHref);
      if (typeof popup.location?.replace === "function") {
        popup.location.replace(absoluteDownloadUrl);
        return;
      }
      if (popup.location) {
        popup.location.href = absoluteDownloadUrl;
        return;
      }
      throw new Error("下载页签缺少 location，无法开始下载。");
    },
    closePendingTab(): void {
      if (!popup.closed) {
        popup.close?.();
      }
    },
  };
}
