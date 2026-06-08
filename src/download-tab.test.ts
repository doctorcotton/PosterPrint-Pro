import { describe, expect, it, vi } from "vitest";

interface FakePopup {
  closed: boolean;
  close: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  opener: Record<string, unknown> | null;
  location: {
    href: string;
    replace: ReturnType<typeof vi.fn>;
  };
  document: {
    title: string;
    body: {
      textContent: string;
    };
  };
}

function createFakePopup(): FakePopup {
  const popup: FakePopup = {
    closed: false,
    close: vi.fn(() => {
      popup.closed = true;
    }),
    focus: vi.fn(),
    opener: { alive: true },
    location: {
      href: "about:blank",
      replace: vi.fn((url: string) => {
        popup.location.href = url;
      }),
    },
    document: {
      title: "",
      body: {
        textContent: "",
      },
    },
  };
  return popup;
}

describe("openPendingDownloadTab", () => {
  it("会先打开空白页并主动断开 opener，再跳转到下载地址", async () => {
    const popup = createFakePopup();
    const open = vi.fn(() => popup);
    const { openPendingDownloadTab } = await import("./download-tab");

    const pendingTab = openPendingDownloadTab({ open });

    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(popup.opener).toBeNull();
    expect(popup.document.title).toContain("正在生成 PDF");
    expect(popup.document.body.textContent).toContain("正在生成 PDF，请稍候");

    pendingTab.navigateToDownload("https://example.test/export.pdf");

    expect(popup.location.replace).toHaveBeenCalledWith(
      "https://example.test/export.pdf"
    );
  });

  it("closePendingTab 会关闭已经打开的空白页签", async () => {
    const popup = createFakePopup();
    const open = vi.fn(() => popup);
    const { openPendingDownloadTab } = await import("./download-tab");

    const pendingTab = openPendingDownloadTab({ open });
    pendingTab.closePendingTab();

    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(popup.closed).toBe(true);
  });

  it("新页签被拦截时抛出明确错误", async () => {
    const open = vi.fn(() => null);
    const { openPendingDownloadTab, DOWNLOAD_TAB_BLOCKED_MESSAGE } =
      await import("./download-tab");

    expect(() => openPendingDownloadTab({ open })).toThrow(
      DOWNLOAD_TAB_BLOCKED_MESSAGE
    );
  });

  it("相对下载地址会基于当前页面补成绝对地址，避免 about:blank 误解析端口", async () => {
    const popup = createFakePopup();
    const open = vi.fn(() => popup);
    const { openPendingDownloadTab } = await import("./download-tab");

    const pendingTab = openPendingDownloadTab({
      open,
      currentHref: "http://127.0.0.1:4174/crop.html",
    });

    pendingTab.navigateToDownload("/download/token/file.pdf");

    expect(popup.location.replace).toHaveBeenCalledWith(
      "http://127.0.0.1:4174/download/token/file.pdf"
    );
  });
});
