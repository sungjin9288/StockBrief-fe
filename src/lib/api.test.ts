import { afterEach, describe, expect, it, vi } from "vitest";

import { clearAuthSession } from "@/lib/cognito-auth";

import {
  ApiError,
  getMe,
  getRecommendationCandidate,
  getRecommendationCandidates,
  postAuthenticatedChat,
  postChat,
  searchStocks,
} from "./api";

vi.mock("@/lib/cognito-auth", () => ({
  clearAuthSession: vi.fn(),
}));

const mockedClearAuthSession = vi.mocked(clearAuthSession);

describe("candidate API adapters", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads final recommendation candidate fields from the public list endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            {
              ticker: "005930",
              name: "삼성전자",
              market: "KOSPI",
              sector: "반도체",
              recommendation_score: 78.5,
              score_components: [
                {
                  name: "financial_stability",
                  weight: 20,
                  raw_score: 82,
                  weighted_score: 16.4,
                  reason: "재무 안정성 항목은 공개 데이터 기준으로 계산했습니다.",
                  input_refs: ["financials.total_liabilities"],
                  evidence_ids: ["ev_005930_financial"],
                },
              ],
              recommendation_reasons: [
                {
                  reason_id: "rsn_005930_1",
                  component: "financial_stability",
                  summary: "공개 데이터 기준 검토 포인트가 확인됩니다.",
                  evidence_ids: ["ev_005930_financial"],
                  source_document_ids: ["doc_005930_1"],
                },
              ],
              risk_tags: ["data_gap"],
              evidence_level: "strong",
              evidence_count: 4,
              missing_data: [{ field: "price", status: "fallback" }],
              data_freshness: {
                as_of: "2026-06-30",
                price_as_of: null,
                live_evidence_latest_at: "2026-06-30T01:00:00Z",
              },
              disclaimer: "공개 데이터 기반 검토 후보입니다.",
            },
          ],
          count: 1,
          risk_profile: "conservative",
          disclaimer: "공개 데이터 기반 검토 후보입니다.",
        }),
      ),
    );

    const response = await getRecommendationCandidates({
      riskProfile: "conservative",
      market: "KOSPI",
      sector: "반도체",
      limit: 20,
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/v1/recommendations/candidates?risk_profile=conservative&market=KOSPI&sector=%EB%B0%98%EB%8F%84%EC%B2%B4&limit=20",
      expect.objectContaining({
        cache: "no-store",
      }),
    );
    expect(response.items[0].score_components[0]).toMatchObject({
      name: "financial_stability",
      weighted_score: 16.4,
      evidence_ids: ["ev_005930_financial"],
    });
    expect(response.items[0].risk_tags).toEqual(["data_gap"]);
    expect(response.items[0].missing_data).toEqual([{ field: "price", status: "fallback" }]);
    expect(response.items[0].data_freshness.live_evidence_latest_at).toBe(
      "2026-06-30T01:00:00Z",
    );
  });

  it("loads detail data from the canonical recommendation candidate endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          ticker: "005930",
          name: "삼성전자",
          market: "KOSPI",
          sector: "반도체",
          recommendation_score: 78.5,
          score_components: [],
          recommendation_reasons: [],
          risk_tags: [],
          evidence_level: "medium",
          evidence_count: 2,
          missing_data: [],
          data_freshness: { as_of: "2026-06-09" },
          disclaimer: "공개 데이터 기반 검토 후보입니다.",
        }),
      ),
    );

    const candidate = await getRecommendationCandidate("005930");

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/v1/recommendations/candidates/005930",
      expect.any(Object),
    );
    expect(candidate.ticker).toBe("005930");
  });
});

