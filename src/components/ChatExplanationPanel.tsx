"use client";

import { useEffect, useState } from "react";

import { postAuthenticatedChat, postChat } from "@/lib/api";
import { logClientError } from "@/lib/client-telemetry";
import type { ClientLogContext } from "@/lib/client-telemetry";
import { readApiAuthToken, subscribeAuthSession } from "@/lib/cognito-auth";
import { evidenceTypeLabel, formatDate } from "@/lib/format";
import type { ChatResponse } from "@/types/api";

const DEFAULT_MESSAGE = "왜 추천됐나요?";
const MESSAGE_MAX_LENGTH = 1000;
const policyStatusCopy: Record<ChatResponse["policy_status"], string> = {
  allowed: "근거 기반 설명",
  redirected: "안전 안내",
  blocked: "응답 제한",
};
type ChatFailureContext = Required<
  Pick<ClientLogContext, "ticker" | "authenticated" | "hasSession">
>;

function isSafeExternalUrl(value: string | null): value is string {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function logChatFailure(error: unknown, context: ChatFailureContext) {
  logClientError("Chat explanation request failed.", error, context);
}

function readableAnswer(value: string) {
  return value
    .replace(/\[([^\]\n]+)\]\(https?:\/\/[^\s\n]*\)/g, "[$1]")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/<?https?:\/\/\S+>?/g, "")
    .trim();
}

interface ChatExplanationPanelProps {
  ticker: string;
  initialSessionId?: string | null;
}

export function ChatExplanationPanel({ ticker, initialSessionId = null }: ChatExplanationPanelProps) {
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [response, setResponse] = useState<ChatResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Auth state starts empty so the first client render matches server HTML;
  // the real sessionStorage value is synced in an effect (see WatchlistToggle).
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const resumeSessionId = accessToken ? sessionId : null;
  const trimmedMessage = message.trim();
  const canRequestExplanation = trimmedMessage.length > 0 && !loading;

  useEffect(() => {
    const sync = () => {
      setAccessToken(readApiAuthToken());
      setAuthReady(true);
    };

    sync();
    return subscribeAuthSession(sync);
  }, []);

  async function requestExplanation() {
    if (!trimmedMessage) return;
    setLoading(true);
    setError(null);
    try {
      const body = {
        ticker,
        message: trimmedMessage,
        ...(resumeSessionId ? { session_id: resumeSessionId } : {}),
        title: `${ticker} 추천 이유 설명`,
      };
      const next = accessToken
        ? await postAuthenticatedChat(accessToken, body)
        : await postChat(body);
      setResponse(next);
      if (next.session_id) {
        setSessionId(next.session_id);
      }
    } catch (caughtError) {
      logChatFailure(caughtError, {
        ticker,
        authenticated: Boolean(accessToken),
        hasSession: Boolean(resumeSessionId),
      });
      setError("설명을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-6 border-y border-line bg-white px-4 py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-ink">추천 이유 설명</h3>
          <p className="mt-1 text-sm leading-6 text-muted">
            저장된 점수, 추천 이유, 근거, 리스크만 사용해 설명합니다.
          </p>
          {!authReady ? null : resumeSessionId ? (
            <p className="mt-1 text-xs text-muted">이전 대화에 이어서 질문합니다.</p>
          ) : sessionId ? (
            <p className="mt-1 text-xs text-caution">로그인된 세션에서만 이전 대화를 이어갈 수 있습니다.</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={requestExplanation}
          disabled={!canRequestExplanation}
          className="shrink-0 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent focus:outline-none focus:shadow-focus disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "설명 생성 중" : DEFAULT_MESSAGE}
        </button>
      </div>

      <label className="mt-4 block">
        <span className="flex items-center justify-between gap-3 text-xs font-medium text-muted">
          <span>질문</span>
          <span>{message.length}/{MESSAGE_MAX_LENGTH}</span>
        </span>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={MESSAGE_MAX_LENGTH}
          rows={2}
          className="mt-1 w-full resize-none rounded-md border border-line bg-field px-3 py-2 text-sm text-ink outline-none transition focus:bg-white focus:shadow-focus"
        />
      </label>
      {!trimmedMessage ? (
        <p className="mt-2 text-xs text-caution">질문을 입력하면 설명을 요청할 수 있습니다.</p>
      ) : null}

      {error ? <p className="mt-4 text-sm text-caution">{error}</p> : null}

      {response ? (
        <div className="mt-5 space-y-4">
          <div className="inline-flex rounded-md border border-line px-2 py-1 text-xs font-medium text-muted">
            {policyStatusCopy[response.policy_status]}
          </div>
          {/* React escapes rendered text here; keep agent answers as text, not HTML. */}
          <p className="whitespace-pre-line break-words text-sm leading-6 text-ink">
            {readableAnswer(response.answer)}
          </p>
          <p className="text-xs leading-5 text-muted">{response.disclaimer}</p>

          <div>
            <h4 className="text-sm font-semibold text-ink">사용된 근거</h4>
            {response.citations.length === 0 ? (
              <p className="mt-2 text-sm text-muted">표시할 근거가 없습니다.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {response.citations.map((citation) => (
                  <li key={citation.evidence_id} className="text-xs leading-5 text-muted">
                    <span className="font-semibold text-accent">
                      {citation.evidence_id}
                    </span>{" "}
                    {citation.title} / {evidenceTypeLabel(citation.type)} / {citation.source_name} /{" "}
                    {formatDate(citation.as_of_date)}
                    {isSafeExternalUrl(citation.source_url) ? (
                      <>
                        {" "}
                        <a
                          href={citation.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-ink underline underline-offset-2 hover:text-accent"
                        >
                          원문
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
