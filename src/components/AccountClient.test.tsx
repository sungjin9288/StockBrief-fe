import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getMe,
  getUserChatSessionDetail,
  getUserChatSessions,
  getUserPreferences,
  patchMe,
  putUserPreferences,
} from "@/lib/api";
import {
  clearAuthSession,
  isCognitoConfigured,
  readApiAuthToken,
  startCognitoAuth,
  subscribeAuthSession,
} from "@/lib/cognito-auth";
import { takeChatResumeSession } from "@/lib/chat-resume";
import type {
  MeResponse,
  UserChatSessionDetailResponse,
  UserChatSessionListResponse,
  UserPreferencesResponse,
} from "@/types/api";

import { AccountClient } from "./AccountClient";

vi.mock("@/lib/api", () => ({
  getMe: vi.fn(),
  getUserChatSessionDetail: vi.fn(),
  getUserChatSessions: vi.fn(),
  getUserPreferences: vi.fn(),
  patchMe: vi.fn(),
  putUserPreferences: vi.fn(),
}));

vi.mock("@/lib/cognito-auth", () => ({
  clearAuthSession: vi.fn(),
  isCognitoConfigured: vi.fn(),
  readApiAuthToken: vi.fn(),
  startCognitoAuth: vi.fn(),
  subscribeAuthSession: vi.fn(),
}));

const mockedGetMe = vi.mocked(getMe);
const mockedGetUserPreferences = vi.mocked(getUserPreferences);
const mockedGetUserChatSessions = vi.mocked(getUserChatSessions);
const mockedGetUserChatSessionDetail = vi.mocked(getUserChatSessionDetail);
const mockedPatchMe = vi.mocked(patchMe);
const mockedPutUserPreferences = vi.mocked(putUserPreferences);
const mockedClearAuthSession = vi.mocked(clearAuthSession);
const mockedIsCognitoConfigured = vi.mocked(isCognitoConfigured);
const mockedReadApiAuthToken = vi.mocked(readApiAuthToken);
const mockedStartCognitoAuth = vi.mocked(startCognitoAuth);
const mockedSubscribeAuthSession = vi.mocked(subscribeAuthSession);
let authSessionCallback: (() => void) | null = null;

