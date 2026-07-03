# StockBrief-fe

StockBrief 프론트엔드 레포지토리. Next.js App Router 기반의 한국 국내 주식 추천 후보 서비스 UI.

StockBrief는 투자 조언을 제공하지 않는다. 모든 추천은 `검토 후보 추천`이며, 매수·매도 지시, 목표가, 수익 보장이 아니다.

## 레포 범위

| 구분 | 내용 |
| --- | --- |
| `src/app/` | Next.js App Router 페이지 |
| `src/components/` | UI 컴포넌트 (CandidateCard, EvidenceBadge, RiskTag 등) |
| `src/lib/` | API 클라이언트, Cognito 인증, watchlist 스토리지/싱크 |
| `src/types/` | TypeScript API 및 watchlist 타입 정의 |
| `docs/product/` | MVP PRD, 제품 정책 |
| `docs/engineering/` | API 계약 (BE 참조용) |

## 로컬 셋업

Node.js 24.x 기준으로 개발한다. `mise install`로 런타임을 맞춘 뒤 `pnpm`으로 의존성을 설치한다.

```bash
mise install
pnpm install
```

환경변수 설정:

```bash
cp .env.example .env.local
# NEXT_PUBLIC_API_BASE_URL 등 설정
```

BE Terraform dev stack이 준비된 뒤에는 현재 AWS 계정의 출력값으로 로컬
환경변수를 다시 생성할 수 있다. 이 명령은 public FE 환경변수만 쓰며
API key, token, secret 값은 다루지 않는다.

```bash
pnpm run sync:dev-env -- --terraform-dir ../StockBrief-be/infra/terraform
```

기본 callback은 `http://localhost:3001/auth/callback`이다. 다른 포트로
로컬 서버를 띄울 때는 Cognito callback allowlist에 포함된 값으로 명시한다.

```bash
pnpm run sync:dev-env -- \
  --terraform-dir ../StockBrief-be/infra/terraform \
  --redirect-uri http://localhost:3000/auth/callback
```

## 개발 서버 실행

```bash
pnpm run dev
```

기본 주소: [http://localhost:3000](http://localhost:3000)

백엔드 API는 `http://localhost:8000` 에서 실행되어야 한다.

## 주요 페이지

| 경로 | 설명 |
| --- | --- |
| `/` | 메인 (추천 후보 목록으로 리다이렉트) |
| `/recommendations` | 추천 후보 목록 |
| `/stocks/[ticker]` | 종목 상세 및 에비던스 |
| `/watchlist` | 관심목록 (localStorage 기반, MVP) |
| `/onboarding` | 온보딩 |
| `/account` | 계정 (P1, Cognito 인증 필요) |

## 검증 명령어

```bash
pnpm run lint       # ESLint
pnpm run typecheck  # TypeScript 타입 체크
pnpm run build      # 프로덕션 빌드
```

Hosted Amplify 화면에서 추천 후보, 상세 근거, 종목 검색, guest 관심종목,
계정, 인증 callback 화면이 실제로 보이는지 확인할 때는 다음 smoke를 사용한다.
결과에는 HTTP 상태와 화면 요소 확인값만 남기며, raw HTML, provider 원문,
localStorage payload, token, auth code는 출력하지 않는다.

```bash
STOCKBRIEF_HOSTED_URL="https://main.d20hgo2k8atldu.amplifyapp.com" \
pnpm run smoke:hosted-evidence -- \
  --ticker 005930 \
  --search-query 삼성전자 \
  --search-result-name 삼성전자 \
  --search-result-ticker 005930
```

## 브랜치 정책

- `main`: 보호 브랜치, 직접 push 금지
- `feat/<issue>-<slug>`: 새 기능
- `fix/<issue>-<slug>`: 버그 수정
- `docs/<slug>`: 문서 변경
- `release/<version>`: 릴리즈 직전 안정화

커밋 타입: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`

## API 계약

API 계약은 BE 레포에서 먼저 고정한다. `docs/engineering/API_CONTRACT.md`를 참조하고, 타입은 `src/types/api.ts`에서 관리한다.

- Backend canonical API base: `/v1`
- Recommendation candidates: `GET /v1/recommendations/candidates`
- Recommendation candidate detail: `GET /v1/recommendations/candidates/{ticker}`

## 관련 레포

- [StockBrief-be](https://github.com/your-org/StockBrief-be) — FastAPI 백엔드, DB, 인프라
- [StockBrief-wiki](https://github.com/your-org/StockBrief-wiki) — 결정 로그, 회의록, 스프린트 기록
