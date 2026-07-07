# AGR 대시보드 — AI 코딩 도우미용 안내서

이 파일은 Codex 등 AI 코딩 도구가 프로젝트를 빠르게 파악하도록 쓰는 문서입니다.
사람이 읽는 사용 가이드는 [README.md](README.md)에 있습니다.

## 프로젝트 개요

농가 경영·판매경로 진단 대시보드. 농가 정보를 입력하면 전국평균 비교, 행동기반 분류,
TOPSIS 다기준 분석을 거쳐 AI(LLM)가 종합 진단문을 생성한다. 그 외 작목별 수익성 비교,
KAMIS 도매가격, 소비 트렌드, 공공데이터 카탈로그, 출하 가이드 탭이 있다.

- 스택: React 18 + Vite (프론트) / Express (server.js, 백엔드) / Python (scripts/, 데이터 변환)
- UI·주석·데이터 전부 **한국어**. 커밋 메시지도 한국어로 쓴다.
- 차트 라이브러리 없음 — div 기반 커스텀 바 차트만 사용. 새 차트도 같은 방식으로.
- 테마는 `src/theme.js`의 다크 네이비 토큰만 사용.

## 실행·검증 명령

```
npm run dev          # 클라이언트(5173) + 백엔드(3001) 동시 실행
npm run build        # dist/ 정적 빌드
python scripts/validate_data.py   # public/data JSON 형식·중복id·필수값 점검
```

`.env`가 필요하다(.env.example 참고, git 미포함). AI 진단 기능은 API 키가 있어야 동작한다.

## 아키텍처 핵심

- **server.js** — 유일한 백엔드. 역할 두 가지:
  1. `/api/analyze`: AI 프록시. `.env`의 `AI_PROVIDER`(anthropic | openai | gemini)로 제공자 선택.
     OpenAI/Gemini는 OpenAI 호환 스트림을 Anthropic 이벤트 형식(`content_block_delta`)으로
     변환해 내보낸다 → 프론트엔드는 제공자와 무관하게 동일 동작. `OPENAI_API_URL`을
     재정의하면 Ollama 등 로컬 AI도 연결 가능.
  2. KAMIS·MAFRA 등 공공 API 중계 (키 은닉 + CORS 우회).
- **src/components/PortfolioDiagnosis.jsx** — 핵심 컴포넌트(가장 큼). 농가 입력 →
  전국평균 비교 + 행동기반 분류 + TOPSIS 계산 + AI 진단 호출(`callClaude`, 이름과 달리
  제공자 중립)까지 전부 담당.
- **src/lib/cropRegistry.js** — 작목별 데이터 연계 매핑의 **단일 공급원**. KAMIS 코드,
  소득자료 매칭 등 작목 관련 연결은 반드시 여기서만 수정.
- **src/lib/dataLoader.js** — `public/data/*.json` 로더. 데이터는 JSON만 채우면 화면에
  자동 반영되는 구조 (컴포넌트 수정 불필요).
- **public/data/SCHEMA.md** — 각 JSON 필드 정의.

## 진행 중인 작업·보류 사항 (2026-07 기준)

- **TOPSIS 보류 2건** (사용자가 직접 결정할 도메인 문제, 임의로 고치지 말 것):
  C4(가격안정) 기준의 방향성 문제, TYPE_INFO 주력 경로 라벨 불일치.
- **토마토 분리 보류**: 현재 '토마토' 단일 항목에 KAMIS(일반토마토)와 소비월보(방울토마토)
  데이터가 혼재. 일반/방울로 분리 예정.
- **출하 가이드 지속 업데이트**: PDF 입수 → pdftotext 추출 → `public/data/shipping-guides.json`
  갱신 파이프라인. 미보유 작목 5종(방울토마토는 스캔본이라 OCR 필요, 감자 등).
- **AMIS 소득자료 연동은 완료**: 57개 작목(2024) 수집됨. 수집기 `scripts/fetch_income_data.mjs`,
  코드표 `scripts/amis_codes.json`.

## 주의사항

- API 키는 `.env`에만. 프론트엔드 코드·git에 절대 넣지 않는다.
- `public/data/rda-cases.json`의 케이스, `public/data/guides/`의 PDF 원문은 데이터 자산 —
  코드 정리 중에 삭제·형식 변경하지 말 것.
- 진단 프롬프트(PortfolioDiagnosis.jsx 내)는 "LLM이 추론 → 표는 참고" 구조로 설계 의도가
  있으니 문구를 임의로 축약하지 말 것.
