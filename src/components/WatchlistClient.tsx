"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { deleteServerWatchlistItem, getMe, patchServerWatchlistItem } from "@/lib/api";
import { readApiAuthToken, subscribeAuthSession } from "@/lib/cognito-auth";
import {
  ensureWatchlistCacheAuthSync,
  importLocalWatchlistOnce,
  readServerWatchlistSnapshot,
  refreshServerWatchlistSnapshot,
  subscribeServerWatchlistSnapshot,
  updateServerWatchlistSnapshot,
} from "@/lib/client-watchlist-cache";
import {
  readWatchlist,
  removeWatchlistItem,
  subscribeWatchlist,
  updateWatchlistMemo,
} from "@/lib/watchlist-storage";
import { formatDate } from "@/lib/format";
import { formatWatchlistSyncMessage } from "@/lib/watchlist-sync-message";
import type { ServerWatchlistItem } from "@/types/api";
import type { WatchlistItem } from "@/types/watchlist";

export function WatchlistClient() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const memoRollbackRef = useRef(new Map<string, string>());
  const serverSnapshot = useSyncExternalStore(
    subscribeServerWatchlistSnapshot,
    () => readServerWatchlistSnapshot(accessToken),
    () => null,
  );

  useEffect(() => {
    const sync = () => {
      setItems(readWatchlist());
      setReady(true);
    };

    sync();
    return subscribeWatchlist(sync);
  }, []);

  useEffect(() => {
    ensureWatchlistCacheAuthSync();
    const sync = () => setAccessToken(readApiAuthToken());
    sync();
    return subscribeAuthSession(sync);
  }, []);

  useEffect(() => {
    if (!accessToken || !ready) {
      return;
    }

    const token = accessToken;
    let cancelled = false;
    async function syncServerWatchlist() {
      setError(null);
      try {
        const me = await getMe(token);
        const imported = await importLocalWatchlistOnce(token, me);
        if (cancelled) return;
        setSyncMessage(formatWatchlistSyncMessage(imported));
      } catch {
        if (!cancelled) {
          setError("서버 관심종목을 불러오지 못했습니다. 게스트 목록은 이 브라우저에 유지됩니다.");
        }
      }
    }

    void syncServerWatchlist();
    return () => {
      cancelled = true;
    };
  }, [accessToken, ready]);

  async function removeTicker(ticker: string) {
    if (accessToken) {
      try {
        await deleteServerWatchlistItem(accessToken, ticker);
        await refreshServerWatchlistSnapshot(accessToken);
      } catch {
        setError("서버 관심종목 삭제에 실패했습니다.");
      }
      return;
    }

    setItems(removeWatchlistItem(ticker));
  }

  function updateMemo(ticker: string, memo: string) {
    if (accessToken) {
      updateServerWatchlistSnapshot(accessToken, (current) =>
        updateSnapshotItem(current, ticker, { memo }),
      );
      return;
    }
    setItems(updateWatchlistMemo(ticker, memo));
  }

  function rememberServerMemo(ticker: string, memo: string) {
    if (!memoRollbackRef.current.has(ticker)) {
      memoRollbackRef.current.set(ticker, memo);
    }
  }

  async function saveServerMemo(ticker: string, memo: string) {
    if (!accessToken) return;
    const previousMemo = memoRollbackRef.current.get(ticker) ?? "";
    try {
      await patchServerWatchlistItem(accessToken, ticker, { memo: memo.trim() || null });
      memoRollbackRef.current.set(ticker, memo);
      await refreshServerWatchlistSnapshot(accessToken);
    } catch {
      updateServerWatchlistSnapshot(accessToken, (current) =>
        updateSnapshotItem(current, ticker, { memo: previousMemo || null }),
      );
      setError("서버 관심종목 메모 저장에 실패했습니다.");
    } finally {
      memoRollbackRef.current.delete(ticker);
    }
  }

  const visibleItems = accessToken ? (serverSnapshot?.items ?? []).map(serverToLocalItem) : items;
  const usingServer = Boolean(accessToken);

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <div className="mb-4 border-y border-line bg-white px-4 py-4 text-sm leading-6 text-muted">
        {usingServer ? (
          <span>로그인 상태입니다. 관심종목은 서버 저장소와 동기화됩니다.</span>
        ) : (
          <span>게스트 상태입니다. 관심종목은 이 브라우저의 localStorage에 저장됩니다.</span>
        )}
        {syncMessage ? <p className="mt-2 font-medium text-accent">{syncMessage}</p> : null}
        {error ? <p className="mt-2 font-medium text-caution">{error}</p> : null}
      </div>
      <div className="border-y border-line bg-white">
        {!ready ? (
          <p className="px-4 py-8 text-sm text-muted">관심종목을 확인하는 중입니다.</p>
        ) : visibleItems.length === 0 ? (
          <div className="px-4 py-10">
            <h2 className="text-lg font-semibold text-ink">저장된 관심종목이 없습니다.</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              추천 후보 카드나 종목 상세에서 관심종목 저장을 누르면 이곳에 표시됩니다.
            </p>
            <Link
              href="/recommendations"
              className="mt-5 inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent focus:outline-none focus:shadow-focus"
            >
              추천 후보 보기
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {visibleItems.map((item) => (
              <li key={item.ticker} className="px-4 py-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted">
                      <span>{item.market}</span>
                      {item.sector ? (
                        <>
                          <span aria-hidden="true">/</span>
                          <span>{item.sector}</span>
                        </>
                      ) : null}
                      <span aria-hidden="true">/</span>
                      <span>{item.ticker}</span>
                    </div>
                    <Link
                      href={`/stocks/${item.ticker}`}
                      className="mt-2 inline-flex text-lg font-semibold text-ink transition hover:text-accent focus:outline-none focus:shadow-focus"
                    >
                      {item.name}
                    </Link>
                    <p className="mt-1 text-xs text-muted">저장일 {formatDate(item.savedAt)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeTicker(item.ticker)}
                    className="self-start rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-muted transition hover:bg-field hover:text-ink focus:outline-none focus:shadow-focus"
                  >
                    삭제
                  </button>
                </div>

                <label className="mt-4 block">
                  <span className="text-xs font-medium text-muted">memo</span>
                  <textarea
                    value={item.memo ?? ""}
                    onFocus={() => rememberServerMemo(item.ticker, item.memo ?? "")}
                    onChange={(event) => updateMemo(item.ticker, event.target.value)}
                    onBlur={(event) => void saveServerMemo(item.ticker, event.target.value)}
                    rows={2}
                    placeholder="검토 메모"
                    className="mt-1 w-full resize-none rounded-md border border-line bg-field px-3 py-2 text-sm text-ink outline-none transition focus:bg-white focus:shadow-focus"
                  />
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function serverToLocalItem(item: ServerWatchlistItem): WatchlistItem {
  return {
    ticker: item.ticker,
    name: item.name,
    market: item.market,
    savedAt: item.saved_at,
    ...(item.sector ? { sector: item.sector } : {}),
    ...(item.memo ? { memo: item.memo } : {}),
  };
}

function updateSnapshotItem(
  snapshot: { items: ServerWatchlistItem[]; count: number },
  ticker: string,
  patch: Partial<ServerWatchlistItem>,
) {
  return {
    ...snapshot,
    items: snapshot.items.map((item) =>
      item.ticker === ticker ? { ...item, ...patch } : item,
    ),
  };
}
