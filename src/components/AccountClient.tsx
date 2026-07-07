"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import {
  clearAuthSession,
  isCognitoConfigured,
  readApiAuthToken,
  startCognitoAuth,
  subscribeAuthSession,
} from "@/lib/cognito-auth";
import { storeChatResumeSession } from "@/lib/chat-resume";
import { riskProfileLabel } from "@/lib/format";
import {
  readNotificationDigest,
  readRiskProfile,
  useAccountProfile,
} from "@/lib/hooks/useAccountProfile";
import { useChatSessionHistory } from "@/lib/hooks/useChatSessionHistory";
import type { UserChatMessage, UserChatSession } from "@/types/api";

export function AccountClient() {
  // Auth state starts empty so the first client render matches server HTML;
  // the real sessionStorage value is synced in an effect (see WatchlistToggle).
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const configured = isCognitoConfigured();

  const chatHistory = useChatSessionHistory();
  const profile = useAccountProfile(accessToken, {
    onLoadStart: chatHistory.prepareForAccountReload,
    onLoadSuccess: chatHistory.loadChatSessions,
    onLoadFailure: chatHistory.clearChatSessions,
  });
  const { syncAccessToken } = chatHistory;

  useEffect(() => {
    const sync = () => {
      const nextToken = readApiAuthToken();
      syncAccessToken(nextToken);
      setAccessToken(nextToken);
      setAuthReady(true);
    };

    sync();
    return subscribeAuthSession(sync);
  }, [syncAccessToken]);

  const { me, loadingAccount, savingAccount, message, error } = profile;
  const {
    chatSessions,
    chatSessionsError,
    selectedChatSessionId,
    chatSessionDetail,
    chatSessionDetailLoading,
    chatSessionDetailError,
    loadChatSessionDetail,
  } = chatHistory;
  const showingAccountLoading = Boolean(accessToken) && (loadingAccount || (!me && !error));

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <section className="border-y border-line bg-white px-4 py-6 sm:px-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-ink">계정</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              게스트 기능은 그대로 사용할 수 있고, 로그인하면 관심종목, 선호 설정, 대화 이력을 서버에 저장합니다.
            </p>
          </div>
          {accessToken ? (
            <button
              type="button"
              onClick={clearAuthSession}
              className="self-start rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-muted transition hover:bg-field hover:text-ink focus:outline-none focus:shadow-focus"
            >
              로그아웃
            </button>
          ) : null}
        </div>

        {!configured ? (
          <div className="mt-6 rounded-md border border-line bg-field px-4 py-4 text-sm leading-6 text-muted">
            로그인 환경이 아직 설정되지 않았습니다. 로컬에서는 게스트 관심종목을 계속 사용할 수 있습니다.
          </div>
        ) : null}

        {!authReady ? (
          <div className="mt-6 border-y border-line bg-field px-4 py-6 text-sm text-muted" role="status">
            로그인 상태를 확인하는 중입니다.
          </div>
        ) : !accessToken ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!configured}
              onClick={() => void startCognitoAuth("login")}
              className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent focus:outline-none focus:shadow-focus disabled:cursor-not-allowed disabled:opacity-60"
            >
              이메일 로그인
            </button>
            <button
              type="button"
              disabled={!configured}
              onClick={() => void startCognitoAuth("signup")}
              className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:text-accent focus:outline-none focus:shadow-focus disabled:cursor-not-allowed disabled:opacity-60"
            >
              이메일 회원가입
            </button>
          </div>
        ) : showingAccountLoading ? (
          <div className="mt-6 border-y border-line bg-field px-4 py-6 text-sm text-muted" role="status">
            계정 정보를 확인하는 중입니다.
          </div>
        ) : me ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
            <div className="space-y-4">
              <div>
                <div className="text-xs font-medium text-muted">이메일</div>
                <div className="mt-1 text-sm font-semibold text-ink">{me?.email ?? "표시할 이메일 없음"}</div>
                <div className="mt-1 text-xs text-muted">
                  {me?.email_verified ? "이메일 인증 완료" : "이메일 인증이 필요합니다"}
                </div>
              </div>

              <label className="block">
                <span className="text-xs font-medium text-muted">닉네임</span>
                <input
                  value={profile.nickname}
                  onChange={(event) => profile.setNickname(event.target.value)}
                  className="mt-1 w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink outline-none transition focus:bg-white focus:shadow-focus"
                  maxLength={80}
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-muted">리스크 성향</span>
                <select
                  value={profile.riskProfile}
                  onChange={(event) => profile.setRiskProfile(readRiskProfile(event.target.value))}
                  className="mt-1 w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink outline-none transition focus:bg-white focus:shadow-focus"
                >
                  <option value="conservative">{riskProfileLabel("conservative")}</option>
                  <option value="balanced">{riskProfileLabel("balanced")}</option>
                  <option value="aggressive">{riskProfileLabel("aggressive")}</option>
                </select>
              </label>

              <div className="border-y border-line py-4">
                <h2 className="text-sm font-semibold text-ink">알림 설정</h2>
                <label className="mt-3 flex items-start gap-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={profile.notificationEmailEnabled}
                    onChange={(event) => profile.setNotificationEmailEnabled(event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-line text-accent focus:ring-accent"
                  />
                  <span>
                    <span className="block font-medium">이메일 알림 받기</span>
                    <span className="mt-1 block text-xs leading-5 text-muted">
                      관심종목과 대화 이력 기준의 요약 알림을 받습니다.
                    </span>
                  </span>
                </label>

                <label className="mt-4 block">
                  <span className="text-xs font-medium text-muted">관심종목 요약</span>
                  <select
                    value={profile.notificationDigest}
                    onChange={(event) =>
                      profile.setNotificationDigest(readNotificationDigest(event.target.value))
                    }
                    className="mt-1 w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink outline-none transition focus:bg-white focus:shadow-focus"
                  >
                    <option value="off">받지 않음</option>
                    <option value="daily">매일</option>
                    <option value="weekly">매주</option>
                  </select>
                </label>
              </div>

              <button
                type="button"
                onClick={() => void profile.saveProfile()}
                disabled={savingAccount}
                className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent focus:outline-none focus:shadow-focus disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingAccount ? "저장 중" : "저장"}
              </button>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-ink">최근 대화 이력</h2>
              {chatSessionsError ? (
                <p className="mt-3 text-sm text-caution">{chatSessionsError}</p>
              ) : chatSessions.length === 0 ? (
                <p className="mt-3 text-sm text-muted">저장된 대화 세션이 없습니다.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line border-y border-line">
                  {chatSessions.slice(0, 5).map((session) => {
                    const isSelected = selectedChatSessionId === session.session_id;
                    return (
                      <li key={session.session_id}>
                        <button
                          type="button"
                          aria-current={isSelected ? "true" : undefined}
                          onClick={() => void loadChatSessionDetail(session.session_id)}
                          className={`block w-full border-l-2 py-3 pl-3 pr-2 text-left text-sm transition focus:outline-none focus:shadow-focus ${
                            isSelected
                              ? "border-accent bg-field text-ink"
                              : "border-transparent text-ink hover:bg-field"
                          }`}
                        >
                          <span className="block font-semibold">{session.title ?? session.session_id}</span>
                          <span className="mt-1 block text-xs text-muted">{session.ticker ?? "종목 미지정"}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-5 border-y border-line py-4">
                <h3 className="text-sm font-semibold text-ink">대화 내용</h3>
                {chatSessionDetailLoading ? (
                  <p className="mt-3 text-sm text-muted" role="status">
                    대화 내용을 불러오는 중입니다.
                  </p>
                ) : chatSessionDetailError ? (
                  <p className="mt-3 text-sm text-caution">{chatSessionDetailError}</p>
                ) : chatSessionDetail ? (
                  <div className="mt-3 space-y-3">
                    <div className="text-xs text-muted">
                      {chatSessionDetail.session.ticker ?? "종목 미지정"} ·{" "}
                      {chatSessionDetail.session.updated_at}
                    </div>
                    <ol className="space-y-3">
                      {chatSessionDetail.messages.map((item) => (
                        <ChatMessageItem key={item.message_id} message={item} />
                      ))}
                    </ol>
                    {chatSessionDetail.session.ticker ? (
                      <Link
                        href={chatResumeHref(chatSessionDetail.session)}
                        onClick={() =>
                          storeChatResumeSession({
                            ticker: chatSessionDetail.session.ticker ?? "",
                            sessionId: chatSessionDetail.session.session_id,
                          })
                        }
                        className="inline-flex rounded-md border border-line bg-white px-3 py-2 text-xs font-semibold text-ink transition hover:border-accent hover:text-accent focus:outline-none focus:shadow-focus"
                      >
                        이 대화 이어가기
                      </Link>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted">대화 세션을 선택하면 내용을 확인할 수 있습니다.</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-6 border-y border-line bg-field px-4 py-6 text-sm text-muted">
            계정 정보를 표시할 수 없습니다. 다시 로그인해 주세요.
          </div>
        )}

        {message ? <p className="mt-4 text-sm font-medium text-accent">{message}</p> : null}
        {error ? <p className="mt-4 text-sm font-medium text-caution">{error}</p> : null}
      </section>
    </div>
  );
}

function ChatMessageItem({ message }: { message: UserChatMessage }) {
  return (
    <li className="text-sm">
      <div className="text-xs font-medium text-muted">{chatMessageRoleLabel(message.role)}</div>
      <p className="mt-1 whitespace-pre-wrap leading-6 text-ink">{message.content}</p>
      {message.citations.length > 0 ? (
        <div className="mt-2 text-xs text-muted">근거 {message.citations.length}개</div>
      ) : null}
    </li>
  );
}

function chatMessageRoleLabel(role: string) {
  if (role === "user") return "사용자";
  if (role === "assistant") return "AI 설명";
  return "시스템";
}

function chatResumeHref(session: UserChatSession) {
  const params = new URLSearchParams({
    ticker: session.ticker ?? "",
  });
  return `/chat?${params.toString()}`;
}
