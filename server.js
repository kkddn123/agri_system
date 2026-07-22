// 이 서버는 브라우저 대신 AI API(Anthropic/OpenAI/Gemini)를 호출해주는 역할만 합니다.
// API 키는 .env 파일에만 두고, 프론트엔드(브라우저) 코드에는 절대 넣지 않습니다.
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3001;
const KAMIS_KEY = process.env.KAMIS_API_KEY;

// AI 제공자 전환: .env 의 AI_PROVIDER 값으로 선택 (anthropic | openai | gemini)
// OpenAI와 Gemini는 같은 "OpenAI 호환" 스트림 형식을 쓰므로 어댑터 하나를 공유합니다.
const AI_PROVIDER = (process.env.AI_PROVIDER || "anthropic").toLowerCase();
const PROVIDERS = {
  anthropic: {
    keyEnv: "ANTHROPIC_API_KEY",
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
  },
  openai: {
    keyEnv: "OPENAI_API_KEY",
    // OPENAI_API_URL 로 재정의하면 Ollama·LM Studio 등 OpenAI 호환 로컬 서버도 사용 가능
    url: process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions",
    model: process.env.OPENAI_MODEL || "gpt-5.1",
  },
  gemini: {
    keyEnv: "GEMINI_API_KEY",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  },
};

app.post("/api/analyze", async (req, res) => {
  const provider = PROVIDERS[AI_PROVIDER];
  if (!provider) {
    res.status(500).json({ error: `.env 의 AI_PROVIDER 값이 잘못되었습니다: "${AI_PROVIDER}" (anthropic | openai | gemini 중 하나)` });
    return;
  }
  const apiKey = process.env[provider.keyEnv];
  if (!apiKey || apiKey.includes("여기에")) {
    res.status(500).json({ error: `.env 파일에 ${provider.keyEnv}가 설정되어 있지 않습니다. (현재 AI_PROVIDER=${AI_PROVIDER})` });
    return;
  }
  const { prompt } = req.body || {};
  if (!prompt) {
    res.status(400).json({ error: "prompt가 필요합니다." });
    return;
  }

  try {
    if (AI_PROVIDER === "anthropic") {
      await streamAnthropic(res, apiKey, provider.model, prompt);
    } else {
      await streamOpenAICompat(res, provider, apiKey, prompt);
    }
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
    else res.end();
  }
});

// Anthropic은 프론트엔드가 기대하는 형식(content_block_delta) 그대로 주므로 통째로 중계
async function streamAnthropic(res, apiKey, model, prompt) {
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      stream: true,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    res.status(upstream.status).json({ error: text });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const reader = upstream.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

// OpenAI/Gemini 스트림(choices[].delta.content)을 Anthropic 이벤트 형식으로 변환해 중계
// → 프론트엔드(callClaude)는 제공자와 무관하게 동일하게 동작
// max_tokens 는 보내지 않음: GPT-5 계열이 이 파라미터를 거부하며, 미지정 시 모델 기본 상한 사용
async function streamOpenAICompat(res, provider, apiKey, prompt) {
  const upstream = await fetch(provider.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      stream: true,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    res.status(upstream.status).json({ error: text });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = ""; // SSE 라인이 청크 경계에서 잘리면 다음 청크로 이월
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const text = JSON.parse(data).choices?.[0]?.delta?.content;
        if (text) res.write(`data: ${JSON.stringify({ type: "content_block_delta", delta: { text } })}\n\n`);
      } catch { /* 파싱 불가 라인은 무시 */ }
    }
  }
  res.end();
}

// KAMIS 가격 조회 (일별/월별/연별)
// 월별·연별은 품목 파라미터를 그대로 받는 monthly/yearlySalesList 사용.
// 일별은 dailySalesList 를 쓰면 안 된다 — 그 액션은 "최신 영업일 전체 품목 목록"이라
// p_itemcode·기간을 무시하고 늘 같은 232건을 돌려준다. 품목별 일자 시계열은
// periodProductList 가 정확한 액션이므로 daily 만 이쪽으로 보낸다.
const KAMIS_ACTIONS = {
  monthly: "monthlySalesList",
  yearly: "yearlySalesList",
};

// periodProductList 는 날짜를 YYYY-MM-DD 로 받는다 (다른 액션은 YYYYMMDD)
const dashDate = (s) => {
  const v = String(s || "").replace(/-/g, "");
  return v.length === 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v;
};

