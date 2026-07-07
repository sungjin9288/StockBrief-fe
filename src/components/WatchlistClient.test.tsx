import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMe } from "@/lib/api";
import { readApiAuthToken } from "@/lib/cognito-auth";
import { importLocalWatchlistOnce } from "@/lib/client-watchlist-cache";
import { readWatchlist } from "@/lib/watchlist-storage";

import { WatchlistClient } from "./WatchlistClient";

const emptyServerWatchlist = { items: [], count: 0 };

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api", () => ({
  deleteServerWatchlistItem: vi.fn(),
  getMe: vi.fn(),
  patchServerWatchlistItem: vi.fn(),
}));

vi.mock("@/lib/cognito-auth", () => ({
  readApiAuthToken: vi.fn(),
  subscribeAuthSession: vi.fn(() => () => undefined),
}));

vi.mock("@/lib/client-watchlist-cache", () => ({
  ensureWatchlistCacheAuthSync: vi.fn(),
  importLocalWatchlistOnce: vi.fn(),
  readServerWatchlistSnapshot: vi.fn(() => emptyServerWatchlist),
  refreshServerWatchlistSnapshot: vi.fn(),
  subscribeServerWatchlistSnapshot: vi.fn(() => () => undefined),
  updateServerWatchlistSnapshot: vi.fn(),
}));

vi.mock("@/lib/watchlist-storage", () => ({
  readWatchlist: vi.fn(() => []),
  removeWatchlistItem: vi.fn(() => []),
  subscribeWatchlist: vi.fn(() => () => undefined),
  updateWatchlistMemo: vi.fn(() => []),
}));

const mockedGetMe = vi.mocked(getMe);
const mockedReadApiAuthToken = vi.mocked(readApiAuthToken);
const mockedImportLocalWatchlistOnce = vi.mocked(importLocalWatchlistOnce);
const mockedReadWatchlist = vi.mocked(readWatchlist);

describe("WatchlistClient", () => {
  beforeEach(() => {
    mockedReadApiAuthToken.mockReturnValue("access-token");
    mockedGetMe.mockResolvedValue({
      id: "user-1",
      cognito_sub: "cognito-sub-1",
      email: "user@example.com",
      email_verified: true,
      nickname: null,
    });
    mockedImportLocalWatchlistOnce.mockResolvedValue({
      importedCount: 1,
      skippedExistingCount: 2,
      items: [],
      alreadySynced: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows imported and already-existing counts after server sync", async () => {
    render(<WatchlistClient />);

    expect(
      await screen.findByText("로컬 관심종목 1개를 서버에 병합했고 2개는 이미 저장되어 있습니다."),
    ).not.toBeNull();
  });

  it("shows the already-synced account state without implying a new import", async () => {
    mockedImportLocalWatchlistOnce.mockResolvedValue({
      importedCount: 0,
      skippedExistingCount: 0,
      items: [],
      alreadySynced: true,
    });

    render(<WatchlistClient />);

    expect(await screen.findByText("이미 이 계정으로 관심종목 동기화를 완료했습니다.")).not.toBeNull();
  });

  it("keeps the guest watchlist empty state available without authentication", async () => {
    mockedReadApiAuthToken.mockReturnValue(null);
    mockedReadWatchlist.mockReturnValue([]);

    render(<WatchlistClient />);

    expect(
      await screen.findByText("게스트 상태입니다. 관심종목은 이 브라우저의 localStorage에 저장됩니다."),
    ).not.toBeNull();
    expect(screen.getByText("저장된 관심종목이 없습니다.")).not.toBeNull();
    expect(screen.getByRole("link", { name: "추천 후보 보기" }).getAttribute("href")).toBe(
      "/recommendations",
    );
    expect(mockedGetMe).not.toHaveBeenCalled();
    expect(mockedImportLocalWatchlistOnce).not.toHaveBeenCalled();
  });
});
