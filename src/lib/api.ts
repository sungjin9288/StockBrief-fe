import type {
  ChatContractResponse,
  StockDetailContractResponse,
  StockEvidenceContractResponse,
  StockSearchContractResponse,
} from "@/types/api-contract";
import type {
  ChatRequest,
  ChatResponse,
  MeResponse,
  RecommendationCandidate,
  RecommendationCandidateList,
  RiskProfile,
  ServerWatchlistImportResponse,
  ServerWatchlistResponse,
  StockDetail,
  StockEvidenceResponse,
  StockSearchResponse,
  UserChatSessionDetailResponse,
  UserChatSessionListResponse,
  UserPreferencesResponse,
} from "@/types/api";
import type { WatchlistInput } from "@/types/watchlist";

type EvidenceFilterType = "financial" | "news" | "disclosure" | "price";

const DEFAULT_API_BASE_URL = "http://localhost:8000/v1";
const DEFAULT_CHAT_SAFETY_DISCLAIMER =
  "공개 데이터 기반 설명이며 투자 조언이 아닙니다. 원문 확인이 필요합니다.";

export const AUTH_SESSION_EXPIRED_MESSAGE = "로그인이 만료되었습니다. 다시 로그인해 주세요.";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ApiError(`API request failed: ${path}`, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function authorizedRequest<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  try {
    return await request<T>(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...init?.headers,
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await clearExpiredAuthSession();
      throw new ApiError(AUTH_SESSION_EXPIRED_MESSAGE, 401);
    }
    throw error;
  }
}

// Dynamic import keeps the client-only cognito-auth module out of the server
// bundle graph; public api helpers in this file are also used by server pages.
async function clearExpiredAuthSession(): Promise<void> {
  if (typeof window === "undefined") return;
  const { clearAuthSession } = await import("@/lib/cognito-auth");
  clearAuthSession();
}

export interface CandidateQuery {
  riskProfile?: RiskProfile;
  market?: "KOSPI" | "KOSDAQ";
  sector?: string;
  limit?: number;
}

export async function getRecommendationCandidates(
  query: CandidateQuery = {},
): Promise<RecommendationCandidateList> {
  const params = new URLSearchParams();
  if (query.riskProfile) params.set("risk_profile", query.riskProfile);
  if (query.market) params.set("market", query.market);
  if (query.sector) params.set("sector", query.sector);
  if (query.limit) params.set("limit", String(query.limit));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<RecommendationCandidateList>(`/recommendations/candidates${suffix}`);
}

export async function getRecommendationCandidate(
  ticker: string,
): Promise<RecommendationCandidate> {
  return request<RecommendationCandidate>(
    `/recommendations/candidates/${encodeURIComponent(ticker)}`,
  );
}

export async function searchStocks(query = "", limit = 20): Promise<StockSearchResponse> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("limit", String(limit));
  const response = await request<StockSearchContractResponse>(`/stocks/search?${params.toString()}`);
  return {
    query,
    count: response.data.pagination.total,
    items: response.data.items.map((item) => ({
      ticker: item.ticker,
      name: item.name,
      market: item.market,
      sector: item.sector,
      industry: null,
    })),
  };
}

export async function getStock(ticker: string): Promise<StockDetail> {
  const response = await request<StockDetailContractResponse>(`/stocks/${encodeURIComponent(ticker)}`);
  return {
    ticker: response.data.stock.ticker,
    name: response.data.stock.name,
    name_en: null,
    market: response.data.stock.market,
    sector: response.data.stock.sector,
    industry: null,
    listing_date: null,
    is_active: true,
    identifiers: response.data.stock.corp_code
      ? [
          {
            provider: "OpenDART",
            identifier_type: "corp_code",
            identifier_value: response.data.stock.corp_code,
            is_primary: true,
          },
        ]
      : [],
  };
}

export async function getStockEvidence(
  ticker: string,
  type?: EvidenceFilterType,
): Promise<StockEvidenceResponse> {
  const params = new URLSearchParams();
  if (type) params.set("source_type", toContractEvidenceFilter(type));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await request<StockEvidenceContractResponse>(`/stocks/${encodeURIComponent(ticker)}/evidence${suffix}`);
  return {
    ticker: response.data.ticker,
    evidence: response.data.items.map((item) => ({
      id: item.id,
      type: fromContractSourceType(item.source_type),
      title: item.title,
      summary: item.snippet,
      source_name: item.source_name,
      source_url: item.url,
      source_identifier:
        typeof item.metadata.source_identifier === "string"
          ? item.metadata.source_identifier
          : null,
      published_at: item.published_at,
      as_of_date: typeof item.metadata.as_of_date === "string" ? item.metadata.as_of_date : null,
      data_status:
        item.metadata.data_status === "fallback" || item.metadata.data_status === "missing"
          ? item.metadata.data_status
          : "available",
    })),
    message: response.data.items.length === 0 ? "표시할 근거가 아직 없습니다." : null,
  };
}

