import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMe, getUserPreferences } from "@/lib/api";
import { completeCognitoCallback, readApiAuthToken } from "@/lib/cognito-auth";
import { importLocalWatchlistOnce } from "@/lib/client-watchlist-cache";
import type { MeResponse } from "@/types/api";

import { AuthCallbackClient } from "./AuthCallbackClient";

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
  getMe: vi.fn(),
  getUserPreferences: vi.fn(),
}));

vi.mock("@/lib/cognito-auth", () => ({
  completeCognitoCallback: vi.fn(),
  readApiAuthToken: vi.fn(),
}));

vi.mock("@/lib/client-watchlist-cache", () => ({
  importLocalWatchlistOnce: vi.fn(),
}));

const mockedCompleteCognitoCallback = vi.mocked(completeCognitoCallback);
const mockedReadApiAuthToken = vi.mocked(readApiAuthToken);
const mockedGetMe = vi.mocked(getMe);
const mockedGetUserPreferences = vi.mocked(getUserPreferences);
const mockedImportLocalWatchlistOnce = vi.mocked(importLocalWatchlistOnce);

describe("AuthCallbackClient", () => {
  beforeEach(() => {
    mockedCompleteCognitoCallback.mockResolvedValue(undefined);
    mockedReadApiAuthToken.mockReturnValue("id-token");
    mockedGetMe.mockResolvedValue(me());
    mockedGetUserPreferences.mockResolvedValue({
      preferences: { risk_profile: "balanced" },
    } as unknown as Awaited<ReturnType<typeof getUserPreferences>>);
    mockedImportLocalWatchlistOnce.mockResolvedValue({
      importedCount: 2,
      skippedExistingCount: 0,
      items: [],
      alreadySynced: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("completes Cognito callback and imports the local watchlist", async () => {
    render(<AuthCallbackClient code="auth-code" state="auth-state" />);

    await waitFor(() => {
      expect(mockedCompleteCognitoCallback).toHaveBeenCalledWith("auth-code", "auth-state");
    });

    expect(mockedGetMe).toHaveBeenCalledWith("id-token");
    expect(mockedImportLocalWatchlistOnce).toHaveBeenCalledWith("id-token", me());
    expect(await screen.findByText(/로컬 관심종목 2개를 서버에 병합했습니다/)).not.toBeNull();
    expect(screen.getByRole("link", { name: "관심종목으로 이동" }).getAttribute("href")).toBe(
      "/watchlist",
    );
  });

  it("shows imported and already-existing counts after callback sync", async () => {
    mockedImportLocalWatchlistOnce.mockResolvedValue({
      importedCount: 1,
      skippedExistingCount: 2,
      items: [],
      alreadySynced: false,
    });

    render(<AuthCallbackClient code="auth-code" state="auth-state" />);

    expect(
      await screen.findByText(/로컬 관심종목 1개를 서버에 병합했고 2개는 이미 저장되어 있습니다/),
    ).not.toBeNull();
  });

  it("shows skipped-only callback sync without implying a new import", async () => {
    mockedImportLocalWatchlistOnce.mockResolvedValue({
      importedCount: 0,
      skippedExistingCount: 2,
      items: [],
      alreadySynced: false,
    });

    render(<AuthCallbackClient code="auth-code" state="auth-state" />);

    expect(await screen.findByText(/로컬 관심종목은 이미 서버에 저장되어 있습니다/)).not.toBeNull();
  });

  it("shows already-synced callback state without implying a new import", async () => {
    mockedImportLocalWatchlistOnce.mockResolvedValue({
      importedCount: 0,
      skippedExistingCount: 0,
      items: [],
      alreadySynced: true,
    });

    render(<AuthCallbackClient code="auth-code" state="auth-state" />);

    expect(await screen.findByText(/이미 이 계정으로 관심종목 동기화를 완료했습니다/)).not.toBeNull();
  });

  it("keeps the user signed in when only watchlist sync fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const syncError = Object.assign(new Error("sync failed"), {
      name: "ApiError",
      status: 503,
      token: "secret-token",
    });
    mockedImportLocalWatchlistOnce.mockRejectedValue(syncError);

    render(<AuthCallbackClient code="auth-code" state="auth-state" />);

    expect(
      await screen.findByText(/로그인은 완료되었지만 로컬 관심종목을 서버에 병합하지 못했습니다/),
    ).not.toBeNull();
    expect(screen.getByRole("link", { name: "관심종목으로 이동" }).getAttribute("href")).toBe(
      "/watchlist",
    );
    expect(consoleError).toHaveBeenCalledWith("Auth callback flow failed.", {
      stage: "watchlist_import",
      error: {
        name: "ApiError",
        status: 503,
      },
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret-token");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("id-token");
  });

  it("shows a profile error when the account profile cannot be loaded", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const profileError = Object.assign(new Error("profile failed"), {
      name: "ApiError",
      status: 502,
      authorization: "Bearer id-token",
    });
    mockedGetMe.mockRejectedValue(profileError);

    render(<AuthCallbackClient code="auth-code" state="auth-state" />);

    expect(await screen.findByText(/로그인은 완료되었지만 계정 정보를 불러오지 못했습니다/)).not.toBeNull();
    expect(mockedImportLocalWatchlistOnce).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "계정으로 이동" }).getAttribute("href")).toBe(
      "/account",
    );
    expect(consoleError).toHaveBeenCalledWith("Auth callback flow failed.", {
      stage: "profile",
      error: {
        name: "ApiError",
        status: 502,
      },
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("Bearer id-token");
  });

  it("shows a profile error when the callback completes without an API token", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedReadApiAuthToken.mockReturnValue(null);

    render(<AuthCallbackClient code="auth-code" state="auth-state" />);

    expect(await screen.findByText(/로그인은 완료되었지만 계정 정보를 불러오지 못했습니다/)).not.toBeNull();
    expect(mockedGetMe).not.toHaveBeenCalled();
    expect(mockedImportLocalWatchlistOnce).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "계정으로 이동" }).getAttribute("href")).toBe(
      "/account",
    );
    expect(consoleError).toHaveBeenCalledWith("Auth callback flow failed.", {
      stage: "token",
      error: {
        name: "AuthCallbackTokenMissingError",
      },
    });
  });

  it("does not classify a failed Cognito callback as a watchlist sync failure when a stale token exists", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const callbackError = Object.assign(new Error("callback failed"), {
      name: "AuthCallbackError",
      code: "auth-code",
      state: "auth-state",
      token: "stale-id-token",
    });
    mockedCompleteCognitoCallback.mockRejectedValue(callbackError);
    mockedReadApiAuthToken.mockReturnValue("stale-id-token");

    render(<AuthCallbackClient code="auth-code" state="auth-state" />);

    expect(await screen.findByText(/로그인 결과를 처리하지 못했습니다/)).not.toBeNull();
    expect(screen.getByRole("link", { name: "계정으로 이동" }).getAttribute("href")).toBe(
      "/account",
    );
    expect(mockedGetMe).not.toHaveBeenCalled();
    expect(mockedImportLocalWatchlistOnce).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("Auth callback flow failed.", {
      stage: "callback",
      error: {
        name: "AuthCallbackError",
      },
    });
    const serializedLogs = JSON.stringify(consoleError.mock.calls);
    expect(serializedLogs).not.toContain("auth-code");
    expect(serializedLogs).not.toContain("auth-state");
    expect(serializedLogs).not.toContain("stale-id-token");
  });
});

function me(): MeResponse {
  return {
    id: "user-1",
    cognito_sub: "cognito-sub-1",
    email: "user@example.com",
    email_verified: true,
    nickname: null,
  };
}
