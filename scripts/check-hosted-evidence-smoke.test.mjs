import { describe, expect, it } from "vitest";

import {
  inspectHomePage,
  inspectAccountPage,
  inspectAuthCallbackPage,
  inspectSearchPage,
  inspectStockDetailPage,
  inspectWatchlistPage,
  normalizeBaseUrl,
  parseArgs,
  runSmoke,
} from "./check-hosted-evidence-smoke.mjs";

const homeHtml = `
  <main>
    <h1>StockBrief</h1>
    <p>오늘의 추천 후보</p>
    <a>추천 후보 보기</a>
  </main>
`;

const detailHtml = `
  <main>
    <h1>삼성전자</h1>
    <div>추천 후보 점수</div>
    <section>
      <h2>공시·뉴스·재무·가격 근거</h2>
      <span>근거 ID: ev_1</span>
      <span>발행일: 2026.06.26</span>
      <a href="https://provider.example/news/private-body">원문 보기</a>
      <p>provider raw title should not be printed</p>
    </section>
  </main>
`;

const searchHtml = `
  <main>
    <p>종목 검색</p>
    <h1>회사명이나 종목 코드로 찾기</h1>
    <a href="/stocks/005930">삼성전자</a>
    <span>005930</span>
    <p>private search payload should not be printed</p>
  </main>
`;

const watchlistHtml = `
  <main>
    <p>관심종목</p>
    <h1>저장한 검토 후보</h1>
    <p>게스트는 이 브라우저에 저장하고, 로그인 후에는 서버 관심종목과 동기화합니다.</p>
    <section>
      <h2>저장된 관심종목이 없습니다.</h2>
      <a href="/recommendations">추천 후보 보기</a>
    </section>
    <p>private localStorage payload should not be printed</p>
  </main>
`;

const accountHtml = `
  <main>
    <h1>계정</h1>
    <p>게스트 기능은 그대로 사용할 수 있고, 로그인하면 관심종목, 선호 설정, 대화 이력을 서버에 저장합니다.</p>
    <button>이메일 로그인</button>
    <p>private account payload should not be printed</p>
  </main>
`;

const authCallbackHtml = `
  <main>
    <h1>로그인 처리</h1>
    <p>로그인 결과를 처리하지 못했습니다. 계정 화면에서 다시 시도해 주세요.</p>
    <a href="/account">계정으로 이동</a>
    <p>auth code should not be printed</p>
  </main>
`;