export async function postChat(requestBody: ChatRequest): Promise<ChatResponse> {
  const response = await request<ChatContractResponse>("/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  return toChatResponse(response);
}

export async function postAuthenticatedChat(
  accessToken: string,
  requestBody: ChatRequest,
): Promise<ChatResponse> {
  const response = await authorizedRequest<ChatContractResponse>("/chat", accessToken, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  return toChatResponse(response);
}

export async function getMe(accessToken: string): Promise<MeResponse> {
  return authorizedRequest<MeResponse>("/me", accessToken);
}

export async function patchMe(
  accessToken: string,
  body: { nickname?: string | null },
): Promise<MeResponse> {
  return authorizedRequest<MeResponse>("/me", accessToken, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function getUserPreferences(accessToken: string): Promise<UserPreferencesResponse> {
  return authorizedRequest<UserPreferencesResponse>("/me/preferences", accessToken);
}

export async function putUserPreferences(
  accessToken: string,
  preferences: Record<string, unknown>,
): Promise<UserPreferencesResponse> {
  return authorizedRequest<UserPreferencesResponse>("/me/preferences", accessToken, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ preferences }),
  });
}

export async function getServerWatchlist(accessToken: string): Promise<ServerWatchlistResponse> {
  return authorizedRequest<ServerWatchlistResponse>("/me/watchlist", accessToken);
}

export async function addServerWatchlistItem(
  accessToken: string,
  item: WatchlistInput,
): Promise<void> {
  await authorizedRequest("/me/watchlist", accessToken, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(item),
  });
}

export async function deleteServerWatchlistItem(
  accessToken: string,
  ticker: string,
): Promise<void> {
  await authorizedRequest(`/me/watchlist/${encodeURIComponent(ticker)}`, accessToken, {
    method: "DELETE",
  });
}

export async function patchServerWatchlistItem(
  accessToken: string,
  ticker: string,
  body: { memo?: string | null },
): Promise<void> {
  await authorizedRequest(`/me/watchlist/${encodeURIComponent(ticker)}`, accessToken, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function importServerWatchlist(
  accessToken: string,
  items: WatchlistInput[],
): Promise<ServerWatchlistImportResponse> {
  return authorizedRequest<ServerWatchlistImportResponse>("/me/watchlist/import", accessToken, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ items }),
  });
}

export async function getUserChatSessions(
  accessToken: string,
): Promise<UserChatSessionListResponse> {
  return authorizedRequest<UserChatSessionListResponse>("/me/chat-sessions", accessToken);
}

export async function getUserChatSessionDetail(
  accessToken: string,
  sessionId: string,
): Promise<UserChatSessionDetailResponse> {
  return authorizedRequest<UserChatSessionDetailResponse>(
    `/me/chat-sessions/${encodeURIComponent(sessionId)}`,
    accessToken,
  );
}

function toContractEvidenceFilter(type: EvidenceFilterType) {
  if (type === "news") return "NEWS";
  if (type === "disclosure") return "DISCLOSURE";
  if (type === "financial" || type === "price") return "SCORE";
  return "CHUNK";
}

function fromContractSourceType(
  sourceType: "NEWS" | "DISCLOSURE" | "SCORE" | "CHUNK",
): "financial" | "news" | "disclosure" | "price" {
  if (sourceType === "NEWS") return "news";
  if (sourceType === "DISCLOSURE") return "disclosure";
  if (sourceType === "SCORE") return "financial";
  return "disclosure";
}

function toChatResponse(response: ChatContractResponse): ChatResponse {
  const safety = response.data.safety;
  const safetyDisclaimer = (safety?.disclaimer ?? "").trim();
  return {
    session_id: response.data.session_id,
    message_id: response.data.message_id ?? null,
    answer: response.data.answer,
    citations: response.data.citations.map((citation) => ({
      evidence_id: citation.id,
      type: fromContractSourceType(citation.source_type),
      title: citation.title,
      source_name: citation.source_type,
      source_url: citation.url,
      as_of_date: citation.published_at,
    })),
    policy_status: fromPolicyAction(safety?.policy_action),
    disclaimer: safetyDisclaimer || DEFAULT_CHAT_SAFETY_DISCLAIMER,
    used_evidence_ids: response.data.citations.map((citation) => citation.id),
  };
}

function fromPolicyAction(action?: "ALLOW" | "REDIRECT" | "BLOCK") {
  if (action === "ALLOW") return "allowed";
  if (action === "BLOCK") return "blocked";
  return "redirected";
}
