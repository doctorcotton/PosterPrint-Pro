import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@vercel/blob/client", () => ({
  handleUpload: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  issueSignedToken: vi.fn(),
  presignUrl: vi.fn(),
}));

import { handleUpload } from "@vercel/blob/client";
import { issueSignedToken, presignUrl } from "@vercel/blob";
import uploadHandler from "../api/blob-upload.js";
import downloadUrlHandler from "../api/blob-download-url.js";

function createNodeResponse() {
  return {
    statusCode: 200,
    jsonPayload: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.jsonPayload = payload;
      return this;
    },
  };
}

describe("blob API 边界适配", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blob-upload 能处理 Vercel Node req/res", async () => {
    vi.mocked(handleUpload).mockResolvedValue({
      type: "blob.generate-client-token",
      clientToken: "vercel_blob_client_mock",
    });

    const req = {
      method: "POST",
      body: {
        type: "blob.generate-client-token",
        payload: {
          pathname: "sources/test.png",
          clientPayload: null,
          multipart: false,
        },
      },
      headers: {},
    };
    const res = createNodeResponse();

    await uploadHandler(req, res);

    expect(handleUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        body: req.body,
        request: req,
      })
    );
    expect(res.statusCode).toBe(200);
    expect(res.jsonPayload).toEqual({
      type: "blob.generate-client-token",
      clientToken: "vercel_blob_client_mock",
    });
  });

  it("blob-download-url 能处理 Vercel Node req/res", async () => {
    vi.mocked(issueSignedToken).mockResolvedValue({
      clientSigningToken: "signing-token",
      delegationToken: "delegation-token",
    });
    vi.mocked(presignUrl).mockResolvedValue({
      presignedUrl: "https://example.com/download.pdf",
    });

    const req = {
      method: "POST",
      body: {
        pathname: "exports/test.pdf",
      },
      headers: {},
    };
    const res = createNodeResponse();

    await downloadUrlHandler(req, res);

    expect(issueSignedToken).toHaveBeenCalledWith({
      operations: ["get"],
    });
    expect(presignUrl).toHaveBeenCalledWith(
      {
        clientSigningToken: "signing-token",
        delegationToken: "delegation-token",
      },
      expect.objectContaining({
        access: "private",
        pathname: "exports/test.pdf",
        operation: "get",
      })
    );
    expect(res.statusCode).toBe(200);
    expect(res.jsonPayload).toEqual({
      downloadUrl: "https://example.com/download.pdf",
    });
  });

  it("blob-download-url 会拒绝非导出目录路径", async () => {
    const req = {
      method: "POST",
      body: {
        pathname: "sources/test.png",
      },
      headers: {},
    };
    const res = createNodeResponse();

    await downloadUrlHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonPayload).toEqual({
      error: "只允许签发导出结果文件",
    });
  });
});
