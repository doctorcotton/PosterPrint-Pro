import { issueSignedToken, presignUrl } from "@vercel/blob";
import { readJsonBody, writeJsonResponse } from "./_lib/http_adapter.js";

const DOWNLOAD_URL_TTL_MS = 5 * 60 * 1000;

function normalizePathname(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("缺少 pathname");
  }

  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  }
  return trimmed.replace(/^\/+/, "");
}

/**
 * 把私有 Blob 的内部 pathname 换成短期可下载链接。
 */
export default async function handler(request, response) {
  if (request.method !== "POST") {
    return writeJsonResponse(response, { error: "Method Not Allowed" }, 405);
  }

  try {
    const body = await readJsonBody(request);
    const pathname = normalizePathname(body?.pathname);
    if (!pathname.startsWith("exports/")) {
      throw new Error("只允许签发导出结果文件");
    }

    const token = await issueSignedToken({
      operations: ["get"],
    });
    const { presignedUrl } = await presignUrl(token, {
      access: "private",
      pathname,
      operation: "get",
      validUntil: Date.now() + DOWNLOAD_URL_TTL_MS,
    });

    console.info(
      JSON.stringify({
        event: "blob_download_url_issued",
        pathname,
      })
    );

    return writeJsonResponse(response, { downloadUrl: presignedUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        event: "blob_download_url_failed",
        error: message,
      })
    );
    return writeJsonResponse(response, { error: message }, 400);
  }
}