app.get("/api/kamis/price", async (req, res) => {
  const {
    startDate, endDate, itemCode, kindCode,
    countryCode = "1101", rankCode = "04", period = "daily",
    categoryCode = "", clsCode = "02", // clsCode: 01 소매 / 02 도매
  } = req.query;
  if (!startDate || !endDate || !itemCode) {
    return res.status(400).json({ error: "startDate, endDate, itemCode 파라미터가 필요합니다." });
  }

  const base = { p_cert_key: KAMIS_KEY, p_cert_id: "5005", p_returntype: "json" };
  const isDaily = period === "daily";
  const action = isDaily ? "periodProductList" : (KAMIS_ACTIONS[period] || KAMIS_ACTIONS.monthly);
  const params = new URLSearchParams(
    isDaily
      ? {
          ...base,
          p_startday: dashDate(startDate),
          p_endday: dashDate(endDate),
          p_itemcategorycode: categoryCode,
          p_itemcode: itemCode,
          p_kindcode: kindCode || "01",
          p_productrankcode: rankCode,
          p_countrycode: countryCode,
          p_productclscode: clsCode,
          p_convert_kg_yn: "N",
        }
      : {
          ...base,
          p_startday: startDate,
          p_endday: endDate,
          p_itemcode: itemCode,
          p_kindcode: kindCode || "01",
          p_countrycode: countryCode,
          p_rankcode: rankCode,
        }
  );

  try {
    const r = await fetch(`http://www.kamis.or.kr/service/price/xml.do?action=${action}&${params}`);
    const data = await r.json();
    if (!isDaily) return res.json(data);

    // periodProductList 응답을 프론트가 쓰기 쉬운 시계열 형태로 정규화.
    // 가격에 천단위 콤마가 섞여 오고, 조회 결과가 없으면 item 이 배열이 아닐 수 있다.
    const rawItems = Array.isArray(data?.data?.item) ? data.data.item : [];
    const series = rawItems
      .filter((x) => x.regday && x.price && x.price !== "-")
      .map((x) => ({
        date: `${x.yyyy}-${String(x.regday).replace(/\//g, "-")}`,
        price: Number(String(x.price).replace(/,/g, "")),
        market: x.countyname || "",
      }))
      .filter((x) => Number.isFinite(x.price))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      period: "daily",
      clsCode,
      error_code: data?.data?.error_code ?? "000",
      series,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 판매경로 진단용 시세 기준선 — 해당 품목의 연평균 도매·소매가를 원/kg 으로 환산해 제공.
// 농가 수취단가를 도매·소매와 견주어 "유통 단계에서 얼마를 남기고 있는가"를 보기 위한 값이라
// 단위가 5kg·20kg·100g 등으로 제각각인 KAMIS 응답을 kg 기준으로 통일해 돌려준다.
const unitToKg = (s) => {
  const t = String(s || "");
  const kg = t.match(/([\d.]+)\s*kg/i);
  if (kg) return parseFloat(kg[1]);
  const g = t.match(/([\d.]+)\s*g/i);
  if (g) return parseFloat(g[1]) / 1000;
  return null;
};
const num = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

// KAMIS 는 과부하 시 JSON 대신 에러 HTML/빈 응답을 줘서 r.json() 이 간헐적으로 터진다.
// 텍스트로 받아 직접 파싱하고, 실패하면 짧게 백오프하며 재시도한다.
async function fetchKamisJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      const text = await r.text();
      const json = JSON.parse(text);
      if (json) return json;
    } catch { /* 파싱 실패 = 일시적 오류로 보고 재시도 */ }
    if (i < tries - 1) await new Promise((s) => setTimeout(s, 600 * (i + 1)));
  }
  return null;
}

// 성공 결과는 메모리에 캐시한다 — 시연 중 같은 품목을 반복 조회해도 KAMIS 를 다시 때리지 않아
// 응답이 빠르고 안정적이다. 시세 기준선은 연 단위 값이라 하루짜리 TTL로 충분.
const benchCache = new Map(); // key: `${itemCode}:${kindCode}` → { at, value }
const BENCH_TTL = 24 * 60 * 60 * 1000;

app.get("/api/kamis/benchmark", async (req, res) => {
  const { itemCode, kindCode = "00", countryCode = "1101", rankCode = "04" } = req.query;
  if (!itemCode) return res.status(400).json({ error: "itemCode 파라미터가 필요합니다." });

  const cacheKey = `${itemCode}:${kindCode}`;
  const cached = benchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < BENCH_TTL) return res.json(cached.value);

  const thisYear = new Date().getFullYear();
  const params = new URLSearchParams({
    p_cert_key: KAMIS_KEY,
    p_cert_id: "5005",
    p_returntype: "json",
    p_startday: `${thisYear - 2}0101`,
    p_endday: `${thisYear}1231`,
    p_itemcode: itemCode,
    p_kindcode: kindCode,
    p_countrycode: countryCode,
    p_rankcode: rankCode,
  });

  const data = await fetchKamisJson(`http://www.kamis.or.kr/service/price/xml.do?action=yearlySalesList&${params}`);
  const list = Array.isArray(data?.price) ? data.price : [];

  // 같은 부류에 상품·중품이 함께 오므로 '상품'만 쓴다. 연도는 최신값 우선.
  const pick = (clsCode) => {
    for (const p of list) {
      if (p.productclscode !== clsCode) continue;
      if (!String(p.caption || "").includes("상품")) continue;
      const perUnit = unitToKg(String(p.caption).split(">").pop());
      const rows = Array.isArray(p.item) ? p.item : [];
      for (const row of rows.filter((x) => /^\d{4}$/.test(x.div)).sort((a, b) => b.div.localeCompare(a.div))) {
        const avg = num(row.avg_data);
        if (avg && perUnit) {
          return { year: row.div, pricePerKg: Math.round(avg / perUnit), unit: String(p.caption).split(">").pop().trim() };
        }
      }
    }
    return null;
  };

  const value = { wholesale: pick("02"), retail: pick("01") };
  // 실제 값이 있을 때만 캐시 — 상류 실패(빈 결과)를 굳혀 두지 않는다.
  if (value.wholesale || value.retail) benchCache.set(cacheKey, { at: Date.now(), value });
  res.json(value); // 실패해도 200 + 빈 값: 프론트는 카드만 감추고 진단은 계속
});

