"use client";

import { getServerWatchlist, importServerWatchlist } from "@/lib/api";
import { readApiAuthToken, subscribeAuthSession } from "@/lib/cognito-auth";
import { readWatchlist } from "@/lib/watchlist-storage";
import type { MeResponse, ServerWatchlistItem, ServerWatchlistResponse } from "@/types/api";
import type { WatchlistInput, WatchlistItem } from "@/types/watchlist";

let cachedToken: string | null = null;
let cachedResponse: ServerWatchlistResponse | null = null;
let pendingToken: string | null = null;
let pendingRequest: Promise<ServerWatchlistResponse> | null = null;
// Monotonic write version: every cache write (set/update/clear) bumps it so an
// in-flight refresh can detect that a newer write landed and must not be overwritten.
let snapshotWriteVersion = 0;
let authSyncUnsubscribe: (() => void) | null = null;
let authSyncToken: string | null = null;

const listeners = new Set<() => void>();

export const WATCHLIST_SYNC_STATE_KEY = "stockbrief_watchlist_v1_sync_state";

export interface WatchlistSyncResult {
  importedCount: number;
  skippedExistingCount: number;
  items: ServerWatchlistItem[];
  alreadySynced: boolean;
}

interface SyncState {
  [cognitoSub: string]: {
    syncedAt: string;
    localWatchlistFingerprint?: string;
  };
}

export function readServerWatchlistSnapshot(
  accessToken: string | null,
): ServerWatchlistResponse | null {
  if (!accessToken || cachedToken !== accessToken) {
    return null;
  }
  return cachedResponse;
}

export function getServerWatchlistSnapshot(
  accessToken: string,
): Promise<ServerWatchlistResponse> {
  if (cachedToken === accessToken && cachedResponse) {
    return Promise.resolve(cachedResponse);
  }
  if (pendingToken === accessToken && pendingRequest) {
    return pendingRequest;
  }
  return startServerWatchlistFetch(accessToken);
}

export function setServerWatchlistSnapshot(
  accessToken: string,
  response: ServerWatchlistResponse,
): void {
  snapshotWriteVersion += 1;
  cachedToken = accessToken;
  cachedResponse = response;
  emit();
}

export function updateServerWatchlistSnapshot(
  accessToken: string,
  update: (response: ServerWatchlistResponse) => ServerWatchlistResponse,
): void {
  if (cachedToken !== accessToken || !cachedResponse) {
    return;
  }
  setServerWatchlistSnapshot(accessToken, update(cachedResponse));
}

export function clearServerWatchlistSnapshot(): void {
  snapshotWriteVersion += 1;
  cachedToken = null;
  cachedResponse = null;
  pendingToken = null;
  pendingRequest = null;
  emit();
}

export async function refreshServerWatchlistSnapshot(
  accessToken: string,
): Promise<ServerWatchlistResponse> {
  if (pendingToken === accessToken && pendingRequest) {
    return pendingRequest;
  }
  return startServerWatchlistFetch(accessToken);
}

function startServerWatchlistFetch(accessToken: string): Promise<ServerWatchlistResponse> {
  const versionAtStart = snapshotWriteVersion;
  pendingToken = accessToken;
  pendingRequest = getServerWatchlist(accessToken)
    .then((response) => {
      // Apply only when no newer write (optimistic update, clear, other fetch)
      // happened while this request was in flight.
      if (snapshotWriteVersion === versionAtStart) {
        setServerWatchlistSnapshot(accessToken, response);
      }
      return response;
    })
    .finally(() => {
      pendingToken = null;
      pendingRequest = null;
    });
  return pendingRequest;
}

/**
 * Subscribes the cache to auth session changes so a login/logout/token rotation
 * clears cached data from the previous session. Idempotent; call it from any
 * consumer that reads the cache.
 */
export function ensureWatchlistCacheAuthSync(): void {
  if (authSyncUnsubscribe || typeof window === "undefined") {
    return;
  }
  authSyncToken = readApiAuthToken();
  authSyncUnsubscribe = subscribeAuthSession(() => {
    const nextToken = readApiAuthToken();
    if (nextToken === authSyncToken) {
      return;
    }
    authSyncToken = nextToken;
    clearServerWatchlistSnapshot();
  });
}

export function stopWatchlistCacheAuthSync(): void {
  authSyncUnsubscribe?.();
  authSyncUnsubscribe = null;
  authSyncToken = null;
}

export function isTickerInServerWatchlist(ticker: string): boolean {
  return cachedResponse?.items.some((item) => item.ticker === ticker) ?? false;
}

export async function importLocalWatchlistOnce(
  accessToken: string,
  me: MeResponse,
): Promise<WatchlistSyncResult> {
  const server = await getServerWatchlistSnapshot(accessToken);
  const localWatchlist = readWatchlist();
  const localFingerprint = watchlistFingerprint(localWatchlist);
  if (hasSynced(me.cognito_sub, localFingerprint)) {
    return {
      importedCount: 0,
      skippedExistingCount: 0,
      items: server.items,
      alreadySynced: true,
    };
  }

  const serverTickers = new Set(server.items.map((item) => item.ticker));
  const localItems: WatchlistInput[] = localWatchlist
    .filter((item) => !serverTickers.has(item.ticker))
    .map((item) => ({
      ticker: item.ticker,
      name: item.name,
      market: item.market,
      ...(item.sector ? { sector: item.sector } : {}),
      ...(item.memo ? { memo: item.memo } : {}),
    }));

  const imported =
    localItems.length > 0
      ? await importServerWatchlist(accessToken, localItems)
      : {
          imported_count: 0,
          skipped_existing_count: 0,
          items: server.items,
        };

  markSynced(me.cognito_sub, localFingerprint);
  setServerWatchlistSnapshot(accessToken, {
    items: imported.items,
    count: imported.items.length,
  });
  return {
    importedCount: imported.imported_count,
    skippedExistingCount: imported.skipped_existing_count,
    items: imported.items,
    alreadySynced: false,
  };
}

export function subscribeServerWatchlistSnapshot(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function markSynced(cognitoSub: string, localWatchlistFingerprint: string): void {
  if (typeof window === "undefined") return;
  const state = readState();
  state[cognitoSub] = {
    syncedAt: new Date().toISOString(),
    localWatchlistFingerprint,
  };
  window.localStorage.setItem(WATCHLIST_SYNC_STATE_KEY, JSON.stringify(state));
}

function hasSynced(cognitoSub: string, localWatchlistFingerprint: string): boolean {
  if (!cognitoSub) return false;
  return readState()[cognitoSub]?.localWatchlistFingerprint === localWatchlistFingerprint;
}

function watchlistFingerprint(items: WatchlistItem[]): string {
  const normalized = items
    .map((item) => ({
      ticker: item.ticker,
      name: item.name,
      market: item.market,
      savedAt: item.savedAt,
      sector: item.sector ?? null,
      memo: item.memo ?? null,
    }))
    .sort((left, right) => left.ticker.localeCompare(right.ticker));
  return JSON.stringify(normalized);
}

function readState(): SyncState {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(WATCHLIST_SYNC_STATE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as SyncState;
  } catch {
    return {};
  }
}
