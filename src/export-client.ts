/**
 * 导出数据层：负责 Blob 上传、调用 serverless 接口、换取下载链接。
 * UI 层只关心「开始导出」与「拿到下载地址」。
 */

import { upload } from "@vercel/blob/client";

export interface UploadedSource {
  pathname: string;
  url: string;
  fingerprint: string;
}

interface BaseExportPayload {
  sourceUrl: string;
  sourceName: string;
  dpi: number;
  paper: string;
  orientation: string;
}

export interface SingleExportPayload extends BaseExportPayload {
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
}

export interface TileExportPayload extends BaseExportPayload {
  cols: number;
  rows: number;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
}

interface PreparedExport {
  filename: string;
  pathname: string;
}

async function parseJsonOrThrow<T>(
  response: Response,
  fallbackMessage: string
): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new Error(
      `${fallbackMessage}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function readErrorMessage(
  response: Response,
  fallbackMessage: string
): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}

export function buildSourceFingerprint(file: File): string {
  return [file.name, file.size, file.lastModified, file.type].join(":");
}

export async function ensureRemoteSource(
  file: File,
  fingerprint: string,
  onProgress?: (percentage: number) => void
): Promise<UploadedSource> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_") || "upload.png";
  const result = await upload(`sources/${safeName}`, file, {
    access: "private",
    handleUploadUrl: "/api/blob-upload",
    contentType: file.type || undefined,
    multipart: file.size > 4 * 1024 * 1024,
    onUploadProgress(progress) {
      onProgress?.(progress.percentage);
    },
  });

  return {
    pathname: result.pathname,
    url: result.url,
    fingerprint,
  };
}

async function requestPreparedExport(
  endpoint: string,
  payload: SingleExportPayload | TileExportPayload
): Promise<PreparedExport> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorMessage = await readErrorMessage(response, "导出准备失败");
    throw new Error(errorMessage);
  }

  return parseJsonOrThrow<PreparedExport>(response, "导出结果解析失败");
}

export async function requestDownloadUrl(pathname: string): Promise<string> {
  const response = await fetch("/api/blob-download-url", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ pathname }),
  });

  if (!response.ok) {
    const errorMessage = await readErrorMessage(response, "下载链接生成失败");
    throw new Error(errorMessage);
  }

  const data = await parseJsonOrThrow<{ downloadUrl?: string }>(
    response,
    "下载链接解析失败"
  );
  if (!data.downloadUrl) {
    throw new Error("服务端未返回下载链接");
  }
  return data.downloadUrl;
}

export async function prepareSingleExport(
  payload: SingleExportPayload
): Promise<PreparedExport> {
  return requestPreparedExport("/api/export_prepare", payload);
}

export async function prepareTileExport(
  payload: TileExportPayload
): Promise<PreparedExport> {
  return requestPreparedExport("/api/tile_export_prepare", payload);
}
