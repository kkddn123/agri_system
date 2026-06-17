import { useState, useEffect, useRef } from "react";
import { theme } from "../theme";
import { loadRdaCases } from "../lib/dataLoader";

// 이 파일은 농가판매경로_AI시스템.jsx(v8)의 로직(행동기반 5문항 분류, TOPSIS 계산,
// Layer1/Layer2 프롬프트)을 그대로 가져와 AGR 대시보드의 다크 테마 탭 안에 옮긴 것입니다.
// 판단 로직(가중치·점수·분류 규칙·프롬프트 문구)은 변경하지 않았고, 시각 스타일과
// "사례 선택" 연동만 추가했습니다.

// ─── 상수 정의 (v8과 동일) ────────────────────────────────────
const ROUTES = ["도매시장", "생산자단체(조직출하)", "직거래(온라인)", "직거래(로컬푸드)", "산지유통인"];

const ROUTE_ROLE = {
  "도매시장": "기본 물량 처리형 경로",
  "생산자단체(조직출하)": "안정형·표준화형 경로",
  "직거래(온라인)": "고부가가치형 비대면 직판 경로",
  "직거래(로컬푸드)": "지역 밀착형 오프라인 직판 경로",
  "산지유통인": "기동성 기반 현장 수집·즉시 처리형 경로",
};

const ROUTE_ICON = {
  "도매시장": "🏪",
  "생산자단체(조직출하)": "🤝",
  "직거래(온라인)": "📱",
  "직거래(로컬푸드)": "🥬",
  "산지유통인": "🚛",
};

// 행동 기반 성향 질문 5개 (v8과 동일)
const BEHAVIOR_QUESTIONS = [
  {
    id: "q1",
    title: "가격 대응 행동",
    question: "출하 시기에 가격이 많이 떨어진 적 있었나요? 그때 어떻게 하셨나요?",
    options: [
      { label: "A. 그냥 도매로 보냈다", signal: { stable: 2 } },
      { label: "B. 직거래나 다른 경로로 돌렸다", signal: { profit: 2, challenge: 1 } },
      { label: "C. 출하를 미루고 기다렸다", signal: { profit: 1, challenge: 1 } },
      { label: "D. 방법을 몰라서 그냥 보냈다", signal: { stable: 1 } },
    ],
  },
  {
    id: "q2",
    title: "새 판로 시도 경험",
    question: "지금까지 새로운 판매 경로를 시도해본 적 있나요?",
    options: [
      { label: "A. 시도해봤고 지금도 하고 있다", signal: { challenge: 2, profit: 1 } },
      { label: "B. 시도했지만 그만뒀다", signal: { stable: 1 } },
      { label: "C. 시도해보고 싶지만 못 했다", signal: { challenge: 1 } },
      { label: "D. 시도한 적 없고 관심 없다", signal: { stable: 2 } },
    ],
  },
  {
    id: "q3",
    title: "가장 큰 불만",
    question: "지금 판매 방식에서 가장 불만스러운 점이 뭔가요?",
    options: [
      { label: "A. 가격이 너무 낮다", signal: { profit: 2 } },
      { label: "B. 가격이 들쭉날쭉 불안하다", signal: { stable: 2 } },
      { label: "C. 일이 너무 많고 복잡하다", signal: { labor: 1 } },
      { label: "D. 팔 곳이 마땅치 않다", signal: { challenge: 1 } },
    ],
  },
  {
    id: "q4",
    title: "클레임·반품 대응 경험",
    question: "고객이나 거래처에서 품질 클레임이나 반품 요청을 받은 적 있나요?",
    options: [
      { label: "A. 직접 처리했고 별로 어렵지 않았다", signal: { challenge: 1 } },
      { label: "B. 처리했지만 매우 힘들었다", signal: { stable: 1 } },
      { label: "C. 경험 없다", signal: {} },
      { label: "D. 조직(농협 등)이 대신 처리해줬다", signal: { org: 2 } },
    ],
  },
  {
    id: "q5",
    title: "출하 결정 방식",
    question: "지금 출하할 때 어떻게 결정하나요?",
    options: [
      { label: "A. 그날그날 시황 보고 결정한다", signal: { challenge: 1 } },
      { label: "B. 늘 하던 방식대로 보낸다", signal: { stable: 1 } },
      { label: "C. 농협이나 작목반 지시를 따른다", signal: { org: 2 } },
      { label: "D. 솔직히 잘 모르겠다, 그냥 보낸다", signal: { stable: 1 } },
    ],
  },
];

// TOPSIS 가중치 (유형별) - C1:수취가 C2:물량처리 C3:노동부담 C4:가격안정 C5:진입가능 (v8과 동일)
const TOPSIS_WEIGHTS = {
  A: [0.35, 0.15, 0.10, 0.15, 0.25],
  B: [0.30, 0.15, 0.10, 0.15, 0.30],
  C: [0.15, 0.25, 0.15, 0.30, 0.15],
  D: [0.10, 0.25, 0.20, 0.35, 0.10],
  E: [0.20, 0.20, 0.20, 0.20, 0.20],
};

// 기본 점수 행렬 (v8과 동일, C3는 역방향 처리된 값)
const BASE_SCORES = {
  "도매시장":            [5, 9, 2, 6, 9],
  "생산자단체(조직출하)": [6, 8, 3, 8, 8],
  "직거래(온라인)":       [9, 4, 7, 5, 5],
  "직거래(로컬푸드)":     [7, 5, 5, 6, 6],
  "산지유통인":           [4, 8, 2, 6, 8],
};

