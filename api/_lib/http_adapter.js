/**
 * 兼容 Vercel Node Serverless `req/res` 与 Web `Request/Response` 的最小适配层。
 * API 边界只负责解包输入与回包，不承载业务规则。
 */

function hasWebJson(request) {
  return typeof request?.json === "function";
}

function hasNodeJsonResponse(response) {
  return (
    response &&
    typeof response.status === "function" &&
    typeof response.json === "function"
  );
}

async function readNodeStreamBody(request) {
  if (!request || typeof request.on !== "function") {
    throw new Error("当前请求不支持读取 body");
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonText(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("请求体为空");
  }
  return JSON.parse(text);
}

/**
 * 从不同运行时的请求对象中读取 JSON。
 */
export async function readJsonBody(request) {
  if (hasWebJson(request)) {
    return request.json();
  }

  if (request?.body !== undefined && request.body !== null) {
    if (typeof request.body === "string") {
      return parseJsonText(request.body);
    }
    if (Buffer.isBuffer(request.body)) {
      return parseJsonText(request.body.toString("utf8"));
    }
    if (typeof request.body === "object") {
      return request.body;
    }
  }

  return parseJsonText(await readNodeStreamBody(request));
}

/**
 * 统一输出 JSON；在 Node 运行时写入 `res`，在 Web 运行时返回 `Response`。
 */
export function writeJsonResponse(response, payload, status = 200) {
  if (hasNodeJsonResponse(response)) {
    return response.status(status).json(payload);
  }

  return Response.json(payload, { status });
}