describe("chat API adapters", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to a safety disclaimer when the chat contract omits safety", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          chatContractResponse({
            safety: undefined,
          }),
        ),
      ),
    );

    const response = await postChat({
      ticker: "005930",
      message: "왜 추천됐나요?",
    });

    expect(response.policy_status).toBe("redirected");
    expect(response.disclaimer).toContain("투자 조언");
  });

  it("falls back to a safety disclaimer when the chat contract omits disclaimer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(chatContractResponse())));

    const response = await postChat({
      ticker: "005930",
      message: "왜 추천됐나요?",
    });

    expect(response.policy_status).toBe("allowed");
    expect(response.disclaimer).toContain("투자 조언");
  });

  it("falls back to a safety disclaimer when the chat contract sends a blank disclaimer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          chatContractResponse({
            safety: {
              policy_action: "ALLOW",
              disclaimer: "   ",
            },
          }),
        ),
      ),
    );

    const response = await postChat({
      ticker: "005930",
      message: "왜 추천됐나요?",
    });

    expect(response.policy_status).toBe("allowed");
    expect(response.disclaimer).toContain("투자 조언");
  });

  it("maps non-null citation published_at values to chat citation dates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          chatContractResponse({
            citations: [
              {
                id: "ev_005930_news",
                source_type: "NEWS",
                title: "삼성전자 뉴스",
                url: "https://example.com/news",
                published_at: "2026-06-23T09:30:00+09:00",
              },
            ],
          }),
        ),
      ),
    );

    const response = await postChat({
      ticker: "005930",
      message: "왜 추천됐나요?",
    });

    expect(response.citations).toEqual([
      {
        evidence_id: "ev_005930_news",
        type: "news",
        title: "삼성전자 뉴스",
        source_name: "NEWS",
        source_url: "https://example.com/news",
        as_of_date: "2026-06-23T09:30:00+09:00",
      },
    ]);
    expect(response.used_evidence_ids).toEqual(["ev_005930_news"]);
  });

  it("maps non-null citation published_at values for authenticated chat responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          chatContractResponse({
            citations: [
              {
                id: "ev_005930_disclosure",
                source_type: "DISCLOSURE",
                title: "삼성전자 공시",
                url: "https://example.com/disclosure",
                published_at: "2026-06-22T15:00:00+09:00",
              },
            ],
          }),
        ),
      ),
    );

    const response = await postAuthenticatedChat("id-token", {
      ticker: "005930",
      message: "근거를 설명해줘",
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/v1/chat",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer id-token",
        }),
      }),
    );
    expect(response.citations).toEqual([
      {
        evidence_id: "ev_005930_disclosure",
        type: "disclosure",
        title: "삼성전자 공시",
        source_name: "DISCLOSURE",
        source_url: "https://example.com/disclosure",
        as_of_date: "2026-06-22T15:00:00+09:00",
      },
    ]);
    expect(response.used_evidence_ids).toEqual(["ev_005930_disclosure"]);
  });

  it("preserves authenticated chat message ids for persisted session tracing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          chatContractResponse({
            session_id: "chat-session-1",
            message_id: "msg-assistant-1",
          }),
        ),
      ),
    );

    const response = await postAuthenticatedChat("id-token", {
      ticker: "005930",
      message: "근거를 설명해줘",
    });

    expect(response.session_id).toBe("chat-session-1");
    expect(response.message_id).toBe("msg-assistant-1");
  });
});

describe("401 session handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("clears the auth session and asks the user to log in again when an authorized request gets 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(statusResponse(401)));

    const failure = await getMe("expired-token").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(401);
    expect((failure as ApiError).message).toBe("로그인이 만료되었습니다. 다시 로그인해 주세요.");
    expect(mockedClearAuthSession).toHaveBeenCalledOnce();
  });

  it("keeps non-401 authorized failures as generic API errors without clearing the session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(statusResponse(500)));

    const failure = await getMe("id-token").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(500);
    expect(mockedClearAuthSession).not.toHaveBeenCalled();
  });

  it("does not clear the auth session when a public request gets 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(statusResponse(401)));

    const failure = await postChat({ ticker: "005930", message: "왜 추천됐나요?" }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(401);
    expect(mockedClearAuthSession).not.toHaveBeenCalled();
  });
});

describe("stock search API adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the stock search endpoint with encoded query and limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          message: "ok",
          request_id: "req-search",
          data: {
            items: [
              {
                ticker: "005930",
                name: "삼성전자",
                market: "KOSPI",
                sector: "전기전자",
                corp_code: "00126380",
                match_reason: "name",
              },
            ],
            pagination: {
              limit: 10,
              offset: 0,
              total: 1,
              has_more: false,
            },
          },
        }),
      ),
    );

    const response = await searchStocks("삼성 전자", 10);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/v1/stocks/search?q=%EC%82%BC%EC%84%B1+%EC%A0%84%EC%9E%90&limit=10",
      expect.objectContaining({
        cache: "no-store",
      }),
    );
    expect(response).toEqual({
      query: "삼성 전자",
      count: 1,
      items: [
        {
          ticker: "005930",
          name: "삼성전자",
          market: "KOSPI",
          sector: "전기전자",
          industry: null,
        },
      ],
    });
  });
});

function statusResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
  } as Response;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function chatContractResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    message: "ok",
    request_id: "req-chat",
    data: {
      session_id: "chat-session-1",
      answer: "공개 데이터 기준 설명입니다.",
      citations: [],
      safety: {
        policy_action: "ALLOW",
      },
      ...overrides,
    },
  };
}
