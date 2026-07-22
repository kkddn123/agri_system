import { useState, useEffect, useRef } from "react";
import { theme, card } from "../theme";
import { loadRdaCases, loadPublicDatasets, loadIncomeData, loadShippingGuides } from "../lib/dataLoader";
import { CROP_REGISTRY, findCrop } from "../lib/cropRegistry";

// 이 파일은 농가판매경로_AI시스템.jsx(v8)의 로직(행동기반 5문항 분류, TOPSIS 계산,
// Layer1/Layer2 프롬프트)을 가져와 AGR 대시보드의 다크 테마 탭 안에 옮긴 것입니다.
// v8 대비 수정: BASE_SCORES의 C3(노동부담)를 실제 편익형으로 반전(v8은 원시 부담값을
// 그대로 써서 "부담이 클수록 유리"하게 계산되는 결함이 있었음). 그 외 가중치·분류 규칙은 동일.

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

// 기본 점수 행렬 — 모든 열이 편익형(높을수록 유리).
// C3(노동부담)는 원시 부담값(도매 2, 온라인 7 등)을 10-x로 반전한 값이다:
// 부담이 적은 경로일수록 높은 점수 (도매·산지유통인 8, 온라인 3).
const BASE_SCORES = {
  "도매시장":            [5, 9, 8, 6, 9],
  "생산자단체(조직출하)": [6, 8, 7, 8, 8],
  "직거래(온라인)":       [9, 4, 3, 5, 5],
  "직거래(로컬푸드)":     [7, 5, 5, 6, 6],
  "산지유통인":           [4, 8, 8, 6, 8],
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

// ─── C5 진입가능성 자동 조정 ──────────────────────────────────
function calcC5Adjustments(form) {
  const adj = {};

  // 온라인 진입가능성: 경험·포장·시간·연령·노동력 모두 반영
  let online = 4; // 기본값 하향 (기존 5 → 4)

  // 온라인 판매 경험 (핵심 변수)
  if (form.onlineExp === "있음") online += 3;
  else if (form.onlineExp === "일부 있음") online += 1;
  else if (form.onlineExp === "없음") online -= 2; // 기존 -1 → -2

  // 포장 대응: 온라인은 개별 소포장 필수 — 불가면 사실상 진입 불가
  if (form.packCapable === "어려움") online -= 3;
  else if (form.packCapable === "가능") online += 1;

  // 추가 시간 투입 (온라인은 주문처리·배송 상시 대응 필요)
  if (form.timeAvail === "충분히 가능") online += 1;
  else if (form.timeAvail === "일부 가능") online -= 1;
  else if (form.timeAvail === "어려움") online -= 3; // 기존 -2 → -3

  // 클레임·반품 대응 경험 (온라인 고객 응대 핵심)
  if (form.claimExp === "있음") online += 1;
  else if (form.claimExp === "없음") online -= 1;

  // 연령 제약 (스마트기기·플랫폼 활용 난이도)
  const age = parseInt(form.age) || 0;
  if (age >= 70) online -= 3;
  else if (age >= 65) online -= 2;
  else if (age >= 60) online -= 1;

  // 노동력 부족 (가족 1명이면 주문처리·배송·농작업 병행 불가)
  const labor = parseInt(form.labor) || 0;
  if (labor <= 1) online -= 1;

  adj["직거래(온라인)"] = Math.max(1, Math.min(9, online));

  let local = 6;
  if (form.localAccess === "좋음") local += 2;
  else if (form.localAccess === "보통") local += 0;
  else if (form.localAccess === "낮음") local -= 2;
  if (form.packCapable === "가능") local += 1;
  else if (form.packCapable === "어려움") local -= 1;
  adj["직거래(로컬푸드)"] = Math.max(2, Math.min(9, local));

  let sji = 7;
  // 저장성 입력값은 "낮음 (2~3일)" 형식이므로 접두어로 판정
  if (String(form.storage || "").startsWith("낮음")) sji += 1;
  if (form.timeAvail === "어려움") sji += 1;
  adj["산지유통인"] = Math.max(2, Math.min(9, sji));

  return adj;
}

// ─── 소득자료(AMIS) 연계: 작목 매칭 + 수익성·원가 근거 ──────────
// 작형 접두어 — 소득자료 작목명에서 떼어내 "핵심 작목명"을 얻는다
const FORM_PREFIXES = ["노지", "시설", "봄", "가을", "겨울", "여름", "고랭지", "촉성", "반촉성", "억제", "조생", "중생", "만생", "수경", "토경"];
function coreName(s) {
  let x = String(s || "").replace(/\(.*?\)/g, "").trim(); // 괄호 주석 제거: 시설단고추(피망)→시설단고추
  for (;;) {
    const p = FORM_PREFIXES.find((pre) => x.startsWith(pre) && x.length > pre.length);
    if (!p) break;
    x = x.slice(p.length);
  }
  return x;
}

// 농가 입력 품목명 → income-data.json 작목 매칭 (정밀: 핵심 작목명 일치만 인정)
// "고추"→시설단고추(피망), "배추"→양배추 같은 오매칭을 막기 위해 부분일치는 쓰지 않는다.
function findIncome(cropName, list) {
  if (!cropName) return null;
  const arr = list || [];
  const t = cropName.trim();
  const tc = coreName(t);
  // 같은 핵심명 후보가 여럿이면 괄호 없는 쪽(일반 작형)을 먼저 쓴다.
  // "토마토" 입력에 시설토마토(수경)이 잡히던 문제 방지 — 수경·억제 등은 특수 작형이라
  // 입력에 그 표기가 없으면 대표 작형으로 보지 않는다.
  const byCore = (key) => {
    const hits = arr.filter((c) => coreName(c.name) === key);
    if (!hits.length) return null;
    return hits.find((c) => !c.name.includes("(")) || hits[0];
  };
  return (
    arr.find((c) => c.name === t) || // 1) 정확히 동일
    byCore(t) ||                     // 2) 작형 떼면 입력과 동일 (예: 입력"감자"→봄감자)
    byCore(tc) ||                    // 3) 양쪽 핵심 동일 (예: 입력"노지고추"→고추)
    null
  );
}

// 매칭된 소득자료로 비중·비교를 계산해 화면/프롬프트 공용으로 반환
function deriveIncomeEvidence(bench, curPriceStr) {
  if (!bench) return null;
  const mgmt = bench.management_cost_per_10a || 0;
  const costs = bench.costs || {};
  const pct = (v) => (mgmt && v != null ? Math.round((v / mgmt) * 1000) / 10 : null);
  const curPrice = parseFloat(curPriceStr);
  const avgPrice = bench.unit_price_per_kg || 0;
  const priceGapPct =
    curPrice && avgPrice ? Math.round(((curPrice - avgPrice) / avgPrice) * 1000) / 10 : null;
  return {
    name: bench.name,
    avgPrice,
    incomeRate: bench.income_rate_pct,
    income10a: bench.income_per_10a,
    laborShare: pct(costs.hired_labor),       // 고용노동비 비중(%)
    materialsShare: pct(costs.materials),     // 중간재비 비중(%)
    pesticideShare: pct(costs.pesticide),     // 농약비 비중(%)
    curPrice: Number.isFinite(curPrice) ? curPrice : null,
    priceGapPct,
  };
}

// 레이어1 프롬프트에 넣을 [수익성·원가 기준선] 블록 문자열
// actual: 농가 입력값으로 계산한 실제 소득률 등 (선택 입력에 따라 일부 null 가능)
// bench : KAMIS 연평균 도매·소매가(원/kg). 농가 단가의 비교 기준은 이쪽을 쓴다 —
//         AMIS 단가는 '전국 농가 평균 수취가'라 내 수취가와 견줘도 유통 구조가 드러나지 않는다.
function buildIncomeBlock(ev, inputCrop, actual, bench) {
  const benchLines = [];
  if (bench?.wholesale || bench?.retail) {
    benchLines.push(`[시장 시세 기준선 (KAMIS · 서울 도매/소매 · 상품 등급 · 원/kg 환산)]`);
    if (bench.wholesale) benchLines.push(`- 도매 평균: ${bench.wholesale.pricePerKg.toLocaleString()}원/kg (${bench.wholesale.year}년, 원단위 ${bench.wholesale.unit})`);
    if (bench.retail) benchLines.push(`- 소매 평균: ${bench.retail.pricePerKg.toLocaleString()}원/kg (${bench.retail.year}년, 원단위 ${bench.retail.unit})`);
    const cur = ev?.curPrice;
    const amis = ev?.avgPrice;
    if (cur && bench.wholesale) {
      benchLines.push(
        `- 농가 현재 단가: ${cur.toLocaleString()}원/kg (유통상 위치: 도매 평균의 ${Math.round((cur / bench.wholesale.pricePerKg) * 1000) / 10}%` +
          (bench.retail ? ` · 소매 평균의 ${Math.round((cur / bench.retail.pricePerKg) * 1000) / 10}%` : "") + ")"
      );
    }
    // 잘 받는지 판단은 같은 성격(농가 수취가)끼리: 내 단가 vs 전국 농가 평균 수취(AMIS).
    // 농가 수취가는 원래 도매가보다 낮으므로 도매 대비 %로 잘잘못을 가리지 말라고 명시한다.
    if (cur && amis) {
      const vs = Math.round((cur / amis - 1) * 1000) / 10;
      benchLines.push(
        `- 전국 농가 평균 수취단가(${amis.toLocaleString()}원/kg) 대비: ${vs >= 0 ? "+" : ""}${vs}%` +
          (vs >= 10
            ? " → 전국 농가보다 높게 받는 편이다. 이 단가를 만드는 경로(직거래 등)를 유지·확대하는 쪽으로 판단하라."
            : vs <= -10
            ? " → 전국 농가 평균보다 낮다. 등급·선별 문제나 도매 편중을 의심하고, 직거래·고부가 경로 확대를 검토하라."
            : " → 전국 농가 평균 수준이다. 단가를 올리려면 소매가와의 격차를 회수할 직거래 비중 확대를 검토하라.")
      );
    }
    benchLines.push(
      "- 활용 지침: 농가 수취가는 도매가보다 낮은 것이 정상이므로(경매수수료·물류·선별비 차감), 도매 대비 %로 잘잘못을 판단하지 마라. '잘 받는지'는 전국 농가 평균 수취 대비로만 보고, 도매↔소매 격차는 직거래로 회수 가능한 마진의 크기로만 활용하라. 경로별 수익 수치를 지어내지 마라."
    );
  }

  if (!ev) {
    return [
      benchLines.join("\n"),
      "[수익성·원가 기준선]\n- 이 품목은 소득자료(AMIS)에 매칭되는 작목이 없어 일반적인 수익성 기준으로 판단한다. 근거 없는 수익 수치는 만들지 마라.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  const lines = [
    "[수익성·원가 기준선 (AMIS 농축산물 소득자료 · 전국 평균 · 10a 기준)]",
    `- 대상 작목: ${ev.name}${inputCrop && inputCrop !== ev.name ? ` (농가 입력: ${inputCrop})` : ""}`,
    `- 전국 평균 소득률: ${ev.incomeRate ?? "미상"}% / 10a당 소득 ${ev.income10a ? ev.income10a.toLocaleString() + "원" : "미상"}`,
    `- 경영비 구조: 고용노동비 비중 ${ev.laborShare ?? "?"}%, 중간재(자재)비 비중 ${ev.materialsShare ?? "?"}% (이 중 농약비 ${ev.pesticideShare ?? "?"}%)`,
    `- 참고(비교 기준 아님): 전국 농가 평균 수취단가 ${ev.avgPrice ? ev.avgPrice.toLocaleString() + "원/kg" : "미상"} — 농가 단가의 높낮이는 위 도매·소매 시세로 판단하라.`,
  ];
  // 농가가 경영비까지 입력해 실제 소득률이 계산된 경우 — 전국 평균과 직접 비교
  if (actual && actual.incomeRate != null) {
    const gap = ev.incomeRate != null ? Math.round((actual.incomeRate - ev.incomeRate) * 10) / 10 : null;
    lines.push(
      `- 농가 실제 소득률(입력 기반): ${actual.incomeRate.toFixed(1)}%` +
        (gap != null ? ` → 전국 평균 대비 ${gap >= 0 ? "+" : ""}${gap}%p (${gap < 0 ? "낮음" : "높음"})` : "") +
        (actual.income10a != null ? ` · 10a당 소득 약 ${Math.round(actual.income10a).toLocaleString()}원` : "")
    );
  }
  lines.push(
    "- 활용 지침: (1) 고용노동비 비중이 높은 작목이면 노동집약 경로(온라인 소포장 등)의 실행 부담을 반드시 경고하라. (2) 소득자료는 전국 평균 1개뿐이므로 경로별 수익 수치를 지어내지 말고 '방향과 제약'으로만 활용하라."
  );
  if (actual && actual.incomeRate != null) {
    lines.push(
      "- 농가 실제 소득률이 전국 평균보다 낮으면 그 원인(낮은 수취가 또는 높은 경영비)을 '6. 추천 사유'에서 진단하고 경로 전략에 연결하라."
    );
  }
  return [benchLines.join("\n"), lines.join("\n")].filter(Boolean).join("\n\n");
}

// 작목의 KAMIS 연평균 도매·소매가(원/kg) 조회. 코드가 없거나 조회 실패면 null.
// 진단을 막지 않도록 오류는 삼키고, 시세 없으면 프롬프트에서 해당 블록이 빠진다.
async function fetchPriceBenchmark(cropMeta) {
  if (!cropMeta?.kamis?.itemCode) return null;
  const { itemCode, kindCode } = cropMeta.kamis;
  try {
    const res = await fetch(`/api/kamis/benchmark?itemCode=${itemCode}&kindCode=${kindCode || "00"}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.wholesale || json.retail ? json : null;
  } catch {
    return null;
  }
}

// 미입력 선택 항목 — AI가 추측·진단하지 않도록 지시하는 블록
function buildSkipBlock(form) {
  const missing = [];
  if (!form.cost) missing.push("총 경영비 → 실제 소득률·수익성 진단");
  if (!form.curPrice) missing.push("현재 판매단가 → 전국 평균 대비 단가갭 진단");
  if (!form.shippingPeriod) missing.push("출하 가능 기간 → 출하 타이밍 진단");
  if (!form.region) missing.push("지역 → 지역 연계 진단");
  if (!form.defectRate) missing.push("비상품률 → 비상품 처리 경로 진단");
  if (!missing.length) return "";
  return (
    "[미입력 항목 — 추측·진단 금지]\n" +
    "다음 항목은 농가가 입력하지 않았다. 이에 대한 수치·판정·추측을 만들지 말고, 해당 분석을 출력에서 생략하라:\n" +
    missing.map((m) => `- ${m}`).join("\n")
  );
}

// 비상품률 트리거 — 2단계(10% / 20%)
function buildDefectBlock(defectRateStr) {
  const r = parseFloat(defectRateStr);
  if (!(r > 0)) return "";
  if (r >= 20)
    return `[비상품 처리 — 적극 추천 트리거]\n비상품률이 ${r}%로 높다. 비상품(B급) 물량 처리를 위해 가공(즙·건조·잼 등), 못난이 B급 온라인 직거래, 로컬푸드 B급 진열, 산지유통인 일괄처리 등 비상품 전용 판로를 '5. 추천 포트폴리오'와 '7. 경로별 경쟁력 강화 과제'에 반드시 구체적으로 포함하라.`;
  if (r >= 10)
    return `[비상품 처리 — 보완 검토 트리거]\n비상품률이 ${r}%로 다소 있다. 비상품 처리 경로(가공·B급 직거래 등)를 보완적으로 검토해 '7. 경로별 경쟁력 강화 과제'에 언급하라.`;
  return ""; // 10% 미만 — 정상 범위로 보고 별도 추천 없음
}

// 농가 입력값으로 실제 수익성 계산 (선택 입력 → 가능한 지표만, 각각 독립)
function computeEcon(form, bench) {
  const area = parseFloat(form.area);       // 평
  const volume = parseFloat(form.volume);   // kg
  const price = parseFloat(form.curPrice);  // 원/kg
  const cost = parseFloat(form.cost);       // 원 (총 경영비)
  const area10a = area > 0 ? area / 300 : null; // 10a = 300평
  const totalRevenue = volume > 0 && price > 0 ? volume * price : null;
  const income = totalRevenue != null && cost > 0 ? totalRevenue - cost : null;
  const incomeRate = totalRevenue && income != null ? (income / totalRevenue) * 100 : null;
  return {
    area10a,
    totalRevenue,
    cost: cost > 0 ? cost : null,
    income,
    incomeRate,
    myRevenue10a: totalRevenue != null && area10a ? totalRevenue / area10a : null,
    myCost10a: cost > 0 && area10a ? cost / area10a : null,
    myIncome10a: income != null && area10a ? income / area10a : null,
    benchmark: bench,
  };
}

// 입력값의 단위·환산을 시스템이 확정해 프롬프트에 넘기는 블록.
// 폼은 재배면적을 '평', 물량을 'kg'으로 이미 확정하는데 프롬프트가 숫자만 넘기면
// AI가 매번 단위를 재추측하고(평/a/㎡/ha) 10a 환산을 직접 하다 틀린다(예: 303 vs 3,030).
// 여기서 미리 환산해 '확정값'으로 주면 1번 현실성 점검의 단위 잡음이 사라진다.
// 환산 관례: 300평 = 10a (computeEcon·AMIS 소득자료와 동일 기준).
function buildInputFactsBlock(form, bench) {
  const area = parseFloat(form.area);
  const volume = parseFloat(form.volume);
  const lines = ["[입력값 단위·환산 확정 — 아래는 시스템이 확정한 값이다. 단위를 다시 추측하지 말고 이 값을 그대로 쓰라]"];

  if (area > 0) {
    const units10a = area / 300;      // 10a 블록 수 (300평 = 10a)
    const a = Math.round(units10a * 10 * 10) / 10;  // 아르(a)
    const ha = Math.round(a) / 100;                 // 헥타르(ha) = a/100
    lines.push(`- 재배면적: ${area.toLocaleString()}평 (= 약 ${a}a = 약 ${ha}ha, 10a 환산 계수 ${Math.round(units10a * 100) / 100})`);
    if (volume > 0) {
      const yield10a = Math.round(volume / units10a);
      let cmp = "";
      if (bench?.yield_per_10a_kg > 0) {
        const pct = Math.round((yield10a / bench.yield_per_10a_kg) * 100);
        cmp = ` (전국 평균 ${bench.name} ${bench.yield_per_10a_kg.toLocaleString()}kg/10a 대비 ${pct}%${pct < 50 || pct > 200 ? " — 편차가 크니 물량·면적 재확인 권고" : ""})`;
      }
      lines.push(`- 10a당 환산 수량: 약 ${yield10a.toLocaleString()}kg/10a${cmp}`);
    }
  } else if (form.area) {
    lines.push(`- 재배면적: ${form.area} (단위는 평으로 입력됨)`);
  }

  if (volume > 0) {
    lines.push(`- 연간 출하물량: ${volume.toLocaleString()}kg (단위는 kg 확정)`);
  }
  lines.push("- 위 환산값이 비현실적이지 않으면 '1. 입력 현실성 점검'에서 단위·환산을 다시 문제 삼지 마라. 물량이 총생산량인지 상품 출하량인지만 필요 시 짚어라.");
  return lines.length > 2 ? lines.join("\n") : "";
}

// 분석을 돌리기 전, 입력값을 시세·소득 기준선과 대조해 '눈에 띄게 어긋난' 값만 짚는다.
// 차단이 아니라 나열형 알림 — 오타(15,000원)나 단위 혼동(평/물량)을 AI가 첫 문단에서
// 붙잡기 전에 입력 단계에서 되묻게 한다. 애매한 정상 범위는 건드리지 않는다.
function buildInputWarnings(form, incomeData, bench) {
  const out = [];
  const price = parseFloat(form.curPrice);
  const area = parseFloat(form.area);
  const volume = parseFloat(form.volume);

  // 단가: 농가 수취가가 소매가를 넘는 일은 드물다 → 소매 130%(없으면 도매 180%) 초과 시 경고.
  if (price > 0 && (bench?.retail || bench?.wholesale)) {
    const r = bench.retail?.pricePerKg;
    const w = bench.wholesale?.pricePerKg;
    const ceil = r ? r * 1.3 : w * 1.8;
    if (price > ceil) {
      const ref = r ? `소매 평균 ${r.toLocaleString()}원/kg` : `도매 평균 ${w.toLocaleString()}원/kg`;
      out.push(`판매단가 ${price.toLocaleString()}원/kg은 ${ref}보다 높습니다. 농가 수취가가 소매가를 넘는 경우는 드무니 오타가 아닌지 확인해 주세요.`);
    } else if (w && price < w * 0.3) {
      out.push(`판매단가 ${price.toLocaleString()}원/kg은 도매 평균(${w.toLocaleString()}원/kg)의 30% 미만입니다. 단위(원/kg)가 맞는지 확인해 주세요.`);
    }
  }

  // 10a당 환산 수량 vs 전국 평균(AMIS): 크게 벗어나면 면적(평)·물량 단위를 되묻는다.
  const amis = findIncome(form.crop, incomeData);
  if (area > 0 && volume > 0 && amis?.yield_per_10a_kg > 0) {
    const y = Math.round(volume / (area / 300));
    const pct = Math.round((y / amis.yield_per_10a_kg) * 100);
    if (pct > 200) {
      out.push(`10a당 환산 수량이 약 ${y.toLocaleString()}kg으로 전국 평균 ${amis.name}(${amis.yield_per_10a_kg.toLocaleString()}kg)의 ${pct}%입니다. 재배면적(평)이나 물량 값을 확인해 주세요.`);
    } else if (pct < 40) {
      out.push(`10a당 환산 수량이 약 ${y.toLocaleString()}kg으로 전국 평균의 ${pct}%에 그칩니다. 재배면적이나 물량 입력을 확인해 주세요.`);
    }
  }
  return out;
}

// ─── 거래특성·출하전략 근거 블록 (농진청 출하가이드 PDF 추출본) ────
// shipping-guides.json의 품목별 insight를 프롬프트 근거로 변환. 매칭 없으면 빈 문자열.
// 매칭 우선순위: 정확일치 → aliases → 부분일치(가장 구체적인 = 이름이 긴 것).
// 품목명 "토마토"는 aliases 로 일반토마토에, "시설방울토마토"는 부분일치로
// 방울토마토에 붙는다. 배열 순서에 기대지 않기 위해 길이순으로 고른다.
function buildGuideBlock(shippingGuides, cropName) {
  if (!cropName) return "";
  const guides = shippingGuides || [];
  const name = String(cropName);
  const g =
    guides.find((x) => x.crop === name) ||
    guides.find((x) => (x.aliases || []).includes(name)) ||
    guides
      .filter((x) => x.crop && name.includes(x.crop))
      .sort((a, b) => b.crop.length - a.crop.length)[0];
  if (!g?.insight) return "";
  return `[거래특성·출하전략 근거 (농진청 출하가이드)]
- ${g.insight}
- 위 품질기준·시세 시기·포장 추세·경로별 특성을 "경로별 평가", "추천 포트폴리오", "경로별 경쟁력 강화 과제"에 반드시 실제 근거로 반영하라. 이 근거와 어긋나는 일반론을 만들지 마라.`;
}

// ─── 레이어1 AI 분석 프롬프트 생성 (v8 기반 + 소득자료 연계) ──────
function buildLayer1Prompt(form, behaviorAnswers, farmerType, topsisResult, consumerInsight, incomeBlock, guideBlock, inputFactsBlock) {
  const typeInfo = TYPE_INFO[farmerType.type];
  const topRoutes = topsisResult.slice(0, 3).map((r) => `${r.route}(${r.score}점)`).join(", ");

  return `당신은 농가의 판매경로 포트폴리오를 진단하고 추천하는 농업유통 컨설턴트다.
이 분석은 규칙기반 진단이며 실제 통계모형이 아님을 명확히 밝혀라.

[판매경로 5개로 한정]
도매시장 / 생산자단체(조직출하) / 직거래(온라인) / 직거래(로컬푸드) / 산지유통인

[농가 입력 정보]
- 품목: ${form.crop || "미입력"}
- 품종: ${form.variety || "미입력"}
- 재배면적: ${form.area ? form.area + "평" : "미입력"}
- 연간 출하 물량: ${form.volume ? form.volume + "kg" : "미입력"}
- 출하 가능 기간: ${form.shippingPeriod || "미입력"}
- 저장성: ${form.storage || "미입력"}
- 비상품률: ${form.defectRate ? form.defectRate + "%" : "미입력"}
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

[소비자가 원하는 상품 (농식품 소비월보 기반)]
${consumerInsight
  ? `- ${consumerInsight}\n- 위 소비자 선호를 반드시 경로별 평가와 추천 포트폴리오에 반영하라. 특히 포장·규격·브랜드화·판매 채널 관련 시사점을 "경로별 경쟁력 강화 과제"에 구체적으로 연결하라.`
  : "- 이 품목은 소비월보 데이터가 없으므로 일반적인 소비 경향으로 판단한다."}

${inputFactsBlock || ""}

${guideBlock || ""}

${incomeBlock || ""}

${buildSkipBlock(form)}

${buildDefectBlock(form.defectRate)}

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
- 먼저 이 농가에 맞는 포트폴리오 구조 유형을 판정하고 근거를 한 줄로 밝혀라: 단일집중 / 위계형 분산 / 양강 균형 / 계절·등급 분할
- 현재 즉시 실행안: 경로 1~3개, 합계 100%. 비중 가이드(참고값이며 강제 아님): 주력 40~100% / 보완 20~40% / 완충 10~30%
- 슬롯을 채우기 위한 배정 금지: 주력/보완/완충 3칸을 모두 채울 필요 없다. 근거가 약한 경로는 넣지 말고, 단일 경로 집중이 최적이면 주력 100%로 답하라
- 양강 균형이면 두 경로 비중을 비슷하게 두고 위계를 억지로 만들지 마라. 계절·등급 분할이면 비중과 함께 시기별·등급별 경로 운용을 표로 제시하라
- 준비 후 확대안: 필요할 때만 제시
- 직거래(온라인)과 직거래(로컬푸드) 동시 포함 시 합산 노동부담 검토 결과 반드시 포함

**6. 추천 사유**
- 왜 이 구조 유형·경로 조합인지 (어떤 변수가 결정적이었는지)
- 왜 다른 경로는 포트폴리오에서 제외했거나 낮은 비중인지

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
- 직거래(온라인)과 직거래(로컬푸드)는 항상 별도 경로로 평가
- 수익성·원가 기준선이 주어졌으면, 농가 단가의 전국 평균 대비 위치와 고용노동비 비중을 "5번 추천 포트폴리오"와 "6번 추천 사유"에 반드시 근거로 반영하라

[출력 형식 — 반드시 지켜라]
- 섹션 제목은 마크다운 '## 숫자. 제목' 형식으로만 작성한다.
- 경로별 평가와 추천 포트폴리오는 반드시 마크다운 표(| 열 | 열 |)로 작성한다. 아스키 박스(┌─┐, ╔═╗)나 코드블록(\`\`\`) 표는 절대 쓰지 마라.
- 각 항목 서술은 2~4줄로 간결하게. 장황한 배경 설명·중복 문장 금지.
- 핵심 수치·판정은 **굵게** 강조한다.

${buildSummaryInstruction([
  ["농가 진단", "유형·핵심 특성·결정적 제약 한 줄"],
  ["추천 포트폴리오", "구조 유형 + 경로·비중(%) 한 줄"],
  ["핵심 근거", "이 구조를 결정한 변수 1~2개 한 줄"],
  ["첫 실행 과제", "지금 바로 시작할 일 한 줄"],
])}`;
}

// ─── 추론 우선 레이어1 프롬프트 ──────────────────────────────
// buildLayer1Prompt와 같은 근거(AMIS·소비자·행동응답)를 주되,
//  - 농가 유형(A~E)을 '결정된 답'으로 주지 않고 성향 신호만 참고로 넘긴다
//  - TOPSIS 점수는 '규칙기반 표에서 나온 참고 사전값(따를 필요 없음)'으로만 제시하고
//    LLM이 스스로 경로 적합도를 추론·순위 매기며, 표와 다르면 그 이유를 밝히게 한다.
// 목적: "표가 결정 → LLM이 해설" 구조를 "LLM이 추론 → 표는 참고"로 뒤집었을 때
//       결과가 얼마나/어떻게 달라지는지 규칙기반 결과와 나란히 비교하기 위함.
function buildLayer1PromptReasoning(form, behaviorAnswers, farmerType, topsisResult, consumerInsight, incomeBlock, guideBlock, inputFactsBlock) {
  return `당신은 이 농가 한 곳의 조건·성향·자원을 '있는 그대로' 읽고, 5개 판매경로가 이 농가에 실제로 맞는지를 스스로 추론해 판단하는 농업유통 컨설턴트다.
이것은 규칙기반 점수표가 아니라 당신의 추론으로 순위를 정하는 방식이다. 아래 사전 점수는 참고일 뿐이며, 당신의 판단과 다르면 반드시 그 이유를 밝혀라.

[판매경로 5개로 한정]
도매시장 / 생산자단체(조직출하) / 직거래(온라인) / 직거래(로컬푸드) / 산지유통인

[농가 입력 정보]
- 품목: ${form.crop || "미입력"} / 품종: ${form.variety || "미입력"}
- 재배면적: ${form.area ? form.area + "평" : "미입력"} / 연간 출하 물량: ${form.volume ? form.volume + "kg" : "미입력"}
- 출하 가능 기간: ${form.shippingPeriod || "미입력"} / 저장성: ${form.storage || "미입력"}
- 비상품률: ${form.defectRate ? form.defectRate + "%" : "미입력"}
- 농가주 연령: ${form.age || "미입력"} / 가족노동력: ${form.labor || "미입력"}명 / 판매·포장 가능 구성원: ${form.packMember || "미입력"}
- 직접 판매 경험: ${form.directSaleExp || "미입력"} / 도매시장 출하 경험: ${form.wholesaleExp || "미입력"}
- 온라인 판매 경험: ${form.onlineExp || "미입력"} / 로컬푸드·직거래 경험: ${form.localExp || "미입력"}
- 고객응대·클레임 대응 경험: ${form.claimExp || "미입력"} / 추가 시간 투입 가능: ${form.timeAvail || "미입력"}
- 협상·거래 응대 부담: ${form.negotiation || "미입력"} / 현재 판매경로: ${form.currentRoutes || "미입력"}
- 지역: ${form.region || "미입력"} / 특이사항: ${form.special || "없음"}

[행동 기반 응답 — 원문 그대로 (당신이 직접 해석하라)]
- Q1(가격대응): ${BEHAVIOR_QUESTIONS[0].options[behaviorAnswers.q1]?.label || "미응답"}
- Q2(판로시도): ${BEHAVIOR_QUESTIONS[1].options[behaviorAnswers.q2]?.label || "미응답"}
- Q3(불만사항): ${BEHAVIOR_QUESTIONS[2].options[behaviorAnswers.q3]?.label || "미응답"}
- Q4(클레임경험): ${BEHAVIOR_QUESTIONS[3].options[behaviorAnswers.q4]?.label || "미응답"}
- Q5(출하결정): ${BEHAVIOR_QUESTIONS[4].options[behaviorAnswers.q5]?.label || "미응답"}
- 참고 성향 신호(강도, 결정값 아님): 수익지향 ${farmerType.profit} · 안정지향 ${farmerType.stable} · 도전성 ${farmerType.challenge} · 조직의존 ${farmerType.org}
  → 위 신호는 5문항을 기계적으로 합산한 것일 뿐이다. 농가를 하나의 고정 유형으로 낙인찍지 말고, 응답 원문과 조건을 종합해 성향을 '스스로' 서술하라.

[참고: 규칙기반 사전 점수 (TOPSIS 표 — 따를 필요 없음)]
${topsisResult.map((r) => `- ${r.route}: ${r.score}점`).join("\n")}
※ 이 점수는 고정 가중치·고정 점수행렬에서 나온 값이라 이 농가의 개별 사정을 반영하지 못한다. 당신의 추론 결과가 이와 다르면, 4번 항목에서 "표는 X를 상위로 봤지만 나는 Y를 우선한다 — 왜냐하면…" 식으로 근거를 대라.

[소비자가 원하는 상품 (농식품 소비월보 기반)]
${consumerInsight
  ? `- ${consumerInsight}\n- 이 소비자 선호를 경로별 판단과 추천에 실제로 반영하라.`
  : "- 이 품목은 소비월보 데이터가 없으므로 일반적인 소비 경향으로 판단한다."}

${inputFactsBlock || ""}

${guideBlock || ""}

${incomeBlock || ""}

${buildSkipBlock(form)}

${buildDefectBlock(form.defectRate)}

[분석 출력 순서 — 반드시 이 순서로 한국어로 답하라]

**1. 이 농가를 한 문단으로 읽기**
- 이 농가가 어떤 상황·성향·제약을 가진 곳인지, 응답과 조건을 근거로 2~4줄 서술 (유형 라벨 붙이지 말 것)

**2. 결정적 변수 3가지**
- 이 농가의 경로 선택을 가장 크게 좌우하는 변수 3개와 그 이유

**3. 정성지표 판정**
- 판매운영 역량 / 온라인 직거래 역량 / 도전성향 / 안정성 선호 / 대면·협상 대응 성향 (각 낮음·보통·높음 + 근거 한 줄)

**4. 5개 경로 추론 평가**
각 경로마다: 판정(진입 가능/조건부 가능/비추천) | 당신이 매긴 점수(100점) | 근거(이 농가 변수로 서술)
- 반드시 당신의 추론으로 점수를 매기고, 위 규칙기반 사전 점수와 어긋나는 경로가 있으면 그 차이와 이유를 명시하라.

**5. 추천 포트폴리오**
- 먼저 이 농가에 맞는 포트폴리오 구조 유형을 판정하고 근거를 한 줄로 밝혀라: 단일집중 / 위계형 분산 / 양강 균형 / 계절·등급 분할
- 즉시 실행안: 경로 1~3개, 합계 100%. 비중 가이드(참고값이며 강제 아님): 주력 40~100% / 보완 20~40% / 완충 10~30%
- 슬롯을 채우기 위한 배정 금지: 주력/보완/완충 3칸을 모두 채울 필요 없다. 근거가 약한 경로는 넣지 말고, 단일 경로 집중이 최적이면 주력 100%로 답하라
- 양강 균형이면 위계를 억지로 만들지 말고, 비중이 크거나 전략적으로 더 중요한 쪽을 주력 칸에 표기하라. 계절·등급 분할이면 시기별·등급별 운용을 표로 함께 제시하라
- 온라인+로컬푸드 동시 포함 시 합산 노동부담 검토 반드시 포함
- 이 포트폴리오 표 바로 아래 줄에, 기계 판독용으로 아래 한 줄을 정확히 출력한 뒤 6~8번을 이어서 작성하라:
  PORTFOLIO_ROUTES: 구조=<단일집중|위계형분산|양강균형|계절등급분할>, 주력=<경로>, 보완=<경로 또는 없음>, 완충=<경로 또는 없음>, 역량=<낮음|보통|높음>
  · <경로>는 반드시 5개 중 정확히 하나로 표기: 도매시장 / 생산자단체(조직출하) / 직거래(온라인) / 직거래(로컬푸드) / 산지유통인
  · 주력/보완/완충은 위 포트폴리오 표와 정확히 일치(사용하지 않은 역할은 '없음'), 역량은 3번의 판매운영 역량을 따른다

**6. 추천 사유**
- 어떤 변수가 결정적이었는지, 왜 이 구조 유형인지, 왜 다른 경로는 제외했거나 낮은 비중인지

**7. 경로별 경쟁력 강화 과제**
생산·수확 / 선별·규격화 / 포장·소포장 / 판매·마케팅 / 조직화·계약 / 비상품 처리

**8. 한줄 결론**
이 농가의 최적 판매전략을 한 문장으로

[중요 제한]
- "상황에 따라 다르다"로 끝내지 마라
- 근거 없는 수익 수치 절대 제시 금지
- 비현실적 입력이면 먼저 경고
- 품종·저장성·출하 가능 기간을 반드시 핵심 변수로 반영
- 직거래(온라인)과 직거래(로컬푸드)는 항상 별도 경로로 평가
- 수익성·원가 기준선이 주어졌으면 농가 단가의 전국 평균 대비 위치와 고용노동비 비중을 5·6번에 반드시 근거로 반영

[출력 형식]
- 섹션 제목은 '## 숫자. 제목' 마크다운으로만.
- 경로 평가·추천 포트폴리오는 마크다운 표(| 열 | 열 |)로. 아스키 박스·코드블록 표 금지.
- 각 서술 2~4줄로 간결하게. 핵심 수치·판정은 **굵게**.

${buildSummaryInstruction([
  ["농가 진단", "상황·성향·결정적 제약 한 줄 (유형 라벨 없이)"],
  ["추천 포트폴리오", "구조 유형 + 경로·비중(%) 한 줄"],
  ["핵심 근거", "이 구조를 결정한 변수 1~2개 한 줄"],
  ["첫 실행 과제", "지금 바로 시작할 일 한 줄"],
])}`;
}

// ─── 추론 우선 출력에서 포트폴리오 경로 파싱 ─────────────────
// 경로명을 5개 표준 경로 중 하나로 정규화 (부분·키워드 매칭 포함)
function normalizeRoute(s) {
  const t = String(s || "").trim();
  if (!t || t === "없음") return t === "없음" ? "없음" : "";
  const exact = ROUTES.find((r) => r === t);
  if (exact) return exact;
  const partial = ROUTES.find((r) => t.includes(r) || r.includes(t));
  if (partial) return partial;
  if (t.includes("온라인")) return "직거래(온라인)";
  if (t.includes("로컬")) return "직거래(로컬푸드)";
  if (t.includes("도매")) return "도매시장";
  if (t.includes("조직") || t.includes("생산자단체") || t.includes("농협")) return "생산자단체(조직출하)";
  if (t.includes("산지유통")) return "산지유통인";
  return "";
}

// 추론 출력 마지막의 'PORTFOLIO_ROUTES: ...' 한 줄을 파싱 → 레이어2 기준선 객체
function parseReasoningPortfolio(text) {
  const m = String(text || "").match(/PORTFOLIO_ROUTES:\s*(.+)/);
  if (!m) return null;
  const line = m[1];
  const grab = (key) => {
    const r = line.match(new RegExp(key + "\\s*=\\s*([^,]+)"));
    return r ? r[1].trim() : "";
  };
  const mainRoute = normalizeRoute(grab("주력"));
  if (!mainRoute) return null; // 주력조차 못 읽으면 적용 불가
  let capability = grab("역량");
  if (!["낮음", "보통", "높음"].includes(capability)) capability = "보통";
  // 구조 유형은 선택 필드 (구버전 출력에는 없음)
  const structureRaw = grab("구조").replace(/[·\s]/g, "");
  const structureType =
    ["단일집중", "위계형분산", "양강균형", "계절등급분할"].find((s) => structureRaw.includes(s)) || "";
  return {
    structureType,
    mainRoute,
    subRoute: normalizeRoute(grab("보완")) || "없음",
    bufferRoute: normalizeRoute(grab("완충")) || "없음",
    capability,
  };
}

// 화면 표시용: 기계 판독 라인은 사용자에게 숨긴다
function stripPortfolioMarker(text) {
  return String(text || "")
    .replace(/^\s*PORTFOLIO_ROUTES:.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

// ─── 핵심 요약 분리 ───────────────────────────────────────────
// AI 응답 맨 끝의 '===핵심요약===' 블록을 본문과 분리한다.
// 요약 블록이 없으면(구버전 출력·오류 메시지 등) 전체를 본문으로 취급.
const SUMMARY_MARKER = "===핵심요약===";
function splitSummary(text) {
  const s = String(text || "");
  const idx = s.indexOf(SUMMARY_MARKER);
  if (idx === -1) return { body: s, summary: "" };
  return {
    body: s.slice(0, idx).trimEnd(),
    summary: s.slice(idx + SUMMARY_MARKER.length).trim(),
  };
}

// 프롬프트 공용: 응답 맨 끝에 붙일 핵심 요약 블록 지시문
function buildSummaryInstruction(lines) {
  return `[핵심 요약 블록 — 반드시 응답 맨 마지막에 출력하라]
위 전체 분석을 모두 마친 뒤, 맨 끝에 정확히 '${SUMMARY_MARKER}' 한 줄을 쓰고 바로 아래에 다음 항목만 각 한 줄로 출력하라.
새로운 정보·수치를 추가하지 말고 본문 내용을 압축만 하라. 표·제목 없이 불릿(-)만 사용하라.
${lines.map((l) => `- **${l[0]}**: ${l[1]}`).join("\n")}`;
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
- 직거래 주문 있으면 상품 우선 배분

${buildSummaryInstruction([
  ["출하 판정", "즉시/분할/대기 + 근거 한 줄"],
  ["경로 배분", "경로별 kg·% 배분 한 줄"],
  ["핵심 근거", "결정적 변수 한 줄"],
  ["주의사항", "실행 시 가장 유의할 점 한 줄"],
])}`;
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
  if (low.includes("credit balance is too low") || low.includes("billing") || low.includes("insufficient_quota"))
    return "AI API 크레딧/할당량이 부족합니다. 사용 중인 제공자 콘솔에서 결제 상태를 확인한 뒤 다시 시도하세요. (.env 의 AI_PROVIDER 에 설정된 제공자 기준)";
  if (status === 401 || low.includes("authentication") || low.includes("invalid x-api-key") || low.includes("api key not valid") || low.includes("incorrect api key"))
    return "AI API 키가 유효하지 않습니다. .env 에서 사용 중인 제공자의 API 키를 확인하세요.";
  if (status === 429 || low.includes("rate limit") || low.includes("resource_exhausted"))
    return "AI API 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.";
  if (status === 529 || status === 503 || low.includes("overloaded"))
    return "AI 서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도하세요.";
  if (status === 0 || low.includes("failed to fetch"))
    return "백엔드 서버에 연결하지 못했습니다. server.js(포트 3001)가 실행 중인지 확인하세요.";
  return `API 오류 (${status}): ${msg || "서버 응답 없음. server.js가 실행 중인지 확인하세요."}`;
}

async function callClaude(prompt, onChunk) {
  let response;
  try {
    response = await fetch("/api/analyze", {
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
  let buffer = ""; // SSE 라인이 네트워크 청크 경계에서 잘리면 다음 청크로 이월

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // 마지막 요소는 미완성 라인일 수 있음
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
// 인라인 서식: **굵게**, `코드`
function renderInline(str) {
  return String(str).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((tk, i) => {
    if (/^\*\*[^*]+\*\*$/.test(tk))
      return <strong key={i} style={{ color: theme.text, fontWeight: 700 }}>{tk.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(tk))
      return <code key={i} style={{ fontFamily: "ui-monospace, monospace", background: theme.panelAlt, padding: "1px 5px", borderRadius: 4, fontSize: "0.9em", color: theme.text }}>{tk.slice(1, -1)}</code>;
    return tk;
  });
}
const splitCells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

function MdTable({ header, rows }) {
  return (
    <div style={{ overflowX: "auto", margin: "10px 0 16px" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
        <thead>
          <tr>{header.map((c, j) => (
            <th key={j} style={{ textAlign: "left", padding: "9px 12px", background: theme.panelAlt, color: theme.text, fontWeight: 700, borderBottom: `2px solid ${theme.panelBorder}`, whiteSpace: "nowrap" }}>{renderInline(c)}</th>
          ))}</tr>
        </thead>
        <tbody>{rows.map((r, ri) => (
          <tr key={ri} style={{ background: ri % 2 ? "transparent" : `${theme.panelAlt}66` }}>
            {r.map((c, j) => (
              <td key={j} style={{ padding: "8px 12px", color: j === 0 ? theme.text : theme.textMuted, fontWeight: j === 0 ? 600 : 400, borderBottom: `1px solid ${theme.divider}`, verticalAlign: "top" }}>{renderInline(c)}</td>
            ))}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

const H_STYLE = {
  1: { fontSize: 17, fontWeight: 800, color: theme.text, margin: "20px 0 10px" },
  2: { fontSize: 15.5, fontWeight: 700, color: theme.text, borderLeft: `3px solid ${theme.accent}`, paddingLeft: 10, margin: "20px 0 8px" },
  3: { fontSize: 14, fontWeight: 700, color: theme.text, margin: "14px 0 4px" },
  4: { fontSize: 13, fontWeight: 600, color: theme.textMuted, margin: "10px 0 2px" },
};

function SimpleMarkdown({ text }) {
  if (!text) return null;
  const lines = text.replace(/\r/g, "").split("\n");
  const out = [];
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l || "");
  const isSep = (l) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l || "") && (l || "").includes("-");
  let i = 0, k = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 코드블록 ```
    if (/^\s*```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(<pre key={k++} style={{ background: theme.panelAlt, border: `1px solid ${theme.panelBorder}`, borderRadius: 8, padding: "10px 12px", overflowX: "auto", fontSize: 12.5, lineHeight: 1.5, color: theme.textMuted, margin: "8px 0" }}>{buf.join("\n")}</pre>);
      continue;
    }
    // 표
    if (isRow(line) && isSep(lines[i + 1])) {
      const header = splitCells(line); i += 2;
      const rows = [];
      while (i < lines.length && isRow(lines[i])) { rows.push(splitCells(lines[i])); i++; }
      out.push(<MdTable key={k++} header={header} rows={rows} />);
      continue;
    }
    // 제목 #~####
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push(<div key={k++} style={H_STYLE[h[1].length]}>{renderInline(h[2].replace(/\s*#+\s*$/, ""))}</div>); i++; continue; }
    // 구분선
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) { out.push(<hr key={k++} style={{ border: "none", borderTop: `1px solid ${theme.divider}`, margin: "14px 0" }} />); i++; continue; }
    // 한 줄 전체 굵게 → 소제목 처리
    const wb = line.match(/^\s*\*\*(.+?)\*\*\s*:?\s*$/);
    if (wb) { out.push(<div key={k++} style={H_STYLE[3]}>{wb[1]}</div>); i++; continue; }
    // 인용 >
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out.push(
        <div key={k++} style={{ borderLeft: `3px solid ${theme.info}`, background: `${theme.info}12`, padding: "8px 12px", borderRadius: "0 8px 8px 0", margin: "10px 0", fontSize: 13, color: theme.textMuted, lineHeight: 1.7 }}>
          {buf.map((b, bi) => <div key={bi}>{renderInline(b)}</div>)}
        </div>
      );
      continue;
    }
    // 글머리표 - * •
    const b = line.match(/^(\s*)[-*•]\s+(.*)$/);
    if (b) {
      const indent = Math.floor(b[1].length / 2) * 14;
      out.push(
        <div key={k++} style={{ display: "flex", gap: 8, paddingLeft: 4 + indent, margin: "3px 0", fontSize: 14, color: theme.textMuted, lineHeight: 1.7 }}>
          <span style={{ color: theme.accent, flexShrink: 0 }}>•</span>
          <span>{renderInline(b[2])}</span>
        </div>
      );
      i++; continue;
    }
    // 번호 목록
    const n = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (n) {
      out.push(
        <div key={k++} style={{ display: "flex", gap: 8, paddingLeft: 4, margin: "3px 0", fontSize: 14, color: theme.textMuted, lineHeight: 1.7 }}>
          <span style={{ color: theme.accent, fontWeight: 700, flexShrink: 0 }}>{n[1]}.</span>
          <span>{renderInline(n[2])}</span>
        </div>
      );
      i++; continue;
    }
    // 빈 줄
    if (line.trim() === "") { out.push(<div key={k++} style={{ height: 6 }} />); i++; continue; }
    // 일반 문단
    out.push(<div key={k++} style={{ color: theme.textMuted, fontSize: 14, lineHeight: 1.75, margin: "2px 0" }}>{renderInline(line)}</div>);
    i++;
  }
  return <div>{out}</div>;
}

// ─── 점수 배지 (다크 테마) ──────────────────────────────────────
function ScoreBadge({ score }) {
  // TOPSIS 상대근접도 특성상 실측 최고점이 70점 안팎이라 임계값을 65/50/35로 조정
  const color = score >= 65 ? theme.accent : score >= 50 ? theme.info : score >= 35 ? theme.warn : theme.danger;
  const text = score >= 65 ? "주력 후보" : score >= 50 ? "보완 후보" : score >= 35 ? "제한적" : "비추천";
  return (
    <span style={{ background: color, color: "#06210f", borderRadius: 20, padding: "2px 10px", fontSize: 13, fontWeight: 700 }}>
      {score}점 · {text}
    </span>
  );
}

// ─── PDF 리포트 출력 (인쇄용 창 → 브라우저 "PDF로 저장") ─────────
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function inlineHtml(str) {
  return escapeHtml(str)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
// SimpleMarkdown과 동일한 규칙으로 마크다운을 인쇄용 HTML 문자열로 변환
function markdownToPrintHtml(text) {
  if (!text) return "";
  const lines = text.replace(/\r/g, "").split("\n");
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l || "");
  const isSep = (l) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l || "") && (l || "").includes("-");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre>${escapeHtml(buf.join("\n"))}</pre>`);
      continue;
    }
    if (isRow(line) && isSep(lines[i + 1])) {
      const header = splitCells(line); i += 2;
      const rows = [];
      while (i < lines.length && isRow(lines[i])) { rows.push(splitCells(lines[i])); i++; }
      out.push(
        `<table><thead><tr>${header.map((c) => `<th>${inlineHtml(c)}</th>`).join("")}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((c, j) => `<td class="${j === 0 ? "c0" : ""}">${inlineHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      );
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push(`<div class="md-h${h[1].length}">${inlineHtml(h[2].replace(/\s*#+\s*$/, ""))}</div>`); i++; continue; }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    const wb = line.match(/^\s*\*\*(.+?)\*\*\s*:?\s*$/);
    if (wb) { out.push(`<div class="md-h3">${escapeHtml(wb[1])}</div>`); i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out.push(`<blockquote>${buf.map((b) => `<div>${inlineHtml(b)}</div>`).join("")}</blockquote>`);
      continue;
    }
    const b = line.match(/^(\s*)[-*•]\s+(.*)$/);
    if (b) {
      const indent = Math.floor(b[1].length / 2) * 14;
      out.push(`<div class="md-li" style="padding-left:${4 + indent}px"><span class="bullet">•</span><span>${inlineHtml(b[2])}</span></div>`);
      i++; continue;
    }
    const n = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (n) { out.push(`<div class="md-li"><span class="bullet num">${n[1]}.</span><span>${inlineHtml(n[2])}</span></div>`); i++; continue; }
    if (line.trim() === "") { out.push('<div class="gap"></div>'); i++; continue; }
    out.push(`<p>${inlineHtml(line)}</p>`);
    i++;
  }
  return out.join("\n");
}

// 인쇄용 리포트 창 열기 — sections: [{ heading, bodyHtml }]
function openPrintReport({ title, subtitle, metaRows, sections }) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}. ${String(now.getMonth() + 1).padStart(2, "0")}. ${String(now.getDate()).padStart(2, "0")}.`;
  const metaHtml = metaRows?.length
    ? `<table class="meta"><tbody>${metaRows.map(([l, v]) => `<tr><th>${escapeHtml(l)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</tbody></table>`
    : "";
  const sectionHtml = sections
    .map((s) => `<section>${s.heading ? `<h2>${escapeHtml(s.heading)}</h2>` : ""}${s.bodyHtml}</section>`)
    .join("\n");
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; color: #1a2330; margin: 0; font-size: 13px; line-height: 1.75; }
  .report-head { border-bottom: 3px solid #16a34a; padding-bottom: 14px; margin-bottom: 20px; }
  .report-head .brand { color: #16a34a; font-weight: 800; font-size: 13px; letter-spacing: 1px; }
  .report-head h1 { font-size: 22px; margin: 4px 0 2px; }
  .report-head .sub { color: #64748b; font-size: 12px; }
  .report-head .date { float: right; color: #64748b; font-size: 12px; margin-top: 6px; }
  table.meta { border-collapse: collapse; width: 100%; margin-bottom: 22px; }
  table.meta th { text-align: left; background: #f1f5f9; width: 130px; font-size: 12px; color: #475569; }
  table.meta th, table.meta td { border: 1px solid #e2e8f0; padding: 6px 10px; }
  section { margin-bottom: 26px; }
  h2 { font-size: 16px; border-left: 4px solid #16a34a; padding-left: 10px; margin: 0 0 12px; }
  .md-h1 { font-size: 16px; font-weight: 800; margin: 18px 0 8px; }
  .md-h2 { font-size: 15px; font-weight: 700; border-left: 3px solid #16a34a; padding-left: 9px; margin: 18px 0 8px; }
  .md-h3 { font-size: 13.5px; font-weight: 700; margin: 12px 0 4px; }
  .md-h4 { font-size: 12.5px; font-weight: 600; color: #475569; margin: 10px 0 2px; }
  p { margin: 2px 0; color: #334155; }
  .md-li { display: flex; gap: 7px; margin: 3px 0; color: #334155; }
  .md-li .bullet { color: #16a34a; flex-shrink: 0; }
  .md-li .bullet.num { font-weight: 700; }
  .gap { height: 6px; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 14px 0; }
  blockquote { border-left: 3px solid #0ea5e9; background: #f0f9ff; padding: 8px 12px; margin: 10px 0; border-radius: 0 6px 6px 0; color: #334155; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin: 10px 0 16px; page-break-inside: avoid; }
  th, td { border: 1px solid #e2e8f0; padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 700; white-space: nowrap; }
  td.c0 { font-weight: 600; }
  pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; font-size: 11.5px; overflow-x: auto; white-space: pre-wrap; }
  code { font-family: ui-monospace, monospace; background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 0.9em; }
  .report-foot { border-top: 1px solid #e2e8f0; margin-top: 30px; padding-top: 10px; font-size: 11px; color: #94a3b8; }
</style></head>
<body>
  <div class="report-head">
    <span class="date">출력일 ${dateStr}</span>
    <div class="brand">AGR</div>
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<div class="sub">${escapeHtml(subtitle)}</div>` : ""}
  </div>
  ${metaHtml}
  ${sectionHtml}
  <div class="report-foot">본 리포트는 AGR 농가 경영진단 AI 대시보드에서 생성되었습니다. AI 분석 결과는 참고용이며, 최종 의사결정은 농가 여건을 종합하여 판단하시기 바랍니다.</div>
  <script>window.onload = function () { setTimeout(function () { window.print(); }, 300); };<\/script>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) {
    alert("팝업이 차단되어 리포트 창을 열 수 없습니다. 브라우저의 팝업 차단을 해제해 주세요.");
    return;
  }
  w.document.write(html);
  w.document.close();
}

// ─── AI 분석 결과 표시: 핵심 요약 카드 + 전체 본문 접기/펼치기 ──
// 스트리밍 중에는 전체 본문을 그대로 보여주고(자동 스크롤),
// 완료되면 요약 카드만 남기고 본문을 접는다. 요약 블록이 없으면 기존처럼 전체 표시.
function AnalysisResult({ text, loading, maxHeight = 500, emptyText = "분석 결과가 여기에 표시됩니다.", loadingText = "🌱 분석 중입니다..." }) {
  const [showFull, setShowFull] = useState(true);
  const scrollRef = useRef(null);
  useEffect(() => {
    setShowFull(!!loading); // 스트리밍 시작 → 펼침, 완료 → 요약만
  }, [loading]);
  useEffect(() => {
    if (loading && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [text, loading]);

  if (!text) {
    return <div style={{ color: theme.textFaint, fontSize: 14, textAlign: "center", padding: 40 }}>{loading ? loadingText : emptyText}</div>;
  }
  const { body, summary } = splitSummary(text);
  const hasSummary = !!summary;
  const collapsed = hasSummary && !loading && !showFull;
  return (
    <div>
      {hasSummary && (
        <div style={{ border: `1.5px solid ${theme.accent}88`, background: `${theme.accent}10`, borderRadius: 10, padding: "12px 16px", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: theme.accent, marginBottom: 6 }}>📌 핵심 요약</div>
          <SimpleMarkdown text={summary} />
        </div>
      )}
      {!collapsed && (
        <div ref={scrollRef} style={{ maxHeight, overflowY: "auto", paddingRight: 4 }}>
          <SimpleMarkdown text={body} />
        </div>
      )}
      {hasSummary && !loading && (
        <div style={{ textAlign: "center", marginTop: 10 }}>
          <button
            style={{ background: "none", border: `1px solid ${theme.panelBorder}`, borderRadius: 8, color: theme.textMuted, fontSize: 12.5, padding: "6px 14px", cursor: "pointer" }}
            onClick={() => setShowFull((v) => !v)}
          >
            {collapsed ? "▼ 전체 분석 펼치기" : "▲ 전체 분석 접기"}
          </button>
        </div>
      )}
    </div>
  );
}

// Step0 필수 입력값 (판매경로 추천을 구동하는 값) — 특이사항은 빈칸 허용이라 제외
const REQUIRED_STEP0 = [
  ["crop", "품목"], ["variety", "품종"], ["area", "재배면적"], ["volume", "연간 출하물량"],
  ["storage", "저장성"], ["onlineExp", "온라인 판매 경험"], ["packCapable", "포장 대응 가능 여부"],
  ["timeAvail", "추가 시간 투입 가능 여부"], ["age", "농가주 연령"], ["labor", "가족노동력"],
  ["claimExp", "고객응대·클레임 대응 경험"], ["localAccess", "로컬푸드 매장 접근성"],
  ["directSaleExp", "직접 판매 경험"], ["wholesaleExp", "도매시장 출하 경험"],
  ["localExp", "로컬푸드·직거래 경험"], ["negotiation", "협상·거래 응대 부담"],
  ["packMember", "판매·포장 가능 구성원"], ["currentRoutes", "현재 판매경로"],
];

// ─── 레이어2(출하 의사결정) 화면 노출 여부 ────────────────────
// 진단 범위를 포트폴리오 분석까지로 한정하기로 해 화면에서 내렸다.
// 프롬프트·입력폼·호출 로직은 그대로 두었으므로 true 로 되돌리면 복구된다.
const ENABLE_LAYER2 = false;

// ─── 진행 단계 바 (다크 테마) ────────────────────────────────
const STEPS = ["기본 정보", "성향 진단", "포트폴리오 분석", ...(ENABLE_LAYER2 ? ["출하 결정"] : [])];

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
    storage: "", defectRate: "", age: "", labor: "", packMember: "",
    directSaleExp: "", wholesaleExp: "", onlineExp: "", localExp: "",
    claimExp: "", timeAvail: "", negotiation: "", currentRoutes: "",
    region: "", special: "", localAccess: "", packCapable: "", curPrice: "",
    cost: "",
  });
  const [behaviorAnswers, setBehaviorAnswers] = useState({});
  const [farmerType, setFarmerType] = useState(null);
  const [topsisResult, setTopsisResult] = useState(null);
  const [layer1Output, setLayer1Output] = useState("");
  const [layer1Loading, setLayer1Loading] = useState(false);
  // 추론 우선 방식 비교 출력
  const [compareOutput, setCompareOutput] = useState("");
  const [compareLoading, setCompareLoading] = useState(false);
  const [reasoningPortfolio, setReasoningPortfolio] = useState(null); // 추론 출력에서 파싱한 주력/보완/완충
  const [layer2Source, setLayer2Source] = useState("규칙기반"); // 레이어2 기준선 출처: "규칙기반" | "추론"
  const [layer2Form, setLayer2Form] = useState({
    thisVolume: "", canStore: "", storeDays: "", gradeRatio: "",
    quality: "", urgent: "", special: "", onlineOrder: "", localAvail: "",
    sjiAvail: "", orgAvail: "", curPrice: "", priceVsAvg: "", priceTrend: "",
    competition: "", mainRoute: "", subRoute: "", bufferRoute: "", capability: "",
  });
  const [layer2Output, setLayer2Output] = useState("");
  const [layer2Loading, setLayer2Loading] = useState(false);

  const [datasets, setDatasets] = useState([]);
  const [incomeData, setIncomeData] = useState([]);
  const [shippingGuides, setShippingGuides] = useState([]);
  const [incomeEvidence, setIncomeEvidence] = useState(null);
  const [priceBench, setPriceBench] = useState(null); // KAMIS 연평균 도매·소매가(원/kg)
  const [inputBench, setInputBench] = useState(null); // 입력 검증용 시세(작목 선택 시 미리 조회)
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceAutoFilled, setPriceAutoFilled] = useState(false);

  // 사례 선택용 데이터 로드
  useEffect(() => {
    let alive = true;
    loadRdaCases().then(({ items }) => { if (alive) setCases(items); }).catch(() => {});
    loadPublicDatasets().then(({ items }) => { if (alive) setDatasets(items); }).catch(() => {});
    loadIncomeData().then(({ items }) => { if (alive) setIncomeData(items); }).catch(() => {});
    loadShippingGuides().then(({ items }) => { if (alive) setShippingGuides(items); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // 입력 검증용: 작목이 바뀌면 그 작목의 도매·소매 시세를 미리 받아 둔다(서버 캐시로 재조회 저렴).
  useEffect(() => {
    const meta = findCrop(form.crop);
    if (!meta?.kamis?.itemCode) { setInputBench(null); return; }
    let alive = true;
    fetchPriceBenchmark(meta).then((b) => { if (alive) setInputBench(b); });
    return () => { alive = false; };
  }, [form.crop]);

  // KAMIS 시황 자동 조회 (Step 3 진입 시)
  useEffect(() => {
    if (step !== 3) return;
    const cropMeta = findCrop(form.crop);
    if (!cropMeta?.kamis) return;

    setPriceLoading(true);
    setPriceAutoFilled(false);

    const today = new Date();
    const thisYear = today.getFullYear();
    const startDate = `${thisYear - 3}-01`;
    const endDate = `${thisYear}-${String(today.getMonth() + 1).padStart(2, "0")}`;

    const params = new URLSearchParams({
      startDate, endDate, period: "monthly",
      itemCode: cropMeta.kamis.itemCode,
      kindCode: cropMeta.kamis.kindCode,
    });

    fetch(`/api/kamis/price?${params}`)
      .then((r) => r.json())
      .then((data) => {
        // 도매(중도매인) 상품 항목만 사용
        const priceList = Array.isArray(data?.price) ? data.price : [];
        const wholesale = priceList.find(
          (p) => p.productclscode === "02" && p.caption?.includes("상품")
        ) || priceList.find((p) => p.productclscode === "02") || priceList[0];
        if (!wholesale?.item?.length) return;

        // 올해 데이터에서 가장 최근 유효 월 찾기
        const thisYearRow = wholesale.item.find((r) => r.yyyy === String(thisYear));
        if (!thisYearRow) return;

        const months = ["m1","m2","m3","m4","m5","m6","m7","m8","m9","m10","m11","m12"];
        const validMonths = months
          .map((m, i) => ({ month: i + 1, val: parseFloat(String(thisYearRow[m] || "").replace(/,/g, "")) }))
          .filter((x) => x.val > 0);
        if (validMonths.length === 0) return;

        const latestMonth = validMonths[validMonths.length - 1];
        const prevMonth = validMonths.length >= 2 ? validMonths[validMonths.length - 2] : null;

        // 평년: 최근 3년 같은 월 평균
        const prevYearRows = wholesale.item.filter((r) => r.yyyy !== String(thisYear));
        const prevPrices = prevYearRows
          .map((r) => parseFloat(String(r[`m${latestMonth.month}`] || "").replace(/,/g, "")))
          .filter((v) => v > 0);
        const pyAvg = prevPrices.length
          ? prevPrices.reduce((a, b) => a + b, 0) / prevPrices.length
          : latestMonth.val;

        const ratio = latestMonth.val / pyAvg;
        const vsAvg = ratio >= 1.1
          ? "평년 이상 (110%~)"
          : ratio <= 0.9
          ? "평년 이하 (~90%)"
          : "평년 수준 (90~110%)";

        let trend = "모름";
        if (prevMonth) {
          const r = latestMonth.val / prevMonth.val;
          trend = r >= 1.05 ? "상승" : r <= 0.95 ? "하락" : "횡보";
        }

        setLayer2Form((p) => ({
          ...p,
          curPrice: String(Math.round(latestMonth.val)),
          priceVsAvg: vsAvg,
          priceTrend: trend,
        }));
        setPriceAutoFilled(true);
      })
      .catch(() => {})
      .finally(() => setPriceLoading(false));
  }, [step]);

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

    // 소비월보 소비자 인사이트 조회
    const cropMeta = findCrop(form.crop);
    const consumeDataset = cropMeta?.consumeId
      ? datasets.find((d) => d.id === cropMeta.consumeId)
      : null;
    const consumerInsight = consumeDataset?.consumerInsight || null;

    // 소득자료(AMIS) 수익성·원가 근거 연계 + 농가 실제 소득률(입력 시)
    const bench = findIncome(form.crop, incomeData);
    const evidence = deriveIncomeEvidence(bench, form.curPrice);
    setIncomeEvidence(evidence);
    const econ = computeEcon(form, bench);
    // 농가 단가의 비교 기준은 KAMIS 도매·소매 시세 (실패해도 진단은 계속)
    const market = await fetchPriceBenchmark(cropMeta);
    setPriceBench(market);
    const incomeBlock = buildIncomeBlock(evidence, form.crop, econ, market);

    setLayer1Loading(true);
    setLayer1Output("");
    setCompareOutput("");
    setReasoningPortfolio(null);
    setLayer2Source("규칙기반");
    setStep(2);
    try {
      const prompt = buildLayer1Prompt(form, behaviorAnswers, ft, topsis, consumerInsight, incomeBlock, buildGuideBlock(shippingGuides, form.crop), buildInputFactsBlock(form, bench));
      await callClaude(prompt, (txt) => setLayer1Output(txt));
    } catch (e) {
      setLayer1Output("⚠️ 분석 중 오류가 발생했습니다: " + e.message);
    } finally {
      setLayer1Loading(false);
    }
  }

  // 추론 우선 방식으로 같은 입력을 다시 진단 (규칙기반 결과와 비교용)
  async function runCompare() {
    if (!farmerType || !topsisResult) return;
    // 근거 블록은 runLayer1과 동일하게 재계산 (표·유형은 state 재사용)
    const cropMeta = findCrop(form.crop);
    const consumeDataset = cropMeta?.consumeId
      ? datasets.find((d) => d.id === cropMeta.consumeId)
      : null;
    const consumerInsight = consumeDataset?.consumerInsight || null;
    const bench = findIncome(form.crop, incomeData);
    const evidence = deriveIncomeEvidence(bench, form.curPrice);
    const econ = computeEcon(form, bench);
    const market = priceBench || (await fetchPriceBenchmark(cropMeta));
    const incomeBlock = buildIncomeBlock(evidence, form.crop, econ, market);

    setCompareLoading(true);
    setCompareOutput("");
    setReasoningPortfolio(null);
    try {
      const prompt = buildLayer1PromptReasoning(form, behaviorAnswers, farmerType, topsisResult, consumerInsight, incomeBlock, buildGuideBlock(shippingGuides, form.crop), buildInputFactsBlock(form, bench));
      const full = await callClaude(prompt, (txt) => setCompareOutput(txt));
      // 추론 결과에서 포트폴리오 경로 파싱 → 레이어2 기준선 후보로 보관, 판독 라인은 화면에서 제거
      setReasoningPortfolio(parseReasoningPortfolio(full));
      setCompareOutput(stripPortfolioMarker(full));
    } catch (e) {
      setCompareOutput("⚠️ 비교 분석 중 오류가 발생했습니다: " + e.message);
    } finally {
      setCompareLoading(false);
    }
  }

  // AI 포트폴리오 진단 결과를 인쇄용 리포트(PDF 저장)로 출력
  function exportLayer1Pdf() {
    if (!layer1Output) return;
    const typeInfo = farmerType ? TYPE_INFO[farmerType.type] : null;
    const metaRows = [
      ["품목", form.crop ? `${form.crop}${form.variety ? ` (${form.variety})` : ""}` : "—"],
      ["재배면적", form.area || "—"],
      ["연간 출하물량", form.volume || "—"],
      ["지역", form.region || "—"],
      ["농가 유형", typeInfo ? `${farmerType.type}형 · ${typeInfo.label}` : "—"],
    ];
    const sections = [];
    // 핵심 요약을 리포트 맨 앞에 배치 (규칙기반 + 추론 우선 각각)
    const l1Split = splitSummary(layer1Output);
    const cmpSplit = splitSummary(compareOutput);
    if (l1Split.summary || cmpSplit.summary) {
      let summaryHtml = "";
      if (l1Split.summary) summaryHtml += `${cmpSplit.summary ? '<div class="md-h3">규칙기반 진단</div>' : ""}${markdownToPrintHtml(l1Split.summary)}`;
      if (cmpSplit.summary) summaryHtml += `<div class="md-h3">추론 우선 진단</div>${markdownToPrintHtml(cmpSplit.summary)}`;
      sections.push({ heading: "핵심 요약", bodyHtml: summaryHtml });
    }
    if (topsisResult?.length) {
      sections.push({
        heading: "판매경로 적합도 (TOPSIS 규칙기반 점수)",
        bodyHtml: `<table><thead><tr><th>순위</th><th>판매경로</th><th>점수</th><th>판정</th></tr></thead><tbody>${topsisResult
          .map((r, i) => {
            const verdict = r.score >= 65 ? "주력 후보" : r.score >= 50 ? "보완 후보" : r.score >= 35 ? "제한적" : "비추천";
            return `<tr><td>${i + 1}</td><td class="c0">${escapeHtml(r.route)}</td><td>${r.score}점</td><td>${verdict}</td></tr>`;
          })
          .join("")}</tbody></table>`,
      });
    }
    sections.push({ heading: "AI 포트폴리오 진단 결과 (규칙기반)", bodyHtml: markdownToPrintHtml(l1Split.body) });
    if (compareOutput) {
      let reasoningBody = "";
      if (reasoningPortfolio) {
        reasoningBody += `<table><thead><tr><th>구분</th><th>내용</th></tr></thead><tbody>${[
          ["구조 유형", reasoningPortfolio.structureType],
          ["주력 경로", reasoningPortfolio.mainRoute],
          ["보완 경로", reasoningPortfolio.subRoute],
          ["완충 경로", reasoningPortfolio.bufferRoute],
          ["판매 역량", reasoningPortfolio.capability],
        ].filter(([, v]) => v).map(([l, v]) => `<tr><td class="c0">${escapeHtml(l)}</td><td>${escapeHtml(v)}</td></tr>`).join("")}</tbody></table>`;
      }
      reasoningBody += markdownToPrintHtml(cmpSplit.body);
      sections.push({ heading: "추론 우선 방식 진단 결과", bodyHtml: reasoningBody });
    }
    openPrintReport({
      title: "AI 포트폴리오 진단 리포트",
      subtitle: "농가 경영진단 AI 대시보드 · 레이어1 판매경로 포트폴리오 분석",
      metaRows,
      sections,
    });
  }

  // 추론 우선 포트폴리오를 레이어2 출하 결정의 기준선으로 적용
  function applyReasoningToLayer2() {
    if (!reasoningPortfolio) return;
    setLayer2Form((p) => ({ ...p, ...reasoningPortfolio }));
    setLayer2Source("추론");
    setStep(3);
  }

  // 규칙기반(TOPSIS) 포트폴리오를 레이어2 기준선으로 적용하고 출하 결정으로 이동
  function goToLayer2RuleBased() {
    if (topsisResult && farmerType) {
      setLayer2Form((p) => ({
        ...p,
        mainRoute: topsisResult[0]?.route || "",
        subRoute: topsisResult[1]?.route || "없음",
        bufferRoute: topsisResult[2]?.route || "없음",
        capability: farmerType.type === "A" ? "높음" : farmerType.type === "D" ? "낮음" : "보통",
      }));
    }
    setLayer2Source("규칙기반");
    setStep(3);
  }

  async function runLayer2() {
    setLayer2Loading(true);
    setLayer2Output("");
    setStep(3);
    try {
      const prompt = buildLayer2Prompt(layer1Output ? "레이어1 진단 완료 — 아래 주력/보완/완충 경로가 그 결과다" : null, { ...layer2Form, crop: form.crop, storage: form.storage });
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

  // 작목 드롭다운: 레지스트리 작목 + income-data 작목 합집합
  const cropOptions = (() => {
    const names = new Set(CROP_REGISTRY.map((c) => c.name));
    (incomeData || []).forEach((c) => { if (c.name && !c.name.startsWith("예시")) names.add(c.name); });
    return [...names];
  })();

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
              {fieldGroup("품목 *", "crop", "text", cropOptions)}
              {fieldGroup("품종 *", "variety")}
              {fieldGroup("재배면적 (평) *", "area", "number")}
              {fieldGroup("연간 출하 물량 (kg) *", "volume", "number")}
              {fieldGroup("출하 가능 기간 (예: 11월~5월) (선택)", "shippingPeriod")}
              {fieldGroup("저장성 *", "storage", "text", ["낮음 (2~3일)", "보통 (1~2주)", "높음 (1개월 이상)"])}
              {fieldGroup("비상품률 (%) (선택)", "defectRate", "number")}
              {fieldGroup("지역 (선택)", "region")}
            </div>
            <div style={{ fontSize: 11.5, color: theme.textFaint, marginTop: 4 }}>
              ※ 비상품률 = 전체 생산량 중 정상 출하가 어려운(등급 미달) 물량 비율. 입력하면 비상품 처리 판로까지 진단합니다. 모르면 비워두세요.
            </div>
          </div>

          <div style={cardStyle}>
            <h3 style={{ fontSize: 16, color: theme.text, marginTop: 0, marginBottom: 20 }}>👥 노동력 조건</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
              {fieldGroup("농가주 연령 *", "age", "number")}
              {fieldGroup("가족노동력 수 (명) *", "labor", "number")}
              {fieldGroup("판매·포장 가능 구성원 *", "packMember", "text", ["있음", "없음"])}
            </div>
          </div>

          <div style={cardStyle}>
            <h3 style={{ fontSize: 16, color: theme.text, marginTop: 0, marginBottom: 20 }}>💼 판매 운영 역량</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
              {fieldGroup("직접 판매 경험 *", "directSaleExp", "text", ["없음", "단기", "지속적"])}
              {fieldGroup("도매시장 출하 경험 *", "wholesaleExp", "text", ["없음", "있음"])}
              {fieldGroup("온라인 판매 경험 *", "onlineExp", "text", ["없음", "일부 있음", "있음"])}
              {fieldGroup("로컬푸드·직거래 경험 *", "localExp", "text", ["없음", "일부 있음", "있음"])}
              {fieldGroup("고객응대·클레임 대응 경험 *", "claimExp", "text", ["없음", "있음"])}
              {fieldGroup("추가 시간 투입 가능 여부 *", "timeAvail", "text", ["어려움", "일부 가능", "충분히 가능"])}
              {fieldGroup("협상·거래 응대 부담 *", "negotiation", "text", ["부담됨", "보통", "괜찮음"])}
              {fieldGroup("로컬푸드 매장 접근성 *", "localAccess", "text", ["낮음", "보통", "좋음"])}
              {fieldGroup("포장 대응 가능 여부 *", "packCapable", "text", ["어려움", "가능"])}
            </div>
          </div>

          <div style={cardStyle}>
            <h3 style={{ fontSize: 16, color: theme.text, marginTop: 0, marginBottom: 20 }}>📌 참고 정보</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
              {fieldGroup("현재 판매경로 비중 (예: 도매80% 로컬20%) *", "currentRoutes")}
              {fieldGroup("현재 평균 판매단가 (원/kg) (선택)", "curPrice", "number")}
              {fieldGroup("총 경영비 (원, 전체 면적 기준) (선택)", "cost", "number")}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>특이사항</label>
                <input style={inputStyle} value={form.special} onChange={(e) => updateForm("special", e.target.value)} placeholder="없으면 비워두세요" />
              </div>
            </div>
          </div>

          {(() => {
            const warnings = buildInputWarnings(form, incomeData, inputBench);
            if (!warnings.length) return null;
            return (
              <div style={{ ...cardStyle, border: `1px solid ${theme.warn}55`, background: `${theme.warn}10` }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: theme.warn, marginBottom: 8 }}>
                  ⚠️ 입력값 확인 요청 <span style={{ fontWeight: 400, fontSize: 12, color: theme.textMuted }}>— 아래 값이 맞다면 그대로 진행하셔도 됩니다.</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {warnings.map((w, i) => (
                    <div key={i} style={{ fontSize: 12.5, color: theme.text, display: "flex", gap: 6 }}>
                      <span style={{ color: theme.warn, flexShrink: 0 }}>•</span>
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <div style={{ textAlign: "center" }}>
            <button style={btnPrimary} onClick={() => {
              const miss = REQUIRED_STEP0.find(([k]) => !String(form[k] ?? "").trim());
              if (miss) { alert(`필수 입력값이 비어 있습니다: ${miss[1]}`); return; }
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
                      <div style={{ width: `${r.score}%`, height: "100%", background: r.score >= 65 ? theme.accent : r.score >= 50 ? theme.info : theme.panelBorder, borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <PriceBenchmarkCard bench={priceBench} curPrice={incomeEvidence?.curPrice} amisPrice={incomeEvidence?.avgPrice} crop={form.crop} />

          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, color: theme.text, marginTop: 0, marginBottom: 4 }}>📊 수익성·원가 근거</h3>
            <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 14 }}>
              AMIS 농축산물 소득자료 · 전국 평균 · 10a(300평) 기준
            </div>
            {incomeEvidence ? (
              <>
                <div style={{ fontSize: 13, color: theme.text, marginBottom: 12 }}>
                  대상 작목 <b style={{ color: theme.accent }}>{incomeEvidence.name}</b>
                  {form.crop && form.crop !== incomeEvidence.name && (
                    <span style={{ color: theme.textFaint }}> (입력: {form.crop})</span>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  {[
                    ["전국 평균 소득률", incomeEvidence.incomeRate != null ? `${incomeEvidence.incomeRate}%` : "—"],
                    ["고용노동비 비중", incomeEvidence.laborShare != null ? `${incomeEvidence.laborShare}%` : "—"],
                    ["10a당 소득", incomeEvidence.income10a ? `${Math.round(incomeEvidence.income10a).toLocaleString()}원` : "—"],
                  ].map(([l, v]) => (
                    <div key={l} style={{ background: theme.panelAlt, borderRadius: 8, padding: "10px 12px", border: `1px solid ${theme.panelBorder}` }}>
                      <div style={{ fontSize: 11, color: theme.textFaint, marginBottom: 4 }}>{l}</div>
                      <div style={{ fontSize: 15, color: theme.text, fontWeight: 700 }}>{v}</div>
                    </div>
                  ))}
                </div>
                {incomeEvidence.avgPrice > 0 && (
                  <div style={{ fontSize: 11.5, color: theme.textFaint, marginTop: 10 }}>
                    참고 · 전국 농가 평균 수취단가 {incomeEvidence.avgPrice.toLocaleString()}원/kg
                    (내 단가의 높낮이는 위 도매·소매 시세로 비교합니다)
                  </div>
                )}
                {incomeEvidence.laborShare != null && incomeEvidence.laborShare >= 25 && (
                  <div style={{ fontSize: 12.5, color: theme.warn, marginTop: 8, background: `${theme.warn}14`, padding: "6px 10px", borderRadius: 8 }}>
                    💡 고용노동비 비중이 높은 작목입니다. 온라인 소포장 등 노동집약 경로는 추가 노동부담을 함께 고려하세요.
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: theme.textFaint }}>
                이 품목은 소득자료에 매칭되는 작목이 없어 일반 수익성 기준으로 진단했습니다. (품목명을 소득자료의 작목명과 맞추면 근거가 표시됩니다)
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              <h3 style={{ fontSize: 15, color: theme.text, margin: 0 }}>
                🤖 AI 포트폴리오 진단 결과
                {layer1Loading && <span style={{ fontSize: 12, color: theme.accent, marginLeft: 8, fontWeight: 400 }}>분석 중...</span>}
              </h3>
              {!layer1Loading && layer1Output && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    style={{ ...btnSecondary, padding: "7px 16px", fontSize: 13 }}
                    onClick={exportLayer1Pdf}
                    title={compareOutput
                      ? "규칙기반 + 추론 우선 결과가 모두 포함됩니다. 인쇄 창에서 'PDF로 저장'을 선택하세요"
                      : "규칙기반 결과가 포함됩니다. 추론 결과도 넣으려면 먼저 '추론 우선 방식으로 비교'를 실행하세요"}
                  >
                    📄 PDF 저장{compareOutput ? " (규칙+추론)" : " (규칙기반)"}
                  </button>
                  <button
                    style={{ ...btnSecondary, padding: "7px 16px", fontSize: 13, opacity: compareLoading ? 0.6 : 1 }}
                    disabled={compareLoading}
                    onClick={runCompare}
                  >
                    {compareLoading ? "추론 진단 중..." : compareOutput ? "🧠 추론 우선 다시 비교" : "🧠 추론 우선 방식으로 비교"}
                  </button>
                </div>
              )}
            </div>

            {(compareOutput || compareLoading) ? (
              // 비교 모드: 규칙기반(현재) vs 추론 우선 나란히
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
                <div style={{ border: `1px solid ${theme.panelBorder}`, borderRadius: 10, padding: 14, background: `${theme.panelAlt}55` }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: theme.textMuted, marginBottom: 4 }}>규칙기반 (현재)</div>
                  <div style={{ fontSize: 11, color: theme.textFaint, marginBottom: 10 }}>TOPSIS 표 → LLM 해설</div>
                  <AnalysisResult text={layer1Output} loading={layer1Loading} maxHeight={560} emptyText="결과 없음" />
                </div>
                <div style={{ border: `1.5px solid ${theme.accent}66`, borderRadius: 10, padding: 14, background: `${theme.accent}0c` }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: theme.accent, marginBottom: 4 }}>🧠 추론 우선</div>
                  <div style={{ fontSize: 11, color: theme.textFaint, marginBottom: 10 }}>LLM 추론 → 표는 참고값</div>
                  <AnalysisResult text={compareOutput} loading={compareLoading} maxHeight={560} loadingText="🌱 추론 진단 중입니다..." />
                  {reasoningPortfolio && !compareLoading && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${theme.divider}`, textAlign: "center" }}>
                      {ENABLE_LAYER2 && (
                        <button style={{ ...btnPrimary, padding: "10px 20px", fontSize: 14 }} onClick={applyReasoningToLayer2}>
                          🧠 이 추론 포트폴리오로 출하 결정(Layer2) →
                        </button>
                      )}
                      <div style={{ fontSize: 11.5, color: theme.textFaint, marginTop: 6 }}>
                        {reasoningPortfolio.structureType ? `구조 ${reasoningPortfolio.structureType} · ` : ""}주력 <b style={{ color: theme.accent }}>{reasoningPortfolio.mainRoute}</b> · 보완 {reasoningPortfolio.subRoute} · 완충 {reasoningPortfolio.bufferRoute} · 역량 {reasoningPortfolio.capability}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <AnalysisResult text={layer1Output} loading={layer1Loading} maxHeight={500} />
            )}
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button style={btnSecondary} onClick={() => setStep(1)}>← 성향 재진단</button>
            {ENABLE_LAYER2 && !layer1Loading && (
              <button style={btnPrimary} onClick={goToLayer2RuleBased}>
                출하 의사결정 (레이어2) →
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── STEP 3: 레이어2 출하 의사결정 (ENABLE_LAYER2 로 노출 제어) ── */}
      {ENABLE_LAYER2 && step === 3 && (
        <div>
          <div style={{ ...cardStyle, background: `${theme.warn}12`, border: `1px solid ${theme.warn}40` }}>
            <h3 style={{ fontSize: 16, color: theme.warn, marginTop: 0 }}>🚚 레이어2 — 이번 출하 의사결정</h3>
            <p style={{ fontSize: 13, color: theme.textMuted, margin: 0 }}>
              레이어1 포트폴리오를 기준선으로, 이번 수확의 실제 출하 경로와 물량 배분을 결정합니다.
            </p>
          </div>

          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, color: theme.text, marginTop: 0, marginBottom: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              📌 포트폴리오 기준선 (레이어1 결과 자동 연동)
              <span style={{
                fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
                background: layer2Source === "추론" ? `${theme.accent}22` : theme.panelAlt,
                color: layer2Source === "추론" ? theme.accent : theme.textMuted,
                border: `1px solid ${layer2Source === "추론" ? theme.accent + "66" : theme.panelBorder}`,
              }}>
                {layer2Source === "추론" ? "🧠 추론 우선 기준선" : "규칙기반 TOPSIS 기준선"}
              </span>
            </h3>
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
            <h3 style={{ fontSize: 15, color: theme.text, marginTop: 0, marginBottom: 16 }}>
              📈 시황 정보
              {priceLoading && <span style={{ fontSize: 12, color: theme.accent, marginLeft: 8, fontWeight: 400 }}>KAMIS 조회 중...</span>}
              {priceAutoFilled && !priceLoading && <span style={{ fontSize: 12, color: theme.accent, marginLeft: 8, fontWeight: 400 }}>✓ KAMIS 자동 업데이트</span>}
              {!priceLoading && !priceAutoFilled && <span style={{ fontSize: 12, color: theme.textFaint, marginLeft: 8, fontWeight: 400 }}>수동 입력</span>}
            </h3>
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
              <AnalysisResult text={layer2Output} loading={layer2Loading} maxHeight={600} />
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

// ─── 시장 시세 기준선 (KAMIS 도매·소매 vs 내 단가) ──────────────
// 농가 단가를 '전국 농가 평균 수취가'와 견주면 유통 구조가 보이지 않는다.
// 도매가는 도매 출하 시 기대 상한, 소매가와의 차이는 직거래로 회수 가능한 마진이라
// 이 둘을 판로 판단의 기준선으로 삼는다.
function PriceBenchmarkCard({ bench, curPrice, amisPrice, crop }) {
  if (!bench?.wholesale && !bench?.retail) return null;
  const w = bench.wholesale?.pricePerKg || null;
  const r = bench.retail?.pricePerKg || null;
  const margin = w && r ? r - w : null;
  // 판정은 같은 성격(농가 수취가)끼리 비교한다: 내 단가 vs 전국 농가 평균 수취(AMIS).
  // 도매·소매는 유통 단계 기준선이라 농가 수취가는 원래 그보다 낮은 게 정상이므로
  // 도매 대비 %로 잘잘못을 가리지 않는다(감자·무 등 대량작물에서 오경고 방지).
  const vsAmis = curPrice && amisPrice ? Math.round((curPrice / amisPrice) * 1000) / 10 : null;

  const cells = [
    ["도매 평균", w, bench.wholesale && `${bench.wholesale.year}년 · ${bench.wholesale.unit} 기준`, theme.accent],
    ["소매 평균", r, bench.retail && `${bench.retail.year}년 · ${bench.retail.unit} 기준`, theme.info],
    ["내 판매단가", curPrice, curPrice ? "입력값" : "미입력", theme.text],
  ];

  return (
    <div style={cardStyle}>
      <h3 style={{ fontSize: 15, color: theme.text, marginTop: 0, marginBottom: 4 }}>💰 시장 시세 기준선</h3>
      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 14 }}>
        KAMIS 서울 도매·소매 · 상품 등급 · 원/kg 환산{crop ? ` · ${crop}` : ""}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {cells.map(([label, value, sub, color]) => (
          <div key={label} style={{ background: theme.panelAlt, borderRadius: 8, padding: "10px 12px", border: `1px solid ${theme.panelBorder}` }}>
            <div style={{ fontSize: 11, color: theme.textFaint, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: value ? color : theme.textFaint }}>
              {value ? `${value.toLocaleString()}원/kg` : "—"}
            </div>
            {sub && <div style={{ fontSize: 10.5, color: theme.textFaint, marginTop: 3 }}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* 내 단가의 유통상 위치는 사실만(중립) — 농가 수취<도매<소매는 정상 구조 */}
      {curPrice != null && (w || r) && (
        <div style={{ fontSize: 12, color: theme.textFaint, marginTop: 12 }}>
          내 단가는 {w && `도매 평균의 ${Math.round((curPrice / w) * 1000) / 10}%`}
          {w && r && " · "}
          {r && `소매 평균의 ${Math.round((curPrice / r) * 1000) / 10}%`} 수준입니다.
        </div>
      )}

      {/* 잘 받는지 여부는 같은 성격끼리: 내 단가 vs 전국 농가 평균 수취(AMIS) */}
      {vsAmis != null && (
        <div style={{ fontSize: 12.5, color: theme.textMuted, marginTop: 6 }}>
          전국 농가 평균 수취({amisPrice.toLocaleString()}원/kg) 대비{" "}
          <b style={{ color: vsAmis >= 105 ? theme.accent : vsAmis <= 90 ? theme.warn : theme.text }}>
            {vsAmis >= 100 ? "+" : ""}{Math.round((vsAmis - 100) * 10) / 10}%
          </b>
          {vsAmis >= 110 && <span style={{ color: theme.accent }}> · 전국 농가보다 높게 받고 있습니다. 이 단가를 만드는 경로를 유지·확대하세요.</span>}
          {vsAmis <= 90 && <span style={{ color: theme.warn }}> · 전국 농가 평균보다 낮습니다 → 등급·선별이나 판매경로 구성을 점검하세요.</span>}
        </div>
      )}

      {margin != null && margin > 0 && (
        <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 8, background: theme.panelAlt, padding: "8px 12px", borderRadius: 8 }}>
          도매↔소매 차이 <b style={{ color: theme.info }}>{margin.toLocaleString()}원/kg</b> — 직거래로 회수를 노려볼 수 있는 유통 마진의 크기입니다.
          (배송·포장·응대 비용은 별도로 빠집니다)
        </div>
      )}
    </div>
  );
}