// 유형별 특성 (v8과 동일, color는 유형 구분용 강조색으로 그대로 사용)
const TYPE_INFO = {
  A: { label: "수익극대화형", desc: "수익 추구 + 도전성향 높음", main: "직거래(온라인)", color: "#e85d04" },
  B: { label: "성장형", desc: "수익 의향 있으나 제약 있음", main: "도매시장 → 직거래 확대", color: "#2d9d6f" },
  C: { label: "안정자립형", desc: "안정 선호 + 자율 운영", main: "도매시장", color: "#5b8def" },
  D: { label: "안정의존형", desc: "안정 최우선 + 조직 의존", main: "생산자단체", color: "#9d8df0" },
  E: { label: "균형형", desc: "성향 혼합 / 중립", main: "도매시장 (중립)", color: "#5bbdd0" },
};

// ─── 농가 유형 분류 (v8과 동일) ──────────────────────────────
function classifyFarmerType(answers) {
  let profit = 0, stable = 0, challenge = 0, org = 0;
  BEHAVIOR_QUESTIONS.forEach((q) => {
    const ans = answers[q.id];
    if (typeof ans !== "number") return;
    const sig = q.options[ans]?.signal || {};
    if (sig.profit) profit += sig.profit;
    if (sig.stable) stable += sig.stable;
    if (sig.challenge) challenge += sig.challenge;
    if (sig.org) org += sig.org;
  });
  let type;
  if (org >= 3 && profit <= stable) type = "D";
  else if (profit > stable && challenge >= 2 && org < 3) type = "A";
  else if (profit > stable && challenge < 2) type = "B";
  else if (profit <= stable && org < 3) type = "C";
  else type = "E";
  return { type, profit, stable, challenge, org };
}

// ─── TOPSIS 계산 (v8과 동일) ──────────────────────────────────
function calcTOPSIS(farmerType, c5Adjustments) {
  const weights = TOPSIS_WEIGHTS[farmerType];
  const routes = ROUTES;

  const scores = routes.map((r) => {
    const s = [...BASE_SCORES[r]];
    if (c5Adjustments[r] !== undefined) s[4] = c5Adjustments[r];
    return s;
  });

  const colSums = [0, 0, 0, 0, 0];
  scores.forEach((row) => row.forEach((v, j) => { colSums[j] += v * v; }));
  const colSqrt = colSums.map(Math.sqrt);

  const norm = scores.map((row) => row.map((v, j) => (colSqrt[j] ? v / colSqrt[j] : 0)));
  const weighted = norm.map((row) => row.map((v, j) => v * weights[j]));

  const ideal = weighted[0].map((_, j) => Math.max(...weighted.map((r) => r[j])));
  const antiIdeal = weighted[0].map((_, j) => Math.min(...weighted.map((r) => r[j])));

  const result = routes.map((r, i) => {
    const dPlus = Math.sqrt(weighted[i].reduce((acc, v, j) => acc + (v - ideal[j]) ** 2, 0));
    const dMinus = Math.sqrt(weighted[i].reduce((acc, v, j) => acc + (v - antiIdeal[j]) ** 2, 0));
    const score = dPlus + dMinus > 0 ? Math.round((dMinus / (dPlus + dMinus)) * 100) : 0;
    return { route: r, score, dPlus, dMinus };
  });

  return result.sort((a, b) => b.score - a.score);
}

// ─── C5 진입가능성 자동 조정 (v8과 동일) ──────────────────────
function calcC5Adjustments(form) {
  const adj = {};
  let online = 5;
  if (form.onlineExp === "있음") online += 2;
  else if (form.onlineExp === "일부 있음") online += 1;
  else if (form.onlineExp === "없음") online -= 1;
  if (form.claimExp === "있음") online += 1;
  if (form.timeAvail === "충분히 가능") online += 1;
  else if (form.timeAvail === "어려움") online -= 2;
  adj["직거래(온라인)"] = Math.max(2, Math.min(9, online));

  let local = 6;
  if (form.localAccess === "좋음") local += 2;
  else if (form.localAccess === "보통") local += 0;
  else if (form.localAccess === "낮음") local -= 2;
  if (form.packCapable === "가능") local += 1;
  else if (form.packCapable === "어려움") local -= 1;
  adj["직거래(로컬푸드)"] = Math.max(2, Math.min(9, local));

  let sji = 7;
  if (form.storage === "낮음") sji += 1;
  if (form.timeAvail === "어려움") sji += 1;
  adj["산지유통인"] = Math.max(2, Math.min(9, sji));

  return adj;
}

