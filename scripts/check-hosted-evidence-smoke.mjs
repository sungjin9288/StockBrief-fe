#!/usr/bin/env node

import { fileURLToPath } from "node:url";

const DEFAULT_HOSTED_URL = "https://main.d20hgo2k8atldu.amplifyapp.com";
const DEFAULT_TICKER = "005930";
const DEFAULT_SEARCH_QUERY = "005930";
const DEFAULT_SEARCH_RESULT_NAME = "삼성전자";
const DEFAULT_SEARCH_RESULT_TICKER = "005930";
const DEFAULT_TIMEOUT_MS = 10000;

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    hostedUrl: env.STOCKBRIEF_HOSTED_URL || DEFAULT_HOSTED_URL,
    ticker: env.STOCKBRIEF_EVIDENCE_TICKER || DEFAULT_TICKER,
    searchQuery: env.STOCKBRIEF_SEARCH_QUERY || DEFAULT_SEARCH_QUERY,
    searchResultName: env.STOCKBRIEF_SEARCH_RESULT_NAME || DEFAULT_SEARCH_RESULT_NAME,
    searchResultTicker: env.STOCKBRIEF_SEARCH_RESULT_TICKER || DEFAULT_SEARCH_RESULT_TICKER,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--hosted-url") {
      options.hostedUrl = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--ticker") {
      options.ticker = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--search-query") {
      options.searchQuery = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--search-result-name") {
      options.searchResultName = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--search-result-ticker") {
      options.searchResultTicker = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      const raw = requireValue(argv, index, arg);
      const timeoutMs = Number(raw);
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
        throw new Error("--timeout-ms must be a positive integer.");
      }
      options.timeoutMs = timeoutMs;
      index += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

export async function runSmoke({
  hostedUrl,
  ticker = DEFAULT_TICKER,
  searchQuery = DEFAULT_SEARCH_QUERY,
  searchResultName = DEFAULT_SEARCH_RESULT_NAME,
  searchResultTicker = DEFAULT_SEARCH_RESULT_TICKER,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetcher = fetchPage,
}) {
  const baseUrl = normalizeBaseUrl(hostedUrl);
  const checks = {};
  const blockers = [];

  if (!baseUrl) {
    return {
      ok: false,
      hosted_url_configured: false,
      ticker,
      checks,
      blockers: [{ code: "missing_or_invalid_hosted_url" }],
    };
  }

  const home = await checkPage({
    name: "hosted_page:/",
    baseUrl,
    path: "/",
    timeoutMs,
    fetcher,
    inspect: inspectHomePage,
  });
  checks[home.name] = home;

  const detailPath = `/stocks/${encodeURIComponent(ticker)}`;
  const detail = await checkPage({
    name: "hosted_page:/stocks/{ticker}",
    baseUrl,
    path: detailPath,
    timeoutMs,
    fetcher,
    inspect: inspectStockDetailPage,
  });
  checks[detail.name] = detail;

  const searchPath = `/search?q=${encodeURIComponent(searchQuery)}`;
  const search = await checkPage({
    name: "hosted_page:/search",
    baseUrl,
    path: searchPath,
    timeoutMs,
    fetcher,
    inspect: (html) =>
      inspectSearchPage(html, { resultName: searchResultName, resultTicker: searchResultTicker }),
  });
  checks[search.name] = search;

  const watchlist = await checkPage({
    name: "hosted_page:/watchlist",
    baseUrl,
    path: "/watchlist",
    timeoutMs,
    fetcher,
    inspect: inspectWatchlistPage,
  });
  checks[watchlist.name] = watchlist;

  const account = await checkPage({
    name: "hosted_page:/account",
    baseUrl,
    path: "/account",
    timeoutMs,
    fetcher,
    inspect: inspectAccountPage,
  });
  checks[account.name] = account;

  const authCallback = await checkPage({
    name: "hosted_page:/auth/callback",
    baseUrl,
    path: "/auth/callback",
    timeoutMs,
    fetcher,
    inspect: inspectAuthCallbackPage,
  });
  checks[authCallback.name] = authCallback;

  for (const check of Object.values(checks)) {
    if (!check.ok) {
      blockers.push({
        check: check.name,
        status_code: check.status_code,
        missing: check.summary.missing,
        error_code: check.error_code || "check_failed",
      });
    }
  }

  return {
    ok: Object.values(checks).every((check) => check.ok),
    hosted_url_configured: true,
    ticker,
    search_query: searchQuery,
    search_result_ticker: searchResultTicker,
    checks,
    blockers,
  };
}

