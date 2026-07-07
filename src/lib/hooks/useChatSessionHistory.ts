"use client";

import { useCallback, useRef, useState } from "react";

import { getUserChatSessionDetail, getUserChatSessions } from "@/lib/api";
import type { UserChatSession, UserChatSessionDetailResponse } from "@/types/api";

interface ChatSessionDetailRequest {
  requestId: number;
  sessionId: string | null;
  token: string | null;
}

export interface ChatSessionHistoryState {
  chatSessions: UserChatSession[];
  chatSessionsError: string | null;
  selectedChatSessionId: string | null;
  chatSessionDetail: UserChatSessionDetailResponse | null;
  chatSessionDetailLoading: boolean;
  chatSessionDetailError: string | null;
  loadChatSessionDetail: (sessionId: string, token?: string | null) => Promise<void>;
  loadChatSessions: (token: string, isCancelled?: () => boolean) => Promise<void>;
  prepareForAccountReload: () => void;
  clearChatSessions: () => void;
  syncAccessToken: (token: string | null) => void;
}

/**
 * Chat session list + detail fetch state for the account page.
 * Keeps the request-id/token race guard so a stale detail response
 * (out-of-order finish or auth token rotation) never overwrites newer state.
 * Callers must forward auth token changes via `syncAccessToken`.
 */
export function useChatSessionHistory(): ChatSessionHistoryState {
  const [chatSessions, setChatSessions] = useState<UserChatSession[]>([]);
  const [chatSessionsError, setChatSessionsError] = useState<string | null>(null);
  const [selectedChatSessionId, setSelectedChatSessionId] = useState<string | null>(null);
  const [chatSessionDetail, setChatSessionDetail] =
    useState<UserChatSessionDetailResponse | null>(null);
  const [chatSessionDetailLoading, setChatSessionDetailLoading] = useState(false);
  const [chatSessionDetailError, setChatSessionDetailError] = useState<string | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  const chatSessionDetailRequestRef = useRef<ChatSessionDetailRequest>({
    requestId: 0,
    sessionId: null,
    token: null,
  });

  const resetChatSessionDetail = useCallback(() => {
    setSelectedChatSessionId(null);
    setChatSessionDetail(null);
    setChatSessionDetailError(null);
    setChatSessionDetailLoading(false);
  }, []);

  // A token change invalidates in-flight detail requests and clears stale detail UI.
  const syncAccessToken = useCallback(
    (token: string | null) => {
      if (accessTokenRef.current === token) {
        return;
      }
      accessTokenRef.current = token;
      chatSessionDetailRequestRef.current = {
        requestId: chatSessionDetailRequestRef.current.requestId + 1,
        sessionId: null,
        token,
      };
      resetChatSessionDetail();
    },
    [resetChatSessionDetail],
  );

  const prepareForAccountReload = useCallback(() => {
    setChatSessionsError(null);
    resetChatSessionDetail();
  }, [resetChatSessionDetail]);

  const clearChatSessions = useCallback(() => {
    setChatSessions([]);
    resetChatSessionDetail();
  }, [resetChatSessionDetail]);

  const loadChatSessions = useCallback(
    async (token: string, isCancelled: () => boolean = () => false) => {
      try {
        const sessions = await getUserChatSessions(token);
        if (isCancelled()) return;
        setChatSessions(sessions.items);
      } catch {
        if (!isCancelled()) {
          setChatSessions([]);
          resetChatSessionDetail();
          setChatSessionsError("최근 대화 이력을 불러오지 못했습니다.");
        }
      }
    },
    [resetChatSessionDetail],
  );

  const loadChatSessionDetail = useCallback(
    async (sessionId: string, token: string | null = accessTokenRef.current) => {
      if (!token) return;
      const requestId = chatSessionDetailRequestRef.current.requestId + 1;
      chatSessionDetailRequestRef.current = { requestId, sessionId, token };
      const isCurrentRequest = () => {
        const currentRequest = chatSessionDetailRequestRef.current;
        return (
          currentRequest.requestId === requestId &&
          currentRequest.sessionId === sessionId &&
          currentRequest.token === token &&
          accessTokenRef.current === token
        );
      };

      setSelectedChatSessionId(sessionId);
      setChatSessionDetailLoading(true);
      setChatSessionDetailError(null);
      try {
        const detail = await getUserChatSessionDetail(token, sessionId);
        if (!isCurrentRequest()) return;
        setChatSessionDetail(detail);
      } catch {
        if (!isCurrentRequest()) return;
        setChatSessionDetail(null);
        setChatSessionDetailError("대화 내용을 불러오지 못했습니다.");
      } finally {
        if (isCurrentRequest()) {
          setChatSessionDetailLoading(false);
        }
      }
    },
    [],
  );

  return {
    chatSessions,
    chatSessionsError,
    selectedChatSessionId,
    chatSessionDetail,
    chatSessionDetailLoading,
    chatSessionDetailError,
    loadChatSessionDetail,
    loadChatSessions,
    prepareForAccountReload,
    clearChatSessions,
    syncAccessToken,
  };
}