// ─── 레이어1 AI 분석 프롬프트 생성 (v8과 동일) ───────────────
function buildLayer1Prompt(form, behaviorAnswers, farmerType, topsisResult) {
  const typeInfo = TYPE_INFO[farmerType.type];
  const topRoutes = topsisResult.slice(0, 3).map((r) => `${r.route}(${r.score}점)`).join(", ");

  return `당신은 농가의 판매경로 포트폴리오를 진단하고 추천하는 농업유통 컨설턴트다.
이 분석은 규칙기반 진단이며 실제 통계모형이 아님을 명확히 밝혀라.

[판매경로 5개로 한정]
도매시장 / 생산자단체(조직출하) / 직거래(온라인) / 직거래(로컬푸드) / 산지유통인

[농가 입력 정보]
- 품목: ${form.crop || "미입력"}
- 품종: ${form.variety || "미입력"}
- 재배면적: ${form.area || "미입력"}
- 연간 출하 물량: ${form.volume || "미입력"}
- 출하 가능 기간: ${form.shippingPeriod || "미입력"}
- 저장성: ${form.storage || "미입력"}
- 상/중/하품 비율: ${form.gradeRatio || "미입력"}
- 농가주 연령: ${form.age || "미입력"}
- 가족노동력: ${form.labor || "미입력"}명
- 판매·포장 가능 구성원: ${form.packMember || "미입력"}
- 직접 판매 경험: ${form.directSaleExp || "미입력"}
- 도매시장 출하 경험: ${form.wholesaleExp || "미입력"}
- 온라인 판매 경험: ${form.onlineExp || "미입력"}
- 로컬푸드·직거래 경험: ${form.localExp || "미입력"}
- 고객응대·클레임 대응 경험: ${form.claimExp || "미입력"}
- 추가 시간 투입 가능: ${form.timeAvail || "미입력"}
- 협상·거래 응대 부담: ${form.negotiation || "미입력"}
- 현재 판매경로: ${form.currentRoutes || "미입력"}
- 지역: ${form.region || "미입력"}
- 특이사항: ${form.special || "없음"}

[행동 기반 성향 진단 결과]
- Q1(가격대응): ${BEHAVIOR_QUESTIONS[0].options[behaviorAnswers.q1]?.label || "미응답"}
- Q2(판로시도): ${BEHAVIOR_QUESTIONS[1].options[behaviorAnswers.q2]?.label || "미응답"}
- Q3(불만사항): ${BEHAVIOR_QUESTIONS[2].options[behaviorAnswers.q3]?.label || "미응답"}
- Q4(클레임경험): ${BEHAVIOR_QUESTIONS[3].options[behaviorAnswers.q4]?.label || "미응답"}
- Q5(출하결정): ${BEHAVIOR_QUESTIONS[4].options[behaviorAnswers.q5]?.label || "미응답"}
- 점수: profit=${farmerType.profit}, stable=${farmerType.stable}, challenge=${farmerType.challenge}, org=${farmerType.org}
- 농가 유형: ${farmerType.type}형 (${typeInfo.label}) — ${typeInfo.desc}

[TOPSIS 사전 점수 (참고용)]
${topsisResult.map((r) => `- ${r.route}: ${r.score}점`).join("\n")}
TOPSIS 상위 3개 경로: ${topRoutes}

[분석 출력 순서 — 반드시 이 순서로 한국어로 답하라]

**1. 입력 현실성 점검**
- 입력값 모순 여부, 비현실적 더미 여부
- 추가 확인 필요한 핵심 변수 (있으면)

**2. 농가 핵심 특성 요약**
- 품목·품종·면적·물량·출하기간·저장성·노동력·판매역량·성향 요약 (3~5줄)

**3. 정성지표 판정**
- 마케팅·판매운영 역량 (전반): 낮음/보통/높음 + 판정 근거
- 온라인 직거래 역량: 낮음/보통/높음 + 판정 근거
- 도전성향: 낮음/보통/높음
- 안정성 선호: 낮음/보통/높음
- 협상·대면 대응 성향: 부담/보통/선호

**4. 5개 판매경로별 평가**
각 경로마다: 판정(진입 가능/조건부 가능/비추천) | 점수(100점 만점) | 근거(가점·감점 변수 서술)
도매시장 / 생산자단체(조직출하) / 직거래(온라인) / 직거래(로컬푸드) / 산지유통인
- 점수는 TOPSIS 사전 점수를 기준으로 농가 역량 변수로 조정하되, 규칙기반 종합판단임을 명시

**5. 추천 포트폴리오**
- 현재 즉시 실행안: 최대 3개 경로, 합계 100%, 주력 40~60% / 보완 20~40% / 완충 10~30%
- 준비 후 확대안: 필요할 때만 제시
- 직거래(온라인)과 직거래(로컬푸드) 동시 포함 시 합산 노동부담 검토 결과 반드시 포함

**6. 추천 사유**
- 왜 이 경로 조합인지 (어떤 변수가 결정적이었는지)
- 왜 다른 경로는 주력이 아닌지

**7. 경로별 경쟁력 강화 과제**
생산·수확관리 / 선별·규격화 / 포장·소포장 / 판매·마케팅(온라인 채널 포함) / 조직화·계약 / 비상품 처리

**8. 현재 구조와의 비교** (현재 판매경로 정보가 있는 경우만)
- 현재 대비 기대 장점 / 추가 부담 / 방향성 비교 (수익 수치 근거 없으면 방향성만)

**9. 한줄 결론**
이 농가의 최적 판매전략을 한 문장으로 요약

[중요 제한]
- "상황에 따라 다르다"로 끝내지 마라
- 근거 없는 수익 수치 절대 제시 금지
- 교육 이수만으로 역량 높게 평가 금지
- 비현실적 입력이면 먼저 경고
- 품종과 저장성, 출하 가능 기간을 반드시 핵심 변수로 반영
- 산지유통인 평가 시 단가 열세를 인정하되 비용·시간 절감 효과 함께 설명
- 직거래(온라인)과 직거래(로컬푸드)는 항상 별도 경로로 평가`;
}

