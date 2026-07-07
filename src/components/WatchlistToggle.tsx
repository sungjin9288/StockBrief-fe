"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { addServerWatchlistItem, deleteServerWatchlistItem } from "@/lib/api";
import { readApiAuthToken, readAuthSession, subscribeAuthSession } from "@/lib/cognito-auth";
import {
  ensureWatchlistCacheAuthSync,
  getServerWatchlistSnapshot,
  readServerWatchlistSnapshot,
  refreshServerWatchlistSnapshot,
  subscribeServerWatchlistSnapshot,
  updateServerWatchlistSnapshot,
} from "@/lib/client-watchlist-cache";
import {
  isTickerSaved,
  removeWatchlistItem,
  saveWatchlistItem,
  subscribeWatchlist,
} from "@/lib/watchlist-storage";
import type { ServerWatchlistResponse } from "@/types/api";
import type { WatchlistInput } from "@/types/watchlist";

interface FeedbackState {
  authSessionVersion: number;
  message: string;
  ticker: string;
}

interface AuthState {
  accessToken: string | null;
  version: number;
}

export function WatchlistToggle({
  item,
  variant = "default",
}: {
  item: WatchlistInput;
  variant?: "default" | "compact";
}) {
  const [saved, setSaved] = useState(false);
  const [ready, setReady] = useState(false);
  const [authState, setAuthState] = useState<AuthState>({ accessToken: null, version: 0 });
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const accessToken = authState.accessToken;
  const authSessionVersion = authState.version;
  const serverSnapshot = useSyncExternalStore(
    subscribeServerWatchlistSnapshot,
    () => readServerWatchlistSnapshot(accessToken),
    () => null,
  );
  const serverSaved =
    serverSnapshot?.items.some((serverItem) => serverItem.ticker === item.ticker) ?? false;
  const currentSaved = accessToken ? serverSaved : saved;

  useEffect(() => {
    const sync = () => {
      if (!readAuthSession()) {
        setSaved(isTickerSaved(item.ticker));
      }
      setReady(true);
    };

    sync();
    return subscribeWatchlist(sync);
  }, [item.ticker]);

  useEffect(() => {
    ensureWatchlistCacheAuthSync();
    const sync = () => {
      const nextAccessToken = readApiAuthToken();
      setAuthState((current) =>
        current.accessToken === nextAccessToken
          ? current
          : { accessToken: nextAccessToken, version: current.version + 1 },
      );
    };
    sync();
    return subscribeAuthSession(sync);
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    const token = accessToken;
    let cancelled = false;
    async function loadServerState() {
      setReady(false);
      try {
        await getServerWatchlistSnapshot(token);
      } catch {
        if (!cancelled) {
          setFeedback({
            authSessionVersion,
            message: "서버 관심종목 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            ticker: item.ticker,
          });
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void loadServerState();
    return () => {
      cancelled = true;
    };
  }, [accessToken, authSessionVersion, item.ticker]);

  async function toggle() {
    setFeedback(null);

    if (accessToken) {
      setReady(false);

      let baselineSnapshot = serverSnapshot;
      if (!baselineSnapshot) {
        try {
          baselineSnapshot = await refreshServerWatchlistSnapshot(accessToken);
        } catch (error) {
          console.error("서버 관심종목 상태를 불러오지 못했습니다.", error);
          setFeedback({
            authSessionVersion,
            message: "서버 관심종목 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            ticker: item.ticker,
          });
          setReady(true);
          return;
        }
      }

      const wasSaved = baselineSnapshot.items.some(
        (serverItem) => serverItem.ticker === item.ticker,
      );
      applyOptimisticServerWatchlistToggle(accessToken, item, wasSaved);

      try {
        if (wasSaved) {
          await deleteServerWatchlistItem(accessToken, item.ticker);
        } else {
          await addServerWatchlistItem(accessToken, item);
        }
      } catch (error) {
        rollbackServerWatchlistToggle(accessToken, item.ticker, baselineSnapshot);
        console.error("서버 관심종목 상태 갱신에 실패했습니다.", error);
        setFeedback({
          authSessionVersion,
          message: "관심종목 변경을 저장하지 못했습니다. 다시 시도해 주세요.",
          ticker: item.ticker,
        });
      } finally {
        setReady(true);
      }
      return;
    }

    if (currentSaved) {
      removeWatchlistItem(item.ticker);
      return;
    }

    saveWatchlistItem(item);
  }

  const label = currentSaved ? "관심종목 해제" : "관심종목 저장";
  const baseClass =
    "inline-flex items-center justify-center rounded-md border text-sm font-semibold transition focus:outline-none focus:shadow-focus disabled:cursor-not-allowed disabled:opacity-60";
  const sizeClass = variant === "compact" ? "px-3 py-1.5" : "px-4 py-2";
  const toneClass = currentSaved
    ? "border-accent bg-accent text-white hover:bg-ink"
    : "border-line bg-white text-ink hover:border-accent hover:text-accent";
  const visibleFeedback =
    feedback?.authSessionVersion === authSessionVersion && feedback.ticker === item.ticker
      ? feedback.message
      : null;

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        aria-pressed={currentSaved}
        disabled={!ready}
        onClick={() => void toggle()}
        className={`${baseClass} ${sizeClass} ${toneClass}`}
      >
        {ready ? label : "상태 확인"}
      </button>
      {visibleFeedback ? (
        <span role="status" className="max-w-52 text-xs font-medium leading-5 text-caution">
          {visibleFeedback}
        </span>
      ) : null}
    </span>
  );
}

function applyOptimisticServerWatchlistToggle(
  accessToken: string,
  item: WatchlistInput,
  saved: boolean,
): void {
  updateServerWatchlistSnapshot(accessToken, (snapshot) =>
    saved ? removeSnapshotItem(snapshot, item.ticker) : addSnapshotItem(snapshot, item),
  );
}

function addSnapshotItem(
  snapshot: ServerWatchlistResponse,
  item: WatchlistInput,
): ServerWatchlistResponse {
  if (snapshot.items.some((serverItem) => serverItem.ticker === item.ticker)) {
    return snapshot;
  }
  return {
    items: [
      {
        ticker: item.ticker,
        name: item.name,
        market: item.market,
        sector: item.sector ?? null,
        memo: item.memo ?? null,
        saved_at: new Date().toISOString(),
      },
      ...snapshot.items,
    ],
    count: snapshot.items.length + 1,
  };
}

function removeSnapshotItem(
  snapshot: ServerWatchlistResponse,
  ticker: string,
): ServerWatchlistResponse {
  const nextItems = snapshot.items.filter((serverItem) => serverItem.ticker !== ticker);
  if (nextItems.length === snapshot.items.length) {
    return snapshot;
  }
  return {
    items: nextItems,
    count: nextItems.length,
  };
}

function rollbackServerWatchlistToggle(
  accessToken: string,
  ticker: string,
  previousSnapshot: ServerWatchlistResponse,
): void {
  const previousItem = previousSnapshot.items.find((serverItem) => serverItem.ticker === ticker);
  updateServerWatchlistSnapshot(accessToken, (current) => {
    if (previousItem) {
      if (current.items.some((serverItem) => serverItem.ticker === ticker)) {
        const nextItems = current.items.map((serverItem) =>
          serverItem.ticker === ticker ? previousItem : serverItem,
        );
        return {
          items: nextItems,
          count: nextItems.length,
        };
      }
      const nextItems = restoreSnapshotItem(current.items, previousItem, previousSnapshot.items);
      return {
        items: nextItems,
        count: nextItems.length,
      };
    }

    const nextItems = current.items.filter((serverItem) => serverItem.ticker !== ticker);
    return {
      items: nextItems,
      count: nextItems.length,
    };
  });
}

function restoreSnapshotItem(
  currentItems: ServerWatchlistResponse["items"],
  previousItem: ServerWatchlistResponse["items"][number],
  previousItems: ServerWatchlistResponse["items"],
): ServerWatchlistResponse["items"] {
  const previousIndex = previousItems.findIndex((item) => item.ticker === previousItem.ticker);
  if (previousIndex < 0) {
    return [previousItem, ...currentItems];
  }

  for (let index = previousIndex - 1; index >= 0; index -= 1) {
    const anchorIndex = currentItems.findIndex((item) => item.ticker === previousItems[index].ticker);
    if (anchorIndex >= 0) {
      return [
        ...currentItems.slice(0, anchorIndex + 1),
        previousItem,
        ...currentItems.slice(anchorIndex + 1),
      ];
    }
  }

  for (let index = previousIndex + 1; index < previousItems.length; index += 1) {
    const anchorIndex = currentItems.findIndex((item) => item.ticker === previousItems[index].ticker);
    if (anchorIndex >= 0) {
      return [
        ...currentItems.slice(0, anchorIndex),
        previousItem,
        ...currentItems.slice(anchorIndex),
      ];
    }
  }

  const insertionIndex = Math.min(previousIndex, currentItems.length);
  return [
    ...currentItems.slice(0, insertionIndex),
    previousItem,
    ...currentItems.slice(insertionIndex),
  ];
}
