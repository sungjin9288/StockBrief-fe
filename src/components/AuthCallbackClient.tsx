"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { getMe, getUserPreferences } from "@/lib/api";
import { logClientError } from "@/lib/client-telemetry";
import type { ClientTelemetryStage } from "@/lib/client-telemetry";
import { completeCognitoCallback, readApiAuthToken } from "@/lib/cognito-auth";
import { importLocalWatchlistOnce } from "@/lib/server-watchlist-store";
import { formatWatchlistSyncMessage } from "@/lib/watchlist-sync-message";
import type { WatchlistSyncMessageInput } from "@/lib/watchlist-sync-message";
import { clearRiskProfileCookie, setRiskProfileCookie } from "@/lib/preference-cookie";
import { readRiskProfile } from "@/lib/risk-profile";

type CallbackStatus = "loading" | "done" | "profile-error" | "sync-error" | "error";

function logAuthCallbackFailure(stage: ClientTelemetryStage, error: unknown): void {
  logClientError("Auth callback flow failed.", error, { stage });
}

export function AuthCallbackClient({
  code,
  state,
}: {
  code: string | null;
  state: string | null;
}) {
  const [status, setStatus] = useState<CallbackStatus>(code && state ? "loading" : "error");
  const [syncSummary, setSyncSummary] = useState<WatchlistSyncMessageInput | null>(null);

  useEffect(() => {
    if (!code || !state) {
      return;
    }

    const authCode = code;
    const authState = state;
    let cancelled = false;
    async function complete() {
      clearRiskProfileCookie();
      try {
        await completeCognitoCallback(authCode, authState);
      } catch (caughtError) {
        logAuthCallbackFailure("callback", caughtError);
        if (!cancelled) setStatus("error");
        return;
      }

      const token = readApiAuthToken();
      if (!token) {
        logAuthCallbackFailure("token", { name: "AuthCallbackTokenMissingError" });
        if (!cancelled) setStatus("profile-error");
        return;
      }

      let me: Awaited<ReturnType<typeof getMe>>;
      try {
        const [profileResponse, preferencesResponse] = await Promise.all([
          getMe(token),
          getUserPreferences(token).catch(() => null),
        ]);
        me = profileResponse;
        if (preferencesResponse) {
          const riskProfile = readRiskProfile(preferencesResponse.preferences.risk_profile);
          if (riskProfile) {
            setRiskProfileCookie(riskProfile);
          }
        }
      } catch (caughtError) {
        logAuthCallbackFailure("profile", caughtError);
        if (!cancelled) setStatus("profile-error");
        return;
      }

      try {
        const result = await importLocalWatchlistOnce(token, me);
        if (cancelled) return;
        setSyncSummary({
          importedCount: result.importedCount,
          skippedExistingCount: result.skippedExistingCount,
          alreadySynced: result.alreadySynced,
        });
        setStatus("done");
      } catch (caughtError) {
        logAuthCallbackFailure("watchlist_import", caughtError);
        if (!cancelled) setStatus("sync-error");
      }
    }

    void complete();
    return () => {
      cancelled = true;
    };
  }, [code, state]);

  return (
    <div className="mx-auto max-w-xl px-5 py-12">
      <section className="border-y border-line bg-white px-4 py-8">
        <h1 className="text-xl font-semibold text-ink">로그인 처리</h1>
        {status === "loading" ? (
          <p className="mt-3 text-sm leading-6 text-muted">Cognito 인증 결과를 확인하는 중입니다.</p>
        ) : null}
        {status === "done" ? (
          <>
            <p className="mt-3 text-sm leading-6 text-muted">
              로그인이 완료되었습니다. {formatWatchlistSyncMessage(syncSummary)}
            </p>
            <Link
              href="/watchlist"
              className="mt-5 inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent focus:outline-none focus:shadow-focus"
            >
              관심종목으로 이동
            </Link>
          </>
        ) : null}
        {status === "profile-error" ? (
          <>
            <p className="mt-3 text-sm leading-6 text-muted">
              로그인은 완료되었지만 계정 정보를 불러오지 못했습니다. 계정 화면에서 로그인 상태를 확인한 뒤 다시
              시도해 주세요.
            </p>
            <Link
              href="/account"
              className="mt-5 inline-flex rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:text-accent focus:outline-none focus:shadow-focus"
            >
              계정으로 이동
            </Link>
          </>
        ) : null}
        {status === "sync-error" ? (
          <>
            <p className="mt-3 text-sm leading-6 text-muted">
              로그인은 완료되었지만 로컬 관심종목을 서버에 병합하지 못했습니다. 계정 화면에서 로그인 상태를 확인한 뒤
              관심종목 화면에서 다시 동기화할 수 있습니다.
            </p>
            <Link
              href="/watchlist"
              className="mt-5 inline-flex rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:text-accent focus:outline-none focus:shadow-focus"
            >
              관심종목으로 이동
            </Link>
          </>
        ) : null}
        {status === "error" ? (
          <>
            <p className="mt-3 text-sm leading-6 text-muted">
              로그인 결과를 처리하지 못했습니다. 계정 화면에서 다시 시도해 주세요.
            </p>
            <Link
              href="/account"
              className="mt-5 inline-flex rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:text-accent focus:outline-none focus:shadow-focus"
            >
              계정으로 이동
            </Link>
          </>
        ) : null}
      </section>
    </div>
  );
}
