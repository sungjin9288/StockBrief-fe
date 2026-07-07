import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addServerWatchlistItem, deleteServerWatchlistItem, getServerWatchlist } from "@/lib/api";
import {
  clearServerWatchlistSnapshot,
  readServerWatchlistSnapshot,
  setServerWatchlistSnapshot,
} from "@/lib/client-watchlist-cache";
import type { ServerWatchlistItem, ServerWatchlistResponse } from "@/types/api";
import type { WatchlistInput } from "@/types/watchlist";

import { WatchlistToggle } from "./WatchlistToggle";

vi.mock("@/lib/api", () => ({
  addServerWatchlistItem: vi.fn(),
  deleteServerWatchlistItem: vi.fn(),
  getServerWatchlist: vi.fn(),
  importServerWatchlist: vi.fn(),
}));

const accessToken = "test-access-token";

const mockedAddServerWatchlistItem = vi.mocked(addServerWatchlistItem);
const mockedDeleteServerWatchlistItem = vi.mocked(deleteServerWatchlistItem);
const mockedGetServerWatchlist = vi.mocked(getServerWatchlist);

describe("WatchlistToggle server optimistic updates", () => {
  beforeEach(() => {
    clearServerWatchlistSnapshot();
    window.sessionStorage.setItem(
      "stockbrief_auth_session_v1",
      JSON.stringify({
        accessToken,
        expiresAt: Date.now() + 60_000,
      }),
    );
    mockedAddServerWatchlistItem.mockResolvedValue(undefined);
    mockedDeleteServerWatchlistItem.mockResolvedValue(undefined);
    mockedGetServerWatchlist.mockResolvedValue(watchlistResponse([]));
  });

  afterEach(() => {
    cleanup();
    clearServerWatchlistSnapshot();
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("optimistically adds a ticker before the add request finishes", async () => {
    setServerWatchlistSnapshot(accessToken, watchlistResponse([]));
    const addRequest = deferred<void>();
    mockedAddServerWatchlistItem.mockReturnValue(addRequest.promise);

    render(<WatchlistToggle item={watchlistInput("AAPL")} />);
    const button = await readyButton("관심종목 저장");

    fireEvent.click(button);

    await waitFor(() => {
      expect(tickers()).toEqual(["AAPL"]);
    });
    expect(readServerWatchlistSnapshot(accessToken)?.count).toBe(1);
    expect(button.getAttribute("aria-pressed")).toBe("true");

    addRequest.resolve();

    await waitFor(() => {
      expect(button.textContent).toBe("관심종목 해제");
    });
  });

  it("shows feedback when the initial server snapshot cannot be loaded", async () => {
    mockedGetServerWatchlist.mockRejectedValue(new Error("snapshot failed"));

    render(<WatchlistToggle item={watchlistInput("AAPL")} />);

    expect((await screen.findByRole("status")).textContent).toBe(
      "서버 관심종목 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
    expect(await readyButton("관심종목 저장")).not.toBeNull();
  });

  it("clears stale feedback when the ticker changes", async () => {
    mockedGetServerWatchlist
      .mockRejectedValueOnce(new Error("snapshot failed"))
      .mockResolvedValue(watchlistResponse([]));

    const { rerender } = render(<WatchlistToggle item={watchlistInput("AAPL")} />);

    expect(await screen.findByRole("status")).not.toBeNull();

    rerender(<WatchlistToggle item={watchlistInput("MSFT")} />);

    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
  });

  it("clears stale feedback when the auth session changes", async () => {
    mockedGetServerWatchlist
      .mockRejectedValueOnce(new Error("snapshot failed"))
      .mockResolvedValue(watchlistResponse([]));

    render(<WatchlistToggle item={watchlistInput("AAPL")} />);

    expect(await screen.findByRole("status")).not.toBeNull();

    window.sessionStorage.setItem(
      "stockbrief_auth_session_v1",
      JSON.stringify({
        accessToken: "rotated-access-token",
        expiresAt: Date.now() + 60_000,
      }),
    );
    window.dispatchEvent(new CustomEvent("stockbrief_auth_changed"));

    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
  });

  it("rolls back only the added ticker when the add request fails", async () => {
    setServerWatchlistSnapshot(accessToken, watchlistResponse([]));
    mockedAddServerWatchlistItem.mockRejectedValue(new Error("add failed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<WatchlistToggle item={watchlistInput("AAPL")} />);
    const button = await readyButton("관심종목 저장");

    fireEvent.click(button);

    await waitFor(() => {
      expect(tickers()).toEqual([]);
    });
    expect(readServerWatchlistSnapshot(accessToken)?.count).toBe(0);
    expect(button.textContent).toBe("관심종목 저장");
    expect((await screen.findByRole("status")).textContent).toBe(
      "관심종목 변경을 저장하지 못했습니다. 다시 시도해 주세요.",
    );
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("optimistically deletes a ticker before the delete request finishes", async () => {
    setServerWatchlistSnapshot(accessToken, watchlistResponse([serverItem("AAPL")]));
    const deleteRequest = deferred<void>();
    mockedDeleteServerWatchlistItem.mockReturnValue(deleteRequest.promise);

    render(<WatchlistToggle item={watchlistInput("AAPL")} />);
    const button = await readyButton("관심종목 해제");

    fireEvent.click(button);

    await waitFor(() => {
      expect(tickers()).toEqual([]);
    });
    expect(readServerWatchlistSnapshot(accessToken)?.count).toBe(0);
    expect(button.getAttribute("aria-pressed")).toBe("false");

    deleteRequest.resolve();

    await waitFor(() => {
      expect(button.textContent).toBe("관심종목 저장");
    });
  });

  it("restores the deleted ticker at its previous index when the delete request fails", async () => {
    setServerWatchlistSnapshot(
      accessToken,
      watchlistResponse([serverItem("AAPL"), serverItem("MSFT"), serverItem("GOOGL")]),
    );
    mockedDeleteServerWatchlistItem.mockRejectedValue(new Error("delete failed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<WatchlistToggle item={watchlistInput("MSFT")} />);
    const button = await readyButton("관심종목 해제");

    fireEvent.click(button);

    await waitFor(() => {
      expect(tickers()).toEqual(["AAPL", "MSFT", "GOOGL"]);
    });
    expect(readServerWatchlistSnapshot(accessToken)?.count).toBe(3);
    expect(button.textContent).toBe("관심종목 해제");
    expect((await screen.findByRole("status")).textContent).toBe(
      "관심종목 변경을 저장하지 못했습니다. 다시 시도해 주세요.",
    );
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("keeps a successful ticker update when a concurrent ticker update fails", async () => {
    setServerWatchlistSnapshot(accessToken, watchlistResponse([serverItem("AAPL")]));
    const deleteRequest = deferred<void>();
    const addRequest = deferred<void>();
    mockedDeleteServerWatchlistItem.mockReturnValue(deleteRequest.promise);
    mockedAddServerWatchlistItem.mockReturnValue(addRequest.promise);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <>
        <WatchlistToggle item={watchlistInput("AAPL")} />
        <WatchlistToggle item={watchlistInput("MSFT")} />
      </>,
    );
    const aaplButton = await readyButton("관심종목 해제");
    const msftButton = await readyButton("관심종목 저장");

    fireEvent.click(aaplButton);
    fireEvent.click(msftButton);

    await waitFor(() => {
      expect(tickers()).toEqual(["MSFT"]);
    });

    addRequest.resolve();
    deleteRequest.reject(new Error("delete failed"));

    await waitFor(() => {
      expect(tickers()).toEqual(["AAPL", "MSFT"]);
    });
    expect(readServerWatchlistSnapshot(accessToken)?.count).toBe(2);
    expect(msftButton.textContent).toBe("관심종목 해제");
    expect(aaplButton.textContent).toBe("관심종목 해제");
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("does not mutate the server when the initial baseline snapshot cannot be loaded", async () => {
    mockedGetServerWatchlist.mockRejectedValue(new Error("snapshot failed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<WatchlistToggle item={watchlistInput("AAPL")} />);
    const button = await readyButton("관심종목 저장");

    fireEvent.click(button);

    await waitFor(() => {
      expect(mockedGetServerWatchlist).toHaveBeenCalled();
    });
    expect(mockedAddServerWatchlistItem).not.toHaveBeenCalled();
    expect(mockedDeleteServerWatchlistItem).not.toHaveBeenCalled();
    expect(readServerWatchlistSnapshot(accessToken)).toBeNull();
    expect(button.textContent).toBe("관심종목 저장");
    expect((await screen.findByRole("status")).textContent).toBe(
      "서버 관심종목 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});

function watchlistInput(ticker: string): WatchlistInput {
  return {
    ticker,
    name: `${ticker} Corp`,
    market: "NASDAQ",
    sector: "Technology",
  };
}

function serverItem(ticker: string): ServerWatchlistItem {
  return {
    ...watchlistInput(ticker),
    sector: "Technology",
    memo: null,
    saved_at: `2026-06-15T00:00:00.000Z-${ticker}`,
  };
}

function watchlistResponse(items: ServerWatchlistItem[]): ServerWatchlistResponse {
  return {
    items,
    count: items.length,
  };
}

function tickers(): string[] {
  return readServerWatchlistSnapshot(accessToken)?.items.map((item) => item.ticker) ?? [];
}

async function readyButton(name: string): Promise<HTMLButtonElement> {
  return (await screen.findByRole("button", { name })) as HTMLButtonElement;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