describe("AccountClient", () => {
  beforeEach(() => {
    authSessionCallback = null;
    mockedIsCognitoConfigured.mockReturnValue(true);
    mockedReadApiAuthToken.mockReturnValue("id-token");
    mockedSubscribeAuthSession.mockImplementation((callback) => {
      authSessionCallback = callback;
      return () => undefined;
    });
    mockedStartCognitoAuth.mockResolvedValue(undefined);
    mockedGetMe.mockResolvedValue(me());
    mockedGetUserPreferences.mockResolvedValue(preferences("balanced"));
    mockedGetUserChatSessions.mockResolvedValue(chatSessions());
    mockedGetUserChatSessionDetail.mockResolvedValue(chatSessionDetail());
    mockedPatchMe.mockResolvedValue(me({ nickname: "새별" }));
    mockedPutUserPreferences.mockResolvedValue(preferences("aggressive"));
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("renders the logged-out placeholder on the initial render without reading the auth session", () => {
    const markup = renderToStaticMarkup(<AccountClient />);

    expect(mockedReadApiAuthToken).not.toHaveBeenCalled();
    expect(markup).toContain("로그인 상태를 확인하는 중입니다.");
    expect(markup).not.toContain("로그아웃");
  });

  it("keeps account fields hidden while authenticated account data is loading", async () => {
    const profileRequest = deferred<MeResponse>();
    mockedGetMe.mockReturnValue(profileRequest.promise);

    render(<AccountClient />);

    expect(screen.getByRole("status").textContent).toBe("계정 정보를 확인하는 중입니다.");
    expect(screen.queryByText("표시할 이메일 없음")).toBeNull();
    expect(screen.queryByText("계정 정보를 표시할 수 없습니다. 다시 로그인해 주세요.")).toBeNull();

    profileRequest.resolve(me());

    expect(await screen.findByText("user@example.com")).not.toBeNull();
  });

  it("loads profile, preferences, and recent chat sessions for an authenticated user", async () => {
    mockedGetUserPreferences.mockResolvedValue(
      preferences("conservative", {
        notifications: {
          email_enabled: true,
          watchlist_digest: "daily",
        },
      }),
    );

    render(<AccountClient />);

    expect(await screen.findByText("user@example.com")).not.toBeNull();
    expect((screen.getByLabelText("닉네임") as HTMLInputElement).value).toBe("기존닉네임");
    expect((screen.getByLabelText("리스크 성향") as HTMLSelectElement).value).toBe("conservative");
    expect(screen.getByRole("option", { name: "안정형" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "균형형" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "적극형" })).not.toBeNull();
    expect(screen.queryByRole("option", { name: "conservative" })).toBeNull();
    expect(screen.queryByRole("option", { name: "balanced" })).toBeNull();
    expect(screen.queryByRole("option", { name: "aggressive" })).toBeNull();
    expect((screen.getByLabelText(/이메일 알림 받기/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("관심종목 요약") as HTMLSelectElement).value).toBe("daily");
    expect(screen.getByText("삼성전자 설명")).not.toBeNull();
    expect(mockedGetMe).toHaveBeenCalledWith("id-token");
    expect(mockedGetUserPreferences).toHaveBeenCalledWith("id-token");
    expect(mockedGetUserChatSessions).toHaveBeenCalledWith("id-token");
  });

  it("loads a selected recent chat session detail", async () => {
    render(<AccountClient />);

    const sessionButton = await screen.findByRole("button", { name: /삼성전자 설명/ });
    fireEvent.click(sessionButton);

    expect(mockedGetUserChatSessionDetail).toHaveBeenCalledWith("id-token", "chat-1");
    expect(await screen.findByText("왜 검토 후보로 나왔나요?")).not.toBeNull();
    expect(screen.getByText("공개 데이터 기준 설명입니다.")).not.toBeNull();
    expect(screen.getByText("근거 1개")).not.toBeNull();
    const resumeLink = screen.getByRole("link", { name: "이 대화 이어가기" });
    expect(resumeLink.getAttribute("href")).toBe("/chat?ticker=005930");
    resumeLink.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(resumeLink);
    expect(takeChatResumeSession("005930")).toBe("chat-1");
    expect(sessionButton.getAttribute("aria-current")).toBe("true");
  });

  it("keeps only the latest selected chat session detail when requests finish out of order", async () => {
    const firstRequest = deferred<UserChatSessionDetailResponse>();
    const secondRequest = deferred<UserChatSessionDetailResponse>();
    const secondSession = {
      session_id: "chat-2",
      ticker: "005380",
      title: "현대차 설명",
      created_at: "2026-06-24T10:00:00+09:00",
      updated_at: "2026-06-24T10:30:00+09:00",
    };

    mockedGetUserChatSessions.mockResolvedValue({
      count: 2,
      items: [...chatSessions().items, secondSession],
    });
    mockedGetUserChatSessionDetail.mockImplementation((_token, sessionId) => {
      if (sessionId === "chat-1") return firstRequest.promise;
      return secondRequest.promise;
    });

    render(<AccountClient />);

    const firstSessionButton = await screen.findByRole("button", { name: /삼성전자 설명/ });
    const secondSessionButton = await screen.findByRole("button", { name: /현대차 설명/ });
    fireEvent.click(firstSessionButton);
    fireEvent.click(secondSessionButton);

    await act(async () => {
      secondRequest.resolve(
        chatSessionDetail({
          session: secondSession,
          userContent: "현대차는 왜 선택됐나요?",
          assistantContent: "현대차 최신 상세입니다.",
        }),
      );
      await secondRequest.promise;
    });

    expect(await screen.findByText("현대차 최신 상세입니다.")).not.toBeNull();

    await act(async () => {
      firstRequest.resolve(
        chatSessionDetail({
          assistantContent: "삼성전자 늦은 상세입니다.",
        }),
      );
      await firstRequest.promise;
    });

    expect(screen.getByText("현대차 최신 상세입니다.")).not.toBeNull();
    expect(screen.queryByText("삼성전자 늦은 상세입니다.")).toBeNull();
    expect(firstSessionButton.getAttribute("aria-current")).toBeNull();
    expect(secondSessionButton.getAttribute("aria-current")).toBe("true");
    expect(mockedGetUserChatSessionDetail).toHaveBeenNthCalledWith(1, "id-token", "chat-1");
    expect(mockedGetUserChatSessionDetail).toHaveBeenNthCalledWith(2, "id-token", "chat-2");
  });

  it("clears stale chat detail loading when the auth token changes", async () => {
    const detailRequest = deferred<UserChatSessionDetailResponse>();
    mockedGetUserChatSessionDetail.mockReturnValue(detailRequest.promise);

    render(<AccountClient />);

    fireEvent.click(await screen.findByRole("button", { name: /삼성전자 설명/ }));

    expect(await screen.findByText("대화 내용을 불러오는 중입니다.")).not.toBeNull();

    mockedReadApiAuthToken.mockReturnValue("rotated-id-token");
    await act(async () => {
      authSessionCallback?.();
    });

    await waitFor(() => {
      expect(screen.queryByText("대화 내용을 불러오는 중입니다.")).toBeNull();
    });

    await act(async () => {
      detailRequest.resolve(
        chatSessionDetail({
          assistantContent: "이전 token의 늦은 상세입니다.",
        }),
      );
      await detailRequest.promise;
    });

    expect(screen.queryByText("이전 token의 늦은 상세입니다.")).toBeNull();
    expect(mockedGetUserChatSessionDetail).toHaveBeenCalledWith("id-token", "chat-1");
  });

  it("keeps recent chat sessions visible when a selected session detail fails", async () => {
    mockedGetUserChatSessionDetail.mockRejectedValue(new Error("detail failed"));

    render(<AccountClient />);

    fireEvent.click(await screen.findByRole("button", { name: /삼성전자 설명/ }));

    expect(await screen.findByText("대화 내용을 불러오지 못했습니다.")).not.toBeNull();
    expect(screen.getByRole("button", { name: /삼성전자 설명/ })).not.toBeNull();
  });

  it("keeps the account form available when only recent chat sessions fail", async () => {
    mockedGetUserChatSessions.mockRejectedValue(new Error("sessions failed"));

    render(<AccountClient />);

    expect(await screen.findByText("user@example.com")).not.toBeNull();
    expect((screen.getByLabelText("닉네임") as HTMLInputElement).value).toBe("기존닉네임");
    expect(await screen.findByText("최근 대화 이력을 불러오지 못했습니다.")).not.toBeNull();
    expect(screen.queryByText("로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.")).toBeNull();
  });

  it("saves a trimmed nickname and risk profile without duplicate submissions", async () => {
    const saveRequest = deferred<MeResponse>();
    mockedPatchMe.mockReturnValue(saveRequest.promise);
    mockedGetUserPreferences.mockResolvedValue(
      preferences("balanced", {
        markets: ["KOSPI"],
        sectors: ["반도체"],
        notifications: {
          email_enabled: false,
          watchlist_digest: "off",
          quiet_hours: { start: "22:00", end: "08:00" },
        },
      }),
    );

    render(<AccountClient />);

    const nicknameInput = await screen.findByLabelText("닉네임");
    fireEvent.change(nicknameInput, { target: { value: "  새별  " } });
    fireEvent.change(screen.getByLabelText("리스크 성향"), {
      target: { value: "aggressive" },
    });
    fireEvent.click(screen.getByLabelText(/이메일 알림 받기/));
    fireEvent.change(screen.getByLabelText("관심종목 요약"), {
      target: { value: "weekly" },
    });

    const saveButton = screen.getByRole("button", { name: "저장" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(mockedPatchMe).toHaveBeenCalledTimes(1);
    expect(mockedPatchMe).toHaveBeenCalledWith("id-token", { nickname: "새별" });
    expect(saveButton.textContent).toBe("저장 중");
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);

    saveRequest.resolve(me({ nickname: "새별" }));

    await waitFor(() => {
      expect(mockedPutUserPreferences).toHaveBeenCalledWith("id-token", {
        markets: ["KOSPI"],
        sectors: ["반도체"],
        risk_profile: "aggressive",
        notifications: {
          quiet_hours: { start: "22:00", end: "08:00" },
          email_enabled: true,
          watchlist_digest: "weekly",
        },
      });
    });
    expect(await screen.findByText("계정 설정을 저장했습니다.")).not.toBeNull();
  });

  it("shows a partial failure when preferences fail after nickname save succeeds", async () => {
    mockedPatchMe.mockResolvedValue(me({ nickname: "새별" }));
    mockedPutUserPreferences.mockRejectedValue(new Error("preferences failed"));

    render(<AccountClient />);

    const nicknameInput = await screen.findByLabelText("닉네임");
    fireEvent.change(nicknameInput, { target: { value: "새별" } });
    fireEvent.change(screen.getByLabelText("리스크 성향"), {
      target: { value: "aggressive" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("닉네임은 저장됐지만 선호 설정 저장에 실패했습니다.")).not.toBeNull();
    expect(mockedPatchMe).toHaveBeenCalledWith("id-token", { nickname: "새별" });
    expect(mockedPutUserPreferences).toHaveBeenCalledWith("id-token", {
      risk_profile: "aggressive",
      notifications: {
        email_enabled: false,
        watchlist_digest: "off",
      },
    });
    expect(screen.queryByText("계정 설정 저장에 실패했습니다.")).toBeNull();
  });

  it("shows a retry-oriented message when account loading fails", async () => {
    mockedGetMe.mockRejectedValue(new Error("profile failed"));

    render(<AccountClient />);

    expect(await screen.findByText("로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.")).not.toBeNull();
    expect(screen.getByText("계정 정보를 표시할 수 없습니다. 다시 로그인해 주세요.")).not.toBeNull();
    expect(screen.queryByText("표시할 이메일 없음")).toBeNull();
  });

  it("shows disabled auth actions when Cognito is not configured", async () => {
    mockedIsCognitoConfigured.mockReturnValue(false);
    mockedReadApiAuthToken.mockReturnValue(null);

    render(<AccountClient />);

    expect(await screen.findByText(/로그인 환경이 아직 설정되지 않았습니다/)).not.toBeNull();
    expect((screen.getByRole("button", { name: "이메일 로그인" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "이메일 회원가입" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mockedGetMe).not.toHaveBeenCalled();
  });

  it("clears the stored auth session when the user signs out", async () => {
    render(<AccountClient />);

    fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));

    expect(mockedClearAuthSession).toHaveBeenCalledOnce();
  });
});

function me(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: "user-1",
    cognito_sub: "cognito-sub-1",
    email: "user@example.com",
    email_verified: true,
    nickname: "기존닉네임",
    ...overrides,
  };
}

function preferences(
  riskProfile: string,
  overrides: Record<string, unknown> = {},
): UserPreferencesResponse {
  return {
    preferences: {
      ...overrides,
      risk_profile: riskProfile,
    },
  };
}

function chatSessions(): UserChatSessionListResponse {
  return {
    count: 1,
    items: [
      {
        session_id: "chat-1",
        ticker: "005930",
        title: "삼성전자 설명",
        created_at: "2026-06-24T09:00:00+09:00",
        updated_at: "2026-06-24T09:30:00+09:00",
      },
    ],
  };
}

function chatSessionDetail(
  overrides: {
    session?: UserChatSessionDetailResponse["session"];
    userContent?: string;
    assistantContent?: string;
  } = {},
): UserChatSessionDetailResponse {
  return {
    session: overrides.session ?? chatSessions().items[0],
    messages: [
      {
        message_id: "msg-user-1",
        role: "user",
        content: overrides.userContent ?? "왜 검토 후보로 나왔나요?",
        ticker: overrides.session?.ticker ?? "005930",
        citations: [],
        safety_flags: [],
        created_at: "2026-06-24T09:30:00+09:00",
      },
      {
        message_id: "msg-assistant-1",
        role: "assistant",
        content: overrides.assistantContent ?? "공개 데이터 기준 설명입니다.",
        ticker: overrides.session?.ticker ?? "005930",
        citations: [{ evidence_id: "ev-1" }],
        safety_flags: [],
        created_at: "2026-06-24T09:30:01+09:00",
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}
