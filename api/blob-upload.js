import { handleUpload } from "@vercel/blob/client";
import { readJsonBody, writeJsonResponse } from "./_lib/http_adapter.js";

const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
];

/**
 * 为浏览器直传 Blob 签发短期上传令牌。
 * 这里只负责平台边界，不承载导出业务。
 */
export default async function handler(request, response) {
  if (request.method !== "POST") {
    return writeJsonResponse(response, { error: "Method Not Allowed" }, 405);
  }

  try {
    const body = await readJsonBody(request);
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: ALLOWED_CONTENT_TYPES,
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({
          pathname,
          scope: "poster-source",
        }),
      }),
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.info(
          JSON.stringify({
            event: "blob_upload_completed",
            pathname: blob.pathname,
            tokenPayload,
          })
        );
      },
    });

    return writeJsonResponse(response, jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        event: "blob_upload_failed",
        error: message,
      })
    );
    return writeJsonResponse(response, { error: message }, 400);
  }
}