// ─── 레이어2 AI 프롬프트 생성 (v8과 동일) ────────────────────
function buildLayer2Prompt(layer1Result, layer2Form) {
  return `당신은 농가의 이번 출하 경로를 결정하는 농업유통 컨설턴트다.
이 분석은 규칙기반 진단이며 실제 통계모형이 아님을 명확히 밝혀라.
시황 데이터가 있으면 반영하고, 없으면 농가 조건만으로 판단한다.

[레이어1 기준선]
- 품목: ${layer2Form.crop || "미입력"} / 저장성: ${layer2Form.storage || "미입력"}
- 추천 포트폴리오: ${layer1Result || "레이어1 결과 없음 (직접 입력됨)"}
- 주력 경로: ${layer2Form.mainRoute || "미입력"}
- 보완 경로: ${layer2Form.subRoute || "없음"}
- 완충 경로: ${layer2Form.bufferRoute || "없음"}
- 판매 역량: ${layer2Form.capability || "보통"}

[이번 출하 현황]
- 이번 수확 예상 물량: ${layer2Form.thisVolume || "미입력"} kg
- 저장 가능 여부: ${layer2Form.canStore || "미입력"}
- 잔여 저장 가능 기간: ${layer2Form.storeDays || "미입력"}
- 이번 상/중/하품 비율: ${layer2Form.gradeRatio || "미입력"}
- 이번 품질 수준: ${layer2Form.quality || "미입력"}
- 긴급 출하 사유: ${layer2Form.urgent || "없음"}
- 이번 주 특이사항: ${layer2Form.special || "없음"}

[경로별 이번 주 수용 가능 여부]
- 직거래(온라인) 주문·예약 물량: ${layer2Form.onlineOrder || "없음"}
- 직거래(로컬푸드) 매장 진열 가능: ${layer2Form.localAvail || "미입력"}
- 산지유통인 수집 가능: ${layer2Form.sjiAvail || "미입력"}
- 생산자단체·농협 공동출하 가능: ${layer2Form.orgAvail || "미입력"}

[시황 변수]
- 현재 도매 시장가: ${layer2Form.curPrice || "미입력"}
- 평년 대비 현재가 수준: ${layer2Form.priceVsAvg || "모름"}
- 최근 2주 가격 추이: ${layer2Form.priceTrend || "모름"}
- 경쟁 산지 출하 동향: ${layer2Form.competition || "모름"}

[출력 구조 — 반드시 이 순서로 한국어로 답하라]

**1. 이번 출하 상황 요약**
핵심 변수 3~5개만 (물량, 저장성, 품질, 긴급 여부, 시황)

**2. 출하 타이밍 판정**
즉시 출하 / 분할 출하 / 대기 권고 중 하나를 명확히 결정하고 근거 제시

**3. 경로 선택 및 물량 배분**
- 1순위 경로: Xkg (Y%)
- 2순위 경로: Xkg (Y%)
- 3순위 경로(있으면): Xkg (Y%)
- 합계: 총 수확량 kg
물량 수치가 있으면 반드시 kg 단위 배분 포함

**4. 판단 근거**
왜 이 경로 조합인지, 어떤 변수가 결정적이었는지

**5. 비상품·하품 처리 방향**
하품 발생량 처리 경로 및 방법

**6. 이번 출하 실행 체크리스트**
3~5개 항목 (구체적으로)

**7. 한줄 결론**
이번 출하 핵심 결정을 한 문장으로

[중요 제한]
- 수익 수치 근거 없이 제시 금지
- "상황에 따라 다르다"로 끝내지 말 것
- 경로 선택 결과를 명확하게 제시
- 물량 수치가 있으면 반드시 kg 단위 배분 포함
- 저장성 낮으면 즉시 출하 원칙 우선 적용
- 직거래 주문 있으면 상품 우선 배분`;
}

// ─── API 호출 ──────────────────────────────────────────────────
// 브라우저가 Anthropic API를 직접 호출하지 않고, server.js(로컬 백엔드)를 거칩니다.
// API 키는 .env에만 있고 이 프론트엔드 코드에는 들어가지 않습니다.
// Anthropic/서버 오류 본문을 사람이 읽을 수 있는 한국어 안내로 변환
function friendlyApiError(status, rawBody) {
  let msg = rawBody || "";
  // 서버가 { error: "<문자열 또는 JSON 문자열>" } 형태로 감싸 보내므로 이중 파싱
  try {
    const outer = JSON.parse(rawBody);
    msg = outer.error ?? rawBody;
    const inner = JSON.parse(msg);
    msg = inner?.error?.message ?? msg;
  } catch { /* 평문이면 그대로 사용 */ }

  const low = msg.toLowerCase();
  if (low.includes("credit balance is too low") || low.includes("billing"))
    return "Anthropic API 크레딧 잔액이 부족합니다. console.anthropic.com → Plans & Billing 에서 크레딧을 충전한 뒤 다시 시도하세요. (.env 의 ANTHROPIC_API_KEY 계정 기준)";
  if (status === 401 || low.includes("authentication") || low.includes("invalid x-api-key"))
    return "Anthropic API 키가 유효하지 않습니다. .env 의 ANTHROPIC_API_KEY 를 확인하세요.";
  if (status === 429 || low.includes("rate limit"))
    return "Anthropic API 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.";
  if (status === 529 || low.includes("overloaded"))
    return "Anthropic 서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도하세요.";
  if (status === 0 || low.includes("failed to fetch"))
    return "백엔드 서버에 연결하지 못했습니다. server.js(포트 3001)가 실행 중인지 확인하세요.";
  return `API 오류 (${status}): ${msg || "서버 응답 없음. server.js가 실행 중인지 확인하세요."}`;
}

async function callClaude(prompt, onChunk) {
  let response;
  try {
    response = await fetch("http://localhost:3001/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
  } catch (e) {
    throw new Error(friendlyApiError(0, e.message));
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(friendlyApiError(response.status, errBody));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    const lines = chunk.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "content_block_delta" && parsed.delta?.text) {
            fullText += parsed.delta.text;
            onChunk(fullText);
          }
        } catch {}
      }
    }
  }
  return fullText;
}

// ─── 마크다운 렌더러 (다크 테마) ───────────────────────────────
function SimpleMarkdown({ text }) {
  if (!text) return null;
  const lines = text.split("\n");
  return (
    <div style={{ lineHeight: 1.8 }}>
      {lines.map((line, i) => {
        if (line.startsWith("**") && line.endsWith("**") && line.length > 4) {
          return (
            <div key={i} style={{ fontWeight: 700, color: theme.text, marginTop: 16, marginBottom: 4, fontSize: 15, borderLeft: `3px solid ${theme.accent}`, paddingLeft: 10 }}>
              {line.replace(/\*\*/g, "")}
            </div>
          );
        }
        if (line.startsWith("- ")) {
          return <div key={i} style={{ paddingLeft: 16, color: theme.textMuted, fontSize: 14, marginBottom: 2 }}>• {line.slice(2)}</div>;
        }
        if (line.match(/^\d+\./)) {
          return <div key={i} style={{ paddingLeft: 16, color: theme.textMuted, fontSize: 14, marginBottom: 2 }}>{line}</div>;
        }
        if (line.trim() === "") return <div key={i} style={{ height: 8 }} />;
        return <div key={i} style={{ color: theme.textMuted, fontSize: 14 }}>{line}</div>;
      })}
    </div>
  );
}

