import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { postAuthenticatedChat, postChat } from "@/lib/api";
import { readApiAuthToken, subscribeAuthSession } from "@/lib/cognito-auth";
import type { ChatResponse } from "@/types/api";

import { ChatExplanationPanel } from "./ChatExplanationPanel";

vi.mock("@/lib/api", () => ({
  postAuthenticatedChat: vi.fn(),
  postChat: vi.fn(),
}));

vi.mock("@/lib/cognito-auth", () => ({
  readApiAuthToken: vi.fn(),
  subscribeAuthSession: vi.fn(),
}));

const mockedPostAuthenticatedChat = vi.mocked(postAuthenticatedChat);
const mockedPostChat = vi.mocked(postChat);
const mockedReadApiAuthToken = vi.mocked(readApiAuthToken);
const mockedSubscribeAuthSession = vi.mocked(subscribeAuthSession);

describe("ChatExplanationPanel", () => {
  beforeEach(() => {
    mockedReadApiAuthToken.mockReturnValue(null);
    mockedSubscribeAuthSession.mockReturnValue(() => undefined);
    mockedPostChat.mockResolvedValue(chatResponse());
    mockedPostAuthenticatedChat.mockResolvedValue(chatResponse());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("does not read the auth session during the initial render", () => {
    mockedReadApiAuthToken.mockReturnValue("id-token");

    const markup = renderToStaticMarkup(
      <ChatExplanationPanel ticker="005930" initialSessionId="chat-session-existing" />,
    );

    expect(mockedReadApiAuthToken).not.toHaveBeenCalled();
    expect(markup).not.toContain("이전 대화에 이어서 질문합니다.");
    expect(markup).not.toContain("로그인된 세션에서만 이전 대화를 이어갈 수 있습니다.");
  });

  it("renders a public explanation with evidence and safety disclaimer", async () => {
    render(<ChatExplanationPanel ticker="005930" />);

    fireEvent.click(screen.getByRole("button", { name: "왜 추천됐나요?" }));

    await waitFor(() => {
      expect(mockedPostChat).toHaveBeenCalledWith({
        ticker: "005930",
        message: "왜 추천됐나요?",
        title: "005930 추천 이유 설명",
      });
    });
    expect(await screen.findByText("근거 기반 설명")).not.toBeNull();
    expect(screen.getByText("공개 데이터 기준 설명입니다.")).not.toBeNull();
    expect(screen.getByText("이 정보는 투자 조언이 아니며 원문 확인이 필요합니다.")).not.toBeNull();
    expect(screen.getByText("사용된 근거")).not.toBeNull();
    expect(screen.getByText(/삼성전자 뉴스/)).not.toBeNull();
    expect(screen.getByText(/2026-06-23/)).not.toBeNull();
    expect(screen.getByRole("link", { name: "원문" }).getAttribute("href")).toBe(
      "https://example.com/news",
    );
    expect(screen.queryByText(/^policy:/)).toBeNull();
    expect(screen.queryByText(/^session:/)).toBeNull();
  });

  it("does not request an explanation for a blank question", () => {
    render(<ChatExplanationPanel ticker="005930" />);

    const question = screen.getByLabelText(/질문/);
    const button = screen.getByRole("button", { name: "왜 추천됐나요?" });

    fireEvent.change(question, { target: { value: "   " } });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("질문을 입력하면 설명을 요청할 수 있습니다.")).not.toBeNull();

    fireEvent.click(button);
    expect(mockedPostChat).not.toHaveBeenCalled();
    expect(mockedPostAuthenticatedChat).not.toHaveBeenCalled();
  });

  it("trims the question before sending it to the chat API", async () => {
    render(<ChatExplanationPanel ticker="005930" />);

    fireEvent.change(screen.getByLabelText(/질문/), {
      target: { value: "  근거를 더 자세히 설명해줘  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "왜 추천됐나요?" }));

    await waitFor(() => {
      expect(mockedPostChat).toHaveBeenCalledWith({
        ticker: "005930",
        message: "근거를 더 자세히 설명해줘",
        title: "005930 추천 이유 설명",
      });
    });
  });

  it("does not render citation source links with unsafe URL schemes", async () => {
    mockedPostChat.mockResolvedValue(
      chatResponse({
        citations: [
          {
            evidence_id: "ev_javascript_url",
            type: "news",
            title: "비정상 URL 뉴스",
            source_name: "NEWS",
            source_url: "javascript:alert(1)",
            as_of_date: "2026-06-23",
          },
          {
            evidence_id: "ev_data_url",
            type: "disclosure",
            title: "비정상 URL 공시",
            source_name: "DISCLOSURE",
            source_url: "data:text/html,<script>alert(1)</script>",
            as_of_date: "2026-06-23",
          },
        ],
      }),
    );

    render(<ChatExplanationPanel ticker="005930" />);

    fireEvent.click(screen.getByRole("button", { name: "왜 추천됐나요?" }));

    expect(await screen.findByText("ev_javascript_url")).not.toBeNull();
    expect(screen.getByText("ev_data_url")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "원문" })).toBeNull();
  });

  it("renders legacy markdown answer links as compact text", async () => {
    mockedPostChat.mockResolvedValue(
      chatResponse({
        answer:
          "1. **재무 안정성** [ev_005930_news](https://example.com/news_(naver))\nhttps://example.com/raw",
      }),
    );

    render(<ChatExplanationPanel ticker="005930" />);

    fireEvent.click(screen.getByRole("button", { name: "왜 추천됐나요?" }));

    expect(await screen.findByText(/재무 안정성/)).not.toBeNull();
    const renderedEvidenceText = screen
      .getAllByText(/ev_005930_news/)
      .map((element) => element.textContent)
      .join("\n");
    expect(renderedEvidenceText).not.toContain("https://");
    expect(renderedEvidenceText).not.toContain(")");
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it("uses authenticated chat and keeps the returned session for the next request", async () => {
    mockedReadApiAuthToken.mockReturnValue("id-token");

    render(<ChatExplanationPanel ticker="005930" />);

    fireEvent.click(screen.getByRole("button", { name: "왜 추천됐나요?" }));
    await waitFor(() => {
      expect(mockedPostAuthenticatedChat).toHaveBeenCalledWith("id-token", {
        ticker: "005930",
        message: "왜 추천됐나요?",
        title: "005930 추천 이유 설명",
      });
    });

    fireEvent.change(screen.getByLabelText(/질문/), {
      target: { value: "근거를 더 자세히 설명해줘" },
    });
    fireEvent.click(screen.getByRole("button", { name: "왜 추천됐나요?" }));

    await waitFor(() => {
      expect(mockedPostAuthenticatedChat).toHaveBeenLastCalledWith("id-token", {
        ticker: "005930",
        message: "근거를 더 자세히 설명해줘",
        session_id: "chat-session-1",
        title: "005930 추천 이유 설명",
      });
    });
    expect(mockedPostChat).not.toHaveBeenCalled();
  });

  it("continues an authenticated chat from an initial session", async () => {
    mockedReadApiAuthToken.mockReturnValue("id-token");

    render(<ChatExplanationPanel ticker="005930" initialSessionId="chat-session-existing" />);

    expect(screen.getByText("이전 대화에 이어서 질문합니다.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "왜 추천됐나요?" }));

    await waitFor(() => {
      expect(mockedPostAuthenticatedChat).toHaveBeenCalledWith("id-token", {
        ticker: "005930",
        message: "왜 추천됐나요?",
        session_id: "chat-session-existing",
        title: "005930 추천 이유 설명",
      });
    });
    expect(mockedPostChat).not.toHaveBeenCalled();
  });

  it("does not send an initial session without an auth token", async () => {
    render(<ChatExplanationPanel ticker="005930" initialSessionId="chat-session-existing" />);

    expect(screen.getByText("로그인된 세션에서만 이전 대화를 이어갈 수 있습니다.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "왜 추천됐나요?" }));

    await waitFor(() => {
      expect(mockedPostChat).toHaveBeenCalledWith({
        ticker: "005930",
        message: "왜 추천됐나요?",
        title: "005930 추천 이유 설명",
      });
    });
    expect(mockedPostAuthenticatedChat).not.toHaveBeenCalled();
  });

  it("shows a retryable message and logs safe context when the chat API fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const apiError = Object.assign(new Error("API unavailable"), {
      name: "ApiError",
      status: 503,
    });
    mockedPostChat.mockRejectedValue(apiError);

    render(<ChatExplanationPanel ticker="005930" />);

    fireEvent.change(screen.getByLabelText(/질문/), {
      target: { value: "민감한 질문 전문은 로그에 남기지 않는다" },
    });
    fireEvent.click(screen.getByRole("button", { name: "왜 추천됐나요?" }));

    expect(await screen.findByText("설명을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.")).not.toBeNull();
    expect(consoleError).toHaveBeenCalledWith("Chat explanation request failed.", {
      ticker: "005930",
      authenticated: false,
      hasSession: false,
      error: {
        name: "ApiError",
        status: 503,
      },
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "민감한 질문 전문은 로그에 남기지 않는다",
    );
  });

  it("logs status from non-Error chat API failures without sensitive fields", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedPostChat.mockRejectedValue({
      name: "ApiError",
      status: 502,
      token: "secret-token",
      message: "provider body",
    });

    render(<ChatExplanationPanel ticker="005930" />);

    fireEvent.change(screen.getByLabelText(/질문/), {
      target: { value: "로그에 남기면 안 되는 질문" },
    });
    fireEvent.click(screen.getByRole("button", { name: "왜 추천됐나요?" }));

    expect(await screen.findByText("설명을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.")).not.toBeNull();
    expect(consoleError).toHaveBeenCalledWith("Chat explanation request failed.", {
      ticker: "005930",
      authenticated: false,
      hasSession: false,
      error: {
        name: "ApiError",
        status: 502,
      },
    });
    const serializedLogs = JSON.stringify(consoleError.mock.calls);
    expect(serializedLogs).not.toContain("secret-token");
    expect(serializedLogs).not.toContain("provider body");
    expect(serializedLogs).not.toContain("로그에 남기면 안 되는 질문");
  });
});

function chatResponse(overrides: Partial<ChatResponse> = {}): ChatResponse {
  return {
    session_id: "chat-session-1",
    message_id: null,
    answer: "공개 데이터 기준 설명입니다.",
    citations: [
      {
        evidence_id: "ev_005930_news",
        type: "news",
        title: "삼성전자 뉴스",
        source_name: "NEWS",
        source_url: "https://example.com/news",
        as_of_date: "2026-06-23T09:30:00+09:00",
      },
    ],
    policy_status: "allowed",
    disclaimer: "이 정보는 투자 조언이 아니며 원문 확인이 필요합니다.",
    used_evidence_ids: ["ev_005930_news"],
    ...overrides,
  };
}
