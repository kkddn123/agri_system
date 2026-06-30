// 농촌진흥청 AMIS '농축산물 소득자료' OpenAPI → public/data/income-data.json 생성 스크립트
//
// "한 번 받아 JSON으로 저장" 방식. 소득자료는 연 1회 갱신.
//
// 사용법 (프로젝트 루트에서)
//   node scripts/fetch_income_data.mjs                 # 전체 작목 수집 → income-data.json 갱신
//   node scripts/fetch_income_data.mjs --limit 10      # 앞 10개만 (시험)
//   node scripts/fetch_income_data.mjs --year 2023     # 연도 지정
//   node scripts/fetch_income_data.mjs --area CM0141   # 특정 시도(경기도). 생략 시 기본(전국/대표)
//   node scripts/fetch_income_data.mjs --dry           # 저장 안 함
//
// ── 검증된 호출 사양 (담당자 확인, 2024 봄감자 resultCode 00) ──
//   엔드포인트 : https://amis.rda.go.kr/portal/openapi/ap/survey/profitAnalysisxml
//   파라미터   : apiKey, searchYear, wYear, insCode, jakmokCode (+ areaCode 선택)
//   응답       : XML <service><resultCode>00</resultCode><Count>n</Count><list><item>…</item></list></service>
//   결과코드   : 00 정상 / 01 필수값누락 / 02 사용권한없음 / 03 2014년이전
//   주의       : 연속 호출 시 서버가 throttle(빈 응답) → 딜레이+재시도 필요
//
// 코드표: scripts/amis_codes.json (insCode 13 · sidoCode 17 · jakmokCode 249)

import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(__dirname, "..", "public", "data", "income-data.json");
const CODES = JSON.parse(readFileSync(resolve(__dirname, "amis_codes.json"), "utf8"));
const BASE = "https://amis.rda.go.kr/portal/openapi/ap/survey/profitAnalysisxml";

// ── 옵션 파싱 ──
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const YEAR = opt("--year", "2024");
const AREA = opt("--area", null);            // 생략 시 areaCode 미전송
const LIMIT = parseInt(opt("--limit", "0")) || 0;
const DELAY = parseInt(opt("--delay", "1500"));  // 호출 간 기본 딜레이(ms)
const DRY = args.includes("--dry");

const KEY = process.env.INCOME_API_KEY;
if (!KEY) { console.error("[오류] .env 에 INCOME_API_KEY 가 없습니다."); process.exit(1); }

// AMIS 필드 → 대시보드 스키마
const FIELD = {
  name: "gubnCode4Name", total: "co010000Cost", cost: "co030000Cost",
  income: "co050000Cost", rate: "co050104Amount",
  unit: "co010100Unitcost", yield: "co010100Amount",
};

// 경영비 구조(원/10a) — 판매경로 진단의 "운영 효율/실행 제약" 근거로 사용
// 합: 중간재비 + 임차료 + 위탁영농비 + 고용노동비 ≈ 경영비
const COST_FIELD = {
  materials: "co020000Cost",      // 중간재비(비료·농약·광열·제재료·상각 묶음)
  fertilizer_inorganic: "co020300Cost", // 무기질비료비
  fertilizer_organic: "co020500Cost",   // 유기질비료비
  pesticide: "co020900Cost",      // 농약비
  energy: "co021000Cost",         // 광열동력비
  materials_etc: "co021200Cost",  // 제재료비
  depreciation_equip: "co021700Cost",   // 대농기구상각비
  depreciation_facility: "co021800Cost", // 영농시설상각비
  rent: "co030103Cost",           // 임차료(토지)
  consignment: "co030200Cost",    // 위탁영농비
  hired_labor: "co030300Cost",    // 고용노동비
};
// 참고 지표(원/10a)
const EXTRA_FIELD = {
  production_cost: "co040000Cost", // 생산비(경영비+자가노동·자본용역)
  value_added: "co050103Cost",     // 부가가치
  net_profit: "co050101Cost",      // 순수익
};
const PREFIX_CATEGORY = {
  FC: "식량작물", FL: "화훼", FT: "과수", IC: "특용작물", VC: "채소", IN: "양잠·양봉", LP: "축산",
};

// 작목명/코드로 후보 insCode를 우선순위대로 추론
function inferInsCodes(name, code) {
  const p = code.slice(0, 2);
  const 시설 = name.includes("시설");
  if (name.includes("느타리")) return ["KIN06"];
  if (name.includes("표고") || name.includes("영지")) return ["KIN09"];
  if (name.includes("새송이") || name.includes("팽이")) return ["KIN10"];
  if (p === "FC") return ["KIN01"];
  if (p === "FL") return ["KIN04"];
  if (p === "FT") return 시설 ? ["KIN08", "KIN03"] : ["KIN03", "KIN08"];
  if (p === "VC") return 시설 ? ["KIN12", "KIN02", "KIN11"] : ["KIN11", "KIN02", "KIN12"];
  if (p === "IC") return ["KIN01", "KIN02"];
  if (p === "LP") return ["KIN07"];
  if (p === "IN") return name.includes("양봉") ? ["KIN70"] : ["KIN05"];
  return ["KIN01"];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = (x, t) => x.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1]?.trim() ?? "";
const round = (v, d = 0) => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/,/g, "")); if (!Number.isFinite(n)) return null;
  const f = 10 ** d; return Math.round(n * f) / f;
};