// ─── 점수 배지 (다크 테마) ──────────────────────────────────────
function ScoreBadge({ score }) {
  const color = score >= 80 ? theme.accent : score >= 60 ? theme.info : score >= 40 ? theme.warn : theme.danger;
  const text = score >= 80 ? "주력 후보" : score >= 60 ? "보완 후보" : score >= 40 ? "제한적" : "비추천";
  return (
    <span style={{ background: color, color: "#06210f", borderRadius: 20, padding: "2px 10px", fontSize: 13, fontWeight: 700 }}>
      {score}점 · {text}
    </span>
  );
}

// ─── 진행 단계 바 (다크 테마) ────────────────────────────────
const STEPS = ["기본 정보", "성향 진단", "포트폴리오 분석", "출하 결정"];

function StepBar({ current }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 28 }}>
      {STEPS.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", flex: 1 }}>
          <div style={{
            width: 30, height: 30, borderRadius: "50%",
            background: i <= current ? theme.accent : theme.panelBorder,
            color: i <= current ? "#06210f" : theme.textFaint,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 12, flexShrink: 0,
          }}>{i + 1}</div>
          <div style={{ fontSize: 12, color: i <= current ? theme.accent : theme.textFaint, marginLeft: 6, fontWeight: i === current ? 700 : 400, flex: 1, whiteSpace: "nowrap" }}>{s}</div>
          {i < STEPS.length - 1 && <div style={{ height: 2, flex: 1, background: i < current ? theme.accent : theme.panelBorder, margin: "0 6px" }} />}
        </div>
      ))}
    </div>
  );
}