// KAMIS 품목 코드 목록 조회
app.get("/api/kamis/items", async (req, res) => {
  const params = new URLSearchParams({
    p_cert_key: KAMIS_KEY,
    p_cert_id: "5005",
    p_returntype: "json",
  });
  try {
    const r = await fetch(`http://www.kamis.or.kr/service/price/xml.do?action=itemList&${params}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 농식품 소매 소비 트렌드 조회 (W_DI_AGRICNSMTRND)
const MAFRA_KEY = process.env.MAFRA_API_KEY;
const MAFRA_TREND_URL = MAFRA_KEY
  ? `http://211.237.50.150:7080/openapi/${MAFRA_KEY}/xml/Grid_20260128000000000689_1`
  : "http://211.237.50.150:7080/openapi/sample/xml/Grid_20260128000000000689_1";

function parseTrendXml(xml) {
  return [...xml.matchAll(/<row>([\s\S]*?)<\/row>/g)].map((m) => {
    const get = (tag) => m[1].match(new RegExp(`<${tag}>(.*?)<\/${tag}>`))?.[1] ?? "";
    return {
      year: get("CRTR_YEAR"), month: get("CRTR_MONTH"),
      category: get("CLSF_NM"), item: get("ITEM_NM"),
      monPurchaseAmt: parseFloat(get("MON_PRCHS_AMT")) || 0,
      monPurchaseCnt: parseFloat(get("MON_PRCHS_NOCS")) || 0,
      monAvgAmt: parseFloat(get("MON_AVG_AMT")) || 0,
      yearAvgAmt: parseFloat(get("YEAR_AVG_AMT")) || 0,
      monMaxAmt: parseFloat(get("MON_MAX_AMT")) || 0,
      monMinAmt: parseFloat(get("MON_MIN_AMT")) || 0,
      monFlctnCffcnt: parseFloat(get("MON_FLCTN_CFFCNT")) || 0,
      yearFlctnCffcnt: parseFloat(get("YEAR_FLCTN_CFFCNT")) || 0,
      estmtnSslAmt: parseFloat(get("ESTMTN_SLS_AMT")) || 0,
    };
  });
}

app.get("/api/consume/trend", async (req, res) => {
  const { year, month, item } = req.query;
  // 샘플 API는 한 번에 최대 5건 → 순차적으로 모두 수집
  const BATCH = MAFRA_KEY ? 100 : 5;
  const MAX_ROWS = 1277;
  try {
    // 첫 요청으로 totalCnt 파악
    const first = await fetch(`${MAFRA_TREND_URL}/1/${BATCH}`);
    const firstXml = await first.text();
    const totalCnt = parseInt(firstXml.match(/<totalCnt>(\d+)<\/totalCnt>/)?.[1] || "0");
    const limit = Math.min(totalCnt, MAX_ROWS);

    // 나머지 배치 병렬 fetch (실패 시 무시)
    const batches = [firstXml];
    const promises = [];
    for (let s = BATCH + 1; s <= limit; s += BATCH) {
      const e = Math.min(s + BATCH - 1, limit);
      promises.push(
        fetch(`${MAFRA_TREND_URL}/${s}/${e}`)
          .then((r) => r.text())
          .catch(() => "")
      );
    }
    const rest = await Promise.all(promises);
    // 오류 응답(ERROR 코드 포함) 제거
    batches.push(...rest.filter((x) => x && !x.includes("ERROR")));

    const allRows = batches.flatMap(parseTrendXml);
    const filtered = allRows.filter((r) =>
      (!year || r.year === year) &&
      (!month || r.month === month) &&
      (!item || r.item.includes(item))
    );
    res.json({ totalCnt, fetched: allRows.length, sampleOnly: allRows.length < totalCnt, rows: filtered });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/health", (req, res) => {
  const provider = PROVIDERS[AI_PROVIDER];
  const key = provider ? process.env[provider.keyEnv] : null;
  res.json({ ok: true, provider: AI_PROVIDER, hasKey: !!key && !key.includes("여기에") });
});

// 프로덕션(배포)에서는 이 서버가 빌드된 프론트엔드(dist)도 함께 서빙한다.
// → 클라우드에 서비스 하나만 올리면 화면 + API 가 같은 주소에서 동작한다.
// 개발 중에는 vite 개발 서버가 화면을 담당하므로 이 블록을 건너뛴다.
if (process.env.NODE_ENV === "production") {
  const distDir = path.join(__dirname, "dist");
  app.use(express.static(distDir));
  // API 를 제외한 모든 경로는 SPA 진입점(index.html)으로 넘긴다.
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`AI 분석 서버 실행 중: http://localhost:${PORT}`);
});