// 단일 호출 (빈 응답=throttle 이면 백오프 재시도)
async function callOnce(jakmokCode, insCode) {
  const p = { apiKey: KEY, searchYear: YEAR, wYear: YEAR, insCode, jakmokCode };
  if (AREA) p.areaCode = AREA;
  for (let attempt = 0; attempt < 4; attempt++) {
    let body = "";
    try {
      const r = await fetch(`${BASE}?${new URLSearchParams(p)}`);
      body = await r.text();
    } catch { /* 네트워크 오류도 재시도 */ }
    const rc = tag(body, "resultCode");
    if (rc !== "") return { rc, count: tag(body, "Count"), body };
    await sleep(1500 * (attempt + 1));  // throttle 백오프
  }
  return { rc: "EMPTY", count: "", body: "" };
}

// 후보 insCode를 차례로 시도 → 데이터(00 & Count>0) 나오면 채택
async function fetchCrop(crop) {
  for (const ins of inferInsCodes(crop.name, crop.code)) {
    const { rc, count, body } = await callOnce(crop.code, ins);
    if (rc === "00" && count !== "0") return { status: "data", ins, body };
    if (rc === "02") return { status: "denied", ins };       // 권한 없음 — 다른 ins도 무의미
    if (rc === "EMPTY") return { status: "throttled", ins };  // throttle — 중단 표시
    // rc==00 & count==0 (이 ins엔 데이터 없음) → 다음 후보 ins 시도
    await sleep(DELAY);
  }
  return { status: "nodata" };
}

function toRecord(crop, body) {
  const item = body.match(/<item>([\s\S]*?)<\/item>/)?.[1] ?? body;
  const g = (t) => tag(item, t);
  const total = round(g(FIELD.total)), cost = round(g(FIELD.cost));
  let income = round(g(FIELD.income));
  if (income == null && total != null && cost != null) income = total - cost;
  let rate = round(g(FIELD.rate), 1);
  if (rate == null && income != null && total) rate = round((income / total) * 100, 1);
  const mapNums = (m) => Object.fromEntries(
    Object.entries(m).map(([k, f]) => [k, round(g(f))])
  );

  return {
    id: `CROP-${g(FIELD.name) || crop.name}`, _example: false,
    name: g(FIELD.name) || crop.name,
    category: PREFIX_CATEGORY[crop.code.slice(0, 2)] || "",
    total_revenue_per_10a: total, management_cost_per_10a: cost,
    income_per_10a: income, income_rate_pct: rate,
    unit_price_per_kg: round(g(FIELD.unit)), yield_per_10a_kg: round(g(FIELD.yield)),
    costs: mapNums(COST_FIELD),     // 경영비 항목 구조(원/10a)
    extra: mapNums(EXTRA_FIELD),    // 생산비·부가가치·순수익(원/10a)
  };
}

async function main() {
  let crops = CODES.jakmokCode;
  if (LIMIT) crops = crops.slice(0, LIMIT);
  console.log(`AMIS 소득자료 수집 — ${YEAR}년, 작목 ${crops.length}개${AREA ? `, 지역 ${AREA}` : " (지역 기본)"}, 딜레이 ${DELAY}ms`);
  console.log(`키: ${KEY.slice(0, 6)}…\n`);

  const records = [], denied = [], nodata = []; let throttled = 0;
  for (let i = 0; i < crops.length; i++) {
    const crop = crops[i];
    const res = await fetchCrop(crop);
    const pos = `(${i + 1}/${crops.length})`;
    if (res.status === "data") {
      const rec = toRecord(crop, res.body); records.push(rec);
      console.log(`  ✓ ${pos} ${rec.name} [${res.ins}] 소득 ${rec.income_per_10a?.toLocaleString()} (소득률 ${rec.income_rate_pct}%)`);
    } else if (res.status === "denied") {
      denied.push(crop.name); console.log(`  ⨯ ${pos} ${crop.name} → 02 권한없음`);
    } else if (res.status === "throttled") {
      throttled++; console.log(`  … ${pos} ${crop.name} → throttle(빈응답), 건너뜀`);
    } else {
      nodata.push(crop.name); console.log(`  · ${pos} ${crop.name} → 데이터 없음`);
    }
    await sleep(DELAY);
  }

  console.log(`\n수집 ${records.length} · 권한없음 ${denied.length} · 데이터없음 ${nodata.length} · throttle ${throttled}`);
  if (denied.length) console.log(`  권한없음 예: ${denied.slice(0, 10).join(", ")}${denied.length > 10 ? " …" : ""}`);

  if (DRY) { console.log("\n--dry: 저장 안 함."); return; }
  if (!records.length) { console.error("\n수집 0건. JSON 그대로 둠."); process.exit(2); }

  const payload = {
    _안내: "scripts/fetch_income_data.mjs 로 AMIS OpenAPI에서 자동 생성. 수동 편집 시 덮어쓰임.",
    meta: {
      year: YEAR, unit: "원/10a (10a = 300평 = 1,000㎡)",
      area: AREA || "기본(전국/대표)",
      source: "농촌진흥청 AMIS 농축산물 소득자료 OpenAPI (profitAnalysisxml)",
      crop_count: records.length, fetched_at: new Date().toISOString(),
    },
    crops: records,
  };
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\n완료: ${records.length}개 작목 → ${OUT_FILE}`);
}

main().catch((e) => { console.error("실패:", e.message); process.exit(1); });