// ─── 스타일 토큰 (다크 테마) ────────────────────────────────────
const cardStyle = { background: theme.panel, borderRadius: 14, padding: 24, marginBottom: 18, border: `1px solid ${theme.panelBorder}` };
const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: 8, border: `1.5px solid ${theme.panelBorder}`, fontSize: 14, outline: "none", background: theme.panelAlt, color: theme.text, boxSizing: "border-box", fontFamily: "inherit" };
const selectStyle = { ...inputStyle };
const btnPrimary = { background: theme.accent, color: "#06210f", border: "none", borderRadius: 10, padding: "12px 28px", fontSize: 15, fontWeight: 700, cursor: "pointer", letterSpacing: 0.5 };
const btnSecondary = { background: theme.panelAlt, color: theme.accent, border: `1.5px solid ${theme.accent}`, borderRadius: 10, padding: "10px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const labelStyle = { fontSize: 13, color: theme.textMuted, fontWeight: 600, marginBottom: 5, display: "block" };

// ─── 메인 컴포넌트 ──────────────────────────────────────────────
export default function PortfolioDiagnosis() {
  const [cases, setCases] = useState(null);
  const [selectedCaseId, setSelectedCaseId] = useState("");

  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    crop: "", variety: "", area: "", volume: "", shippingPeriod: "",
    storage: "", gradeRatio: "", age: "", labor: "", packMember: "",
    directSaleExp: "", wholesaleExp: "", onlineExp: "", localExp: "",
    claimExp: "", timeAvail: "", negotiation: "", currentRoutes: "",
    region: "", special: "", localAccess: "", packCapable: "",
  });
  const [behaviorAnswers, setBehaviorAnswers] = useState({});
  const [farmerType, setFarmerType] = useState(null);
  const [topsisResult, setTopsisResult] = useState(null);
  const [layer1Output, setLayer1Output] = useState("");
  const [layer1Loading, setLayer1Loading] = useState(false);
  const [layer2Form, setLayer2Form] = useState({
    thisVolume: "", canStore: "", storeDays: "", gradeRatio: "",
    quality: "", urgent: "", special: "", onlineOrder: "", localAvail: "",
    sjiAvail: "", orgAvail: "", curPrice: "", priceVsAvg: "", priceTrend: "",
    competition: "", mainRoute: "", subRoute: "", bufferRoute: "", capability: "",
  });
  const [layer2Output, setLayer2Output] = useState("");
  const [layer2Loading, setLayer2Loading] = useState(false);
  const outputRef = useRef(null);
  const output2Ref = useRef(null);

  // 사례 선택용 데이터 로드
  useEffect(() => {
    let alive = true;
    loadRdaCases().then(({ items }) => { if (alive) setCases(items); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  function applyCase(caseId) {
    setSelectedCaseId(caseId);
    const c = (cases || []).find((x) => x.id === caseId);
    if (!c) return;
    setForm((prev) => ({ ...prev, ...c.form }));
    // 예시 케이스처럼 q1~q5가 null인 항목은 건너뛰어, 실제 숫자 응답만 반영합니다.
    const validAnswers = Object.fromEntries(
      Object.entries(c.behaviorAnswers || {}).filter(([, v]) => typeof v === "number")
    );
    setBehaviorAnswers(validAnswers);
  }

  const updateForm = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const updateL2 = (k, v) => setLayer2Form((p) => ({ ...p, [k]: v }));

  const allBehaviorAnswered = BEHAVIOR_QUESTIONS.every((q) => typeof behaviorAnswers[q.id] === "number");

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [layer1Output]);

  useEffect(() => {
    if (output2Ref.current) output2Ref.current.scrollTop = output2Ref.current.scrollHeight;
  }, [layer2Output]);

  async function runLayer1() {
    const ft = classifyFarmerType(behaviorAnswers);
    const c5 = calcC5Adjustments(form);
    const topsis = calcTOPSIS(ft.type, c5);
    setFarmerType(ft);
    setTopsisResult(topsis);

    const top = topsis[0]?.route || "";
    const second = topsis[1]?.route || "";
    const third = topsis[2]?.route || "";
    setLayer2Form((p) => ({
      ...p,
      crop: form.crop, storage: form.storage,
      mainRoute: top, subRoute: second, bufferRoute: third,
      capability: ft.type === "A" ? "높음" : ft.type === "D" ? "낮음" : "보통",
    }));

    setLayer1Loading(true);
    setLayer1Output("");
    setStep(2);
    try {
      const prompt = buildLayer1Prompt(form, behaviorAnswers, ft, topsis);
      await callClaude(prompt, (txt) => setLayer1Output(txt));
    } catch (e) {
      setLayer1Output("⚠️ 분석 중 오류가 발생했습니다: " + e.message);
    } finally {
      setLayer1Loading(false);
    }
  }

  async function runLayer2() {
    setLayer2Loading(true);
    setLayer2Output("");
    setStep(3);
    try {
      const prompt = buildLayer2Prompt(layer1Output ? "레이어1 분석 완료 (위 결과 참고)" : null, { ...layer2Form, crop: form.crop, storage: form.storage });
      await callClaude(prompt, (txt) => setLayer2Output(txt));
    } catch (e) {
      setLayer2Output("⚠️ 분석 중 오류가 발생했습니다: " + e.message);
    } finally {
      setLayer2Loading(false);
    }
  }

  const fieldGroup = (lbl, key, type = "text", opts = null) => (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{lbl}</label>
      {opts ? (
        <select style={selectStyle} value={form[key]} onChange={(e) => updateForm(key, e.target.value)}>
          <option value="">선택하세요</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input style={inputStyle} type={type} value={form[key]} onChange={(e) => updateForm(key, e.target.value)} placeholder={lbl} />
      )}
    </div>
  );

  const l2Field = (lbl, key, opts = null) => (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{lbl}</label>
      {opts ? (
        <select style={selectStyle} value={layer2Form[key]} onChange={(e) => updateL2(key, e.target.value)}>
          <option value="">선택하세요</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input style={inputStyle} value={layer2Form[key]} onChange={(e) => updateL2(key, e.target.value)} placeholder={lbl} />
      )}
    </div>
  );

  const nonExampleCases = (cases || []).filter((c) => !c._example);

  return (
    <div>
      <h2 style={{ color: theme.text, fontSize: 18, margin: 0 }}>판매경로 진단</h2>
      <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 6, marginBottom: 16 }}>
        LAYER 1 · 농진청 v4 프롬프트 기반 · 행동기반 5문항 분류 + TOPSIS 규칙기반 점수
      </p>

      {/* 사례 선택 (기본 정보 단계에서만 노출) */}
      {step === 0 && (
        <div style={cardStyle}>
          <label style={labelStyle}>사례 선택 (선택사항)</label>
          <select
            style={selectStyle}
            value={selectedCaseId}
            onChange={(e) => applyCase(e.target.value)}
          >
            <option value="">— 가상 농가 케이스 선택 (또는 아래에 직접 입력) —</option>
            {nonExampleCases.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          {nonExampleCases.length === 0 && (
            <div style={{ color: theme.textFaint, fontSize: 12, marginTop: 8 }}>
              아직 public/data/rda-cases.json에 실제 케이스가 없습니다. 추가하면 여기에 자동으로 나타납니다.
            </div>
          )}
        </div>
      )}

      <StepBar current={step} />

      {/* ── STEP 0: 기본 정보 ── */}
      {step === 0 && (
        <div>
          <div style={cardStyle}>
            <h3 style={{ fontSize: 16, color: theme.text, marginTop: 0, marginBottom: 20 }}>📋 기본 생산·출하 조건</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
              {fieldGroup("품목 *", "crop")}
              {fieldGroup("품종 *", "variety")}
              {fieldGroup("재배면적 (㎡ 또는 평)", "area")}
              {fieldGroup("연간 출하 물량 (톤 또는 kg)", "volume")}
              {fieldGroup("출하 가능 기간 (예: 11월~5월)", "shippingPeriod")}
              {fieldGroup("저장성", "storage", "text", ["낮음 (2~3일)", "보통 (1~2주)", "높음 (1개월 이상)"])}
              {fieldGroup("상/중/하품 비율 (예: 상60 중30 하10)", "gradeRatio")}
              {fieldGroup("지역", "region")}
            </div>
          </div>

          <div style={cardStyle}>
            <h3 style={{ fontSize: 16, color: theme.text, marginTop: 0, marginBottom: 20 }}>👥 노동력 조건</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
              {fieldGroup("농가주 연령", "age", "number")}
              {fieldGroup("가족노동력 수 (명)", "labor", "number")}
              {fieldGroup("판매·포장 가능 구성원", "packMember", "text", ["있음", "없음"])}
            </div>
          </div>

          <div style={cardStyle}>
            <h3 style={{ fontSize: 16, color: theme.text, marginTop: 0, marginBottom: 20 }}>💼 판매 운영 역량</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
              {fieldGroup("직접 판매 경험", "directSaleExp", "text", ["없음", "단기", "지속적"])}
              {fieldGroup("도매시장 출하 경험", "wholesaleExp", "text", ["없음", "있음"])}
              {fieldGroup("온라인 판매 경험", "onlineExp", "text", ["없음", "일부 있음", "있음"])}
              {fieldGroup("로컬푸드·직거래 경험", "localExp", "text", ["없음", "일부 있음", "있음"])}
              {fieldGroup("고객응대·클레임 대응 경험", "claimExp", "text", ["없음", "있음"])}
              {fieldGroup("추가 시간 투입 가능 여부", "timeAvail", "text", ["어려움", "일부 가능", "충분히 가능"])}
              {fieldGroup("협상·거래 응대 부담", "negotiation", "text", ["부담됨", "보통", "괜찮음"])}
              {fieldGroup("로컬푸드 매장 접근성", "localAccess", "text", ["낮음", "보통", "좋음"])}
              {fieldGroup("포장 대응 가능 여부", "packCapable", "text", ["어려움", "가능"])}
            </div>
          </div>

          <div style={cardStyle}>
            <h3 style={{ fontSize: 16, color: theme.text, marginTop: 0, marginBottom: 20 }}>📌 참고 정보</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
              {fieldGroup("현재 판매경로 비중 (예: 도매80% 로컬20%)", "currentRoutes")}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>특이사항</label>
                <input style={inputStyle} value={form.special} onChange={(e) => updateForm("special", e.target.value)} placeholder="특이사항 자유 입력" />
              </div>
            </div>
          </div>

          <div style={{ textAlign: "center" }}>
            <button style={btnPrimary} onClick={() => {
              if (!form.crop || !form.variety) { alert("품목과 품종은 필수입니다."); return; }
              setStep(1);
            }}>
              다음: 성향 진단 →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 1: 행동 기반 성향 진단 ── */}
      {step === 1 && (
        <div>
          <div style={{ ...cardStyle, background: `${theme.accent}10`, border: `1px solid ${theme.accent}30` }}>
            <h3 style={{ fontSize: 16, color: theme.text, marginTop: 0 }}>🧭 행동 기반 성향 진단</h3>
            <p style={{ fontSize: 13, color: theme.textMuted, marginBottom: 0 }}>
              5개 질문에 답하면 농가 유형(A~E형)이 자동 분류되고 TOPSIS 가중치가 결정됩니다.
              과거 경험과 실제 행동을 기반으로 솔직하게 선택해주세요.
            </p>
          </div>

          {BEHAVIOR_QUESTIONS.map((q, qi) => (
            <div key={q.id} style={cardStyle}>
              <div style={{ fontSize: 12, color: theme.accent, fontWeight: 700, marginBottom: 4 }}>Q{qi + 1}. {q.title}</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: theme.text, marginBottom: 16 }}>{q.question}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {q.options.map((opt, oi) => (
                  <button
                    key={oi}
                    onClick={() => setBehaviorAnswers((p) => ({ ...p, [q.id]: oi }))}
                    style={{
                      textAlign: "left", padding: "10px 16px", borderRadius: 8,
                      border: behaviorAnswers[q.id] === oi ? `2px solid ${theme.accent}` : `1.5px solid ${theme.panelBorder}`,
                      background: behaviorAnswers[q.id] === oi ? `${theme.accent}18` : theme.panelAlt,
                      cursor: "pointer", fontSize: 14, fontWeight: behaviorAnswers[q.id] === oi ? 700 : 400,
                      color: behaviorAnswers[q.id] === oi ? theme.text : theme.textMuted,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button style={btnSecondary} onClick={() => setStep(0)}>← 이전</button>
            <button style={{ ...btnPrimary, opacity: allBehaviorAnswered ? 1 : 0.5 }}
              disabled={!allBehaviorAnswered} onClick={runLayer1}>
              {layer1Loading ? "분석 중..." : "포트폴리오 분석 시작 →"}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: 레이어1 결과 ── */}
      {step === 2 && (
        <div>
          {farmerType && (
            <div style={{ ...cardStyle, background: `linear-gradient(135deg, ${TYPE_INFO[farmerType.type].color}33, ${theme.panel})`, borderLeft: `4px solid ${TYPE_INFO[farmerType.type].color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>농가 유형 분류 결과</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: TYPE_INFO[farmerType.type].color }}>
                    {farmerType.type}형 · {TYPE_INFO[farmerType.type].label}
                  </div>
                  <div style={{ fontSize: 13, color: theme.textMuted, marginTop: 4 }}>{TYPE_INFO[farmerType.type].desc}</div>
                  <div style={{ fontSize: 12, color: theme.textFaint, marginTop: 4 }}>
                    profit {farmerType.profit} · stable {farmerType.stable} · challenge {farmerType.challenge} · org {farmerType.org}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: theme.textMuted }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>권장 주력 경로</div>
                  <div style={{ color: TYPE_INFO[farmerType.type].color, fontWeight: 700 }}>{TYPE_INFO[farmerType.type].main}</div>
                </div>
              </div>
            </div>
          )}

          {topsisResult && (
            <div style={cardStyle}>
              <h3 style={{ fontSize: 15, color: theme.text, marginTop: 0, marginBottom: 16 }}>📊 TOPSIS 경로 적합도 점수 (규칙기반)</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {topsisResult.map((r, i) => (
                  <div key={r.route} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 14px", borderRadius: 8,
                    background: i === 0 ? `${theme.accent}15` : theme.panelAlt,
                    border: i === 0 ? `1.5px solid ${theme.accent}` : `1px solid ${theme.panelBorder}`,
                  }}>
                    <div style={{ width: 22, height: 22, borderRadius: "50%", background: i < 3 ? theme.accent : theme.panelBorder, color: "#06210f", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ fontSize: 14, color: theme.text }}>{ROUTE_ICON[r.route]} {r.route}</div>
                    <div style={{ fontSize: 12, color: theme.textFaint, flex: 1 }}>{ROUTE_ROLE[r.route]}</div>
                    <ScoreBadge score={r.score} />
                    <div style={{ width: 80, height: 8, background: theme.panelBorder, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ width: `${r.score}%`, height: "100%", background: r.score >= 80 ? theme.accent : r.score >= 60 ? theme.info : theme.panelBorder, borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, color: theme.text, marginTop: 0, marginBottom: 16 }}>
              🤖 AI 포트폴리오 진단 결과
              {layer1Loading && <span style={{ fontSize: 12, color: theme.accent, marginLeft: 8, fontWeight: 400 }}>분석 중...</span>}
            </h3>
            <div ref={outputRef} style={{ maxHeight: 500, overflowY: "auto", paddingRight: 4 }}>
              {layer1Output ? <SimpleMarkdown text={layer1Output} /> : (
                <div style={{ color: theme.textFaint, fontSize: 14, textAlign: "center", padding: 40 }}>
                  {layer1Loading ? "🌱 분석 중입니다..." : "분석 결과가 여기에 표시됩니다."}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button style={btnSecondary} onClick={() => setStep(1)}>← 성향 재진단</button>
            {!layer1Loading && (
              <button style={btnPrimary} onClick={() => setStep(3)}>
                출하 의사결정 (레이어2) →
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── STEP 3: 레이어2 출하 의사결정 ── */}
      {step === 3 && (
        <div>
          <div style={{ ...cardStyle, background: `${theme.warn}12`, border: `1px solid ${theme.warn}40` }}>
            <h3 style={{ fontSize: 16, color: theme.warn, marginTop: 0 }}>🚚 레이어2 — 이번 출하 의사결정</h3>
            <p style={{ fontSize: 13, color: theme.textMuted, margin: 0 }}>
              레이어1 포트폴리오를 기준선으로, 이번 수확의 실제 출하 경로와 물량 배분을 결정합니다.
            </p>
          </div>

          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, color: theme.text, marginTop: 0, marginBottom: 16 }}>📌 포트폴리오 기준선 (레이어1 결과 자동 연동)</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 16px" }}>
              {l2Field("주력 경로", "mainRoute", ROUTES)}
              {l2Field("보완 경로", "subRoute", ["없음", ...ROUTES])}
              {l2Field("완충 경로", "bufferRoute", ["없음", ...ROUTES])}
              {l2Field("판매 역량 수준", "capability", ["낮음", "보통", "높음"])}
            </div>
          </div>

          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, color: theme.text, marginTop: 0, marginBottom: 16 }}>📦 이번 출하 현황</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
              {l2Field("이번 수확 예상 물량 (kg) *", "thisVolume")}
              {l2Field("저장 가능 여부", "canStore", ["가능", "불가"])}
              {l2Field("잔여 저장 가능 기간", "storeDays", ["1~2일", "3~5일", "1주", "2주 이상"])}
              {l2Field("이번 상/중/하품 비율", "gradeRatio")}
              {l2Field("이번 품질 수준", "quality", ["균일하고 좋음", "보통", "품질 편차 큼"])}
              {l2Field("긴급 출하 사유", "urgent", ["없음", "부패 우려", "자금 필요", "기타"])}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>이번 주 특이사항</label>
                <input style={inputStyle} value={layer2Form.special} onChange={(e) => updateL2("special", e.target.value)} placeholder="특이사항 입력" />
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, color: theme.text, marginTop: 0, marginBottom: 16 }}>✅ 이번 주 경로별 수용 가능 여부</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
              {l2Field("직거래(온라인) 주문·예약 물량", "onlineOrder", ["없음", "소량 (~50kg)", "중량 (50~200kg)", "대량 (200kg~)"])}
              {l2Field("직거래(로컬푸드) 매장 진열 가능", "localAvail", ["가능", "불가", "해당없음"])}
              {l2Field("산지유통인 수집 가능", "sjiAvail", ["가능", "불가", "해당없음"])}
              {l2Field("생산자단체·농협 공동출하 가능", "orgAvail", ["가능", "불가", "해당없음"])}
            </div>
          </div>

          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, color: theme.text, marginTop: 0, marginBottom: 16 }}>📈 시황 정보 (수동 입력 / KAMIS 연동 예정)</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>현재 도매 시장가 (원/kg)</label>
                <input style={inputStyle} value={layer2Form.curPrice} onChange={(e) => updateL2("curPrice", e.target.value)} placeholder="예: 3500" />
              </div>
              {l2Field("평년 대비 현재가 수준", "priceVsAvg", ["평년 이상 (110%~)", "평년 수준 (90~110%)", "평년 이하 (~90%)", "모름"])}
              {l2Field("최근 2주 가격 추이", "priceTrend", ["상승", "횡보", "하락", "모름"])}
              {l2Field("경쟁 산지 출하 동향", "competition", ["출하 집중", "보통", "출하 적음", "모름"])}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button style={btnSecondary} onClick={() => setStep(2)}>← 포트폴리오 분석으로</button>
            <button style={btnPrimary} onClick={runLayer2} disabled={layer2Loading || !layer2Form.thisVolume}>
              {layer2Loading ? "분석 중..." : "출하 경로 결정 →"}
            </button>
          </div>

          {(layer2Output || layer2Loading) && (
            <div style={{ ...cardStyle, marginTop: 24 }}>
              <h3 style={{ fontSize: 15, color: theme.text, marginTop: 0, marginBottom: 16 }}>
                🚚 출하 의사결정 결과
                {layer2Loading && <span style={{ fontSize: 12, color: theme.accent, marginLeft: 8, fontWeight: 400 }}>분석 중...</span>}
              </h3>
              <div ref={output2Ref} style={{ maxHeight: 600, overflowY: "auto", paddingRight: 4 }}>
                {layer2Output ? <SimpleMarkdown text={layer2Output} /> : (
                  <div style={{ color: theme.textFaint, fontSize: 14, textAlign: "center", padding: 40 }}>🌱 분석 중입니다...</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ textAlign: "center", marginTop: 24, fontSize: 12, color: theme.textFaint }}>
        규칙기반 진단 시스템 · 실제 통계모형이 아님을 명확히 밝힙니다<br />
        KAMIS 연동 예정 (현재 수동 입력) · 프롬프트 v4 기준
      </div>
    </div>
  );
}