describe("check-hosted-evidence-smoke", () => {
  it("parses CLI args and normalizes hosted URLs", () => {
    expect(
      parseArgs([
        "--",
        "--hosted-url",
        "https://main.example.amplifyapp.com/",
        "--ticker",
        "005930",
        "--search-query",
        "삼성전자",
        "--search-result-name",
        "삼성전자",
        "--search-result-ticker",
        "005930",
        "--timeout-ms",
        "5000",
      ]),
    ).toMatchObject({
      hostedUrl: "https://main.example.amplifyapp.com/",
      ticker: "005930",
      searchQuery: "삼성전자",
      searchResultName: "삼성전자",
      searchResultTicker: "005930",
      timeoutMs: 5000,
    });
    expect(normalizeBaseUrl("https://main.example.amplifyapp.com/")).toBe(
      "https://main.example.amplifyapp.com",
    );
  });

  it("checks hosted product pages without printing raw HTML", async () => {
    const calls = [];
    const result = await runSmoke({
      hostedUrl: "https://main.example.amplifyapp.com",
      ticker: "005930",
      fetcher: async (url) => {
        calls.push(url);
        if (url.endsWith("/account")) {
          return {
            statusCode: 200,
            body: accountHtml,
            errorCode: null,
          };
        }
        if (url.endsWith("/auth/callback")) {
          return {
            statusCode: 200,
            body: authCallbackHtml,
            errorCode: null,
          };
        }
        if (url.endsWith("/search?q=005930")) {
          return {
            statusCode: 200,
            body: searchHtml,
            errorCode: null,
          };
        }
        if (url.endsWith("/watchlist")) {
          return {
            statusCode: 200,
            body: watchlistHtml,
            errorCode: null,
          };
        }
        return {
          statusCode: 200,
          body: url.endsWith("/stocks/005930") ? detailHtml : homeHtml,
          errorCode: null,
        };
      },
    });

    const serialized = JSON.stringify(result);
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      "https://main.example.amplifyapp.com/",
      "https://main.example.amplifyapp.com/stocks/005930",
      "https://main.example.amplifyapp.com/search?q=005930",
      "https://main.example.amplifyapp.com/watchlist",
      "https://main.example.amplifyapp.com/account",
      "https://main.example.amplifyapp.com/auth/callback",
    ]);
    expect(result.checks["hosted_page:/stocks/{ticker}"].summary).toMatchObject({
      hasEvidenceSection: true,
      hasEvidenceId: true,
      hasPublishedDate: true,
      hasSourceReference: true,
      missing: [],
    });
    expect(result.checks["hosted_page:/search"].summary).toMatchObject({
      hasSearchHeading: true,
      hasSearchCopy: true,
      hasSearchResultName: true,
      hasSearchResultLink: true,
      missing: [],
    });
    expect(result.checks["hosted_page:/watchlist"].summary).toMatchObject({
      hasWatchlistHeading: true,
      hasGuestStorageCopy: true,
      missing: [],
    });
    expect(result.checks["hosted_page:/account"].summary).toMatchObject({
      hasAccountHeading: true,
      hasGuestContinuityCopy: true,
      hasAuthEntryOrConfigState: true,
      missing: [],
    });
    expect(result.checks["hosted_page:/auth/callback"].summary).toMatchObject({
      hasCallbackHeading: true,
      hasFailureRecoveryCopy: true,
      hasAccountRecoveryLink: true,
      missing: [],
    });
    expect(serialized).not.toContain("provider raw title");
    expect(serialized).not.toContain("provider.example");
    expect(serialized).not.toContain("private search payload");
    expect(serialized).not.toContain("private localStorage payload");
    expect(serialized).not.toContain("private account payload");
    expect(serialized).not.toContain("auth code");
  });

  it("reports missing evidence fields as blockers", async () => {
    const result = await runSmoke({
      hostedUrl: "https://main.example.amplifyapp.com",
      ticker: "005930",
      fetcher: async (url) => {
        if (url.endsWith("/account")) {
          return {
            statusCode: 200,
            body: accountHtml,
            errorCode: null,
          };
        }
        if (url.endsWith("/auth/callback")) {
          return {
            statusCode: 200,
            body: authCallbackHtml,
            errorCode: null,
          };
        }
        if (url.endsWith("/search?q=005930")) {
          return {
            statusCode: 200,
            body: searchHtml,
            errorCode: null,
          };
        }
        if (url.endsWith("/watchlist")) {
          return {
            statusCode: 200,
            body: watchlistHtml,
            errorCode: null,
          };
        }
        return {
          statusCode: 200,
          body: url.endsWith("/stocks/005930")
            ? "<main><div>추천 후보 점수</div><h2>공시·뉴스·재무·가격 근거</h2></main>"
            : homeHtml,
          errorCode: null,
        };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual([
      {
        check: "hosted_page:/stocks/{ticker}",
        status_code: 200,
        missing: ["hasEvidenceId", "hasPublishedDate", "hasSourceReference"],
        error_code: "check_failed",
      },
    ]);
  });

  it("reports missing search result markers as redacted blockers", async () => {
    const result = await runSmoke({
      hostedUrl: "https://main.example.amplifyapp.com",
      ticker: "005930",
      fetcher: async (url) => {
        if (url.endsWith("/search?q=005930")) {
          return {
            statusCode: 200,
            body: "<main><p>종목 검색</p><h1>회사명이나 종목 코드로 찾기</h1></main>",
            errorCode: null,
          };
        }
        if (url.endsWith("/watchlist")) {
          return {
            statusCode: 200,
            body: watchlistHtml,
            errorCode: null,
          };
        }
        if (url.endsWith("/account")) {
          return {
            statusCode: 200,
            body: accountHtml,
            errorCode: null,
          };
        }
        if (url.endsWith("/auth/callback")) {
          return {
            statusCode: 200,
            body: authCallbackHtml,
            errorCode: null,
          };
        }
        return {
          statusCode: 200,
          body: url.endsWith("/stocks/005930") ? detailHtml : homeHtml,
          errorCode: null,
        };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual([
      {
        check: "hosted_page:/search",
        status_code: 200,
        missing: ["hasSearchResultName", "hasSearchResultLink"],
        error_code: "check_failed",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("회사명이나 종목 코드로 찾기</h1>");
  });

  it("uses the expected result ticker for company-name search result links", async () => {
    const result = await runSmoke({
      hostedUrl: "https://main.example.amplifyapp.com",
      ticker: "005930",
      searchQuery: "삼성전자",
      searchResultName: "삼성전자",
      searchResultTicker: "005930",
      fetcher: async (url) => {
        if (url.endsWith("/search?q=%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90")) {
          return {
            statusCode: 200,
            body: searchHtml,
            errorCode: null,
          };
        }
        if (url.endsWith("/watchlist")) {
          return {
            statusCode: 200,
            body: watchlistHtml,
            errorCode: null,
          };
        }
        if (url.endsWith("/account")) {
          return {
            statusCode: 200,
            body: accountHtml,
            errorCode: null,
          };
        }
        if (url.endsWith("/auth/callback")) {
          return {
            statusCode: 200,
            body: authCallbackHtml,
            errorCode: null,
          };
        }
        return {
          statusCode: 200,
          body: url.endsWith("/stocks/005930") ? detailHtml : homeHtml,
          errorCode: null,
        };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.search_query).toBe("삼성전자");
    expect(result.search_result_ticker).toBe("005930");
    expect(result.checks["hosted_page:/search"].target).toBe(
      "/search?q=%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90",
    );
    expect(result.checks["hosted_page:/search"].summary).toMatchObject({
      hasSearchResultName: true,
      hasSearchResultLink: true,
      missing: [],
    });
  });

  it("reports missing account and auth callback markers as redacted blockers", async () => {
    const result = await runSmoke({
      hostedUrl: "https://main.example.amplifyapp.com",
      ticker: "005930",
      fetcher: async (url) => {
        if (url.endsWith("/watchlist")) {
          return {
            statusCode: 200,
            body: watchlistHtml,
            errorCode: null,
          };
        }
        if (url.endsWith("/account")) {
          return {
            statusCode: 200,
            body: "<main><h1>계정</h1></main>",
            errorCode: null,
          };
        }
        if (url.endsWith("/auth/callback")) {
          return {
            statusCode: 200,
            body: "<main><h1>로그인 처리</h1></main>",
            errorCode: null,
          };
        }
        if (url.endsWith("/search?q=005930")) {
          return {
            statusCode: 200,
            body: searchHtml,
            errorCode: null,
          };
        }
        return {
          statusCode: 200,
          body: url.endsWith("/stocks/005930") ? detailHtml : homeHtml,
          errorCode: null,
        };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual([
      {
        check: "hosted_page:/account",
        status_code: 200,
        missing: ["hasGuestContinuityCopy", "hasAuthEntryOrConfigState"],
        error_code: "check_failed",
      },
      {
        check: "hosted_page:/auth/callback",
        status_code: 200,
        missing: ["hasFailureRecoveryCopy", "hasAccountRecoveryLink"],
        error_code: "check_failed",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("계정</h1>");
  });

  it("keeps page inspection rules small and explicit", () => {
    expect(inspectHomePage(homeHtml).passed).toBe(true);
    expect(inspectStockDetailPage(detailHtml).passed).toBe(true);
    expect(inspectSearchPage(searchHtml).passed).toBe(true);
    expect(inspectWatchlistPage(watchlistHtml).passed).toBe(true);
    expect(inspectAccountPage(accountHtml).passed).toBe(true);
    expect(inspectAuthCallbackPage(authCallbackHtml).passed).toBe(true);
    expect(inspectStockDetailPage("<main>공시·뉴스·재무·가격 근거</main>").summary.missing).toContain(
      "hasEvidenceId",
    );
    expect(inspectSearchPage("<main>종목 검색</main>").summary.missing).toEqual([
      "hasSearchCopy",
      "hasSearchResultName",
      "hasSearchResultLink",
    ]);
    expect(inspectWatchlistPage("<main>저장한 검토 후보</main>").summary.missing).toEqual([
      "hasGuestStorageCopy",
    ]);
    expect(inspectAccountPage("<main>계정</main>").summary.missing).toEqual([
      "hasGuestContinuityCopy",
      "hasAuthEntryOrConfigState",
    ]);
    expect(inspectAuthCallbackPage("<main>로그인 처리</main>").summary.missing).toEqual([
      "hasFailureRecoveryCopy",
      "hasAccountRecoveryLink",
    ]);
  });
});