async function checkPage({ name, baseUrl, path, timeoutMs, fetcher, inspect }) {
  const response = await fetcher(pageUrl(baseUrl, path), timeoutMs);
  const reachable = response.errorCode === null && response.statusCode >= 200 && response.statusCode < 400;
  const inspection = reachable ? inspect(response.body) : { passed: false, summary: { missing: ["reachable"] } };
  return {
    ok: reachable && inspection.passed,
    name,
    target: path,
    status_code: response.statusCode,
    summary: {
      reachable,
      ...inspection.summary,
    },
    error_code: response.errorCode,
  };
}

export function inspectHomePage(html) {
  const checks = {
    hasProductName: html.includes("StockBrief"),
    hasCandidateHeading: html.includes("오늘의 추천 후보") || html.includes("추천 후보 리스트"),
    hasReviewCandidateCopy: html.includes("검토 흐름") || html.includes("추천 후보 보기"),
  };
  return summarizeInspection(checks);
}

export function inspectStockDetailPage(html) {
  const checks = {
    hasScore: html.includes("추천 후보 점수"),
    hasEvidenceSection: html.includes("공시·뉴스·재무·가격 근거"),
    hasEvidenceId: html.includes("근거 ID:"),
    hasPublishedDate: html.includes("발행일:"),
    hasSourceReference: html.includes("원문 보기") || html.includes("출처 ID:"),
  };
  return summarizeInspection(checks);
}

export function inspectSearchPage(
  html,
  { resultName = DEFAULT_SEARCH_RESULT_NAME, resultTicker = DEFAULT_SEARCH_RESULT_TICKER } = {},
) {
  const checks = {
    hasSearchHeading: html.includes("종목 검색"),
    hasSearchCopy: html.includes("회사명이나 종목 코드로 찾기"),
    hasSearchResultName: html.includes(resultName),
    hasSearchResultLink: html.includes(`/stocks/${resultTicker}`),
  };
  return summarizeInspection(checks);
}

export function inspectWatchlistPage(html) {
  const checks = {
    hasWatchlistHeading: html.includes("저장한 검토 후보"),
    hasGuestStorageCopy:
      html.includes("게스트는 이 브라우저에 저장하고") ||
      html.includes("게스트 상태입니다. 관심종목은 이 브라우저의 localStorage에 저장됩니다."),
  };
  return summarizeInspection(checks);
}

export function inspectAccountPage(html) {
  const checks = {
    hasAccountHeading: html.includes("계정"),
    hasGuestContinuityCopy: html.includes("게스트 기능은 그대로 사용할 수 있고"),
    hasAuthEntryOrConfigState: html.includes("이메일 로그인") || html.includes("로그인 환경이 아직 설정되지 않았습니다."),
  };
  return summarizeInspection(checks);
}

export function inspectAuthCallbackPage(html) {
  const checks = {
    hasCallbackHeading: html.includes("로그인 처리"),
    hasFailureRecoveryCopy: html.includes("로그인 결과를 처리하지 못했습니다."),
    hasAccountRecoveryLink: html.includes("계정으로 이동"),
  };
  return summarizeInspection(checks);
}

function summarizeInspection(checks) {
  const missing = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  return {
    passed: missing.length === 0,
    summary: {
      ...checks,
      missing,
    },
  };
}

export async function fetchPage(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return {
      statusCode: response.status,
      body: await response.text(),
      errorCode: null,
    };
  } catch (error) {
    return {
      statusCode: null,
      body: "",
      errorCode: error instanceof Error ? error.name : "FetchError",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeBaseUrl(value) {
  const stripped = String(value || "").trim().replace(/\/+$/, "");
  if (!stripped) return "";
  try {
    const parsed = new URL(stripped);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function pageUrl(baseUrl, path) {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function requireValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${optionName} requires a value.`);
  }
  return value;
}

function printUsage() {
  console.log(`Usage: pnpm run smoke:hosted-evidence -- [options]

Options:
  --hosted-url VALUE  Hosted FE base URL. Defaults to STOCKBRIEF_HOSTED_URL or dev Amplify URL.
  --ticker VALUE      Stock detail ticker to inspect. Defaults to STOCKBRIEF_EVIDENCE_TICKER or 005930.
  --search-query VALUE  Search query to inspect. Defaults to STOCKBRIEF_SEARCH_QUERY or 005930.
  --search-result-name VALUE  Expected search result name. Defaults to STOCKBRIEF_SEARCH_RESULT_NAME or 삼성전자.
  --search-result-ticker VALUE  Expected search result detail ticker. Defaults to STOCKBRIEF_SEARCH_RESULT_TICKER or 005930.
  --timeout-ms VALUE  Request timeout in milliseconds. Default: ${DEFAULT_TIMEOUT_MS}.
`);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const args = parseArgs();
    if (args.help) {
      printUsage();
      process.exit(0);
    }
    const result = await runSmoke(args);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
