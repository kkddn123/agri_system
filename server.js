// 이 서버는 브라우저 대신 Anthropic API를 호출해주는 역할만 합니다.
// API 키는 .env 파일에만 두고, 프론트엔드(브라우저) 코드에는 절대 넣지 않습니다.
import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const KAMIS_KEY = process.env.KAMIS_API_KEY;

app.post("/api/analyze", async (req, res) => {
  if (!API_KEY || API_KEY.includes("여기에")) {
    res.status(500).json({ error: ".env 파일에 ANTHROPIC_API_KEY가 설정되어 있지 않습니다." });
    return;
  }
  const { prompt } = req.body || {};
  if (!prompt) {
    res.status(400).json({ error: "prompt가 필요합니다." });
    return;
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// KAMIS 가격 조회 (일별/월별/연별)
const KAMIS_ACTIONS = {
  daily: "dailySalesList",
  monthly: "monthlySalesList",
  yearly: "yearlySalesList",
};

app.get("/api/kamis/price", async (req, res) => {
  const { startDate, endDate, itemCode, kindCode, countryCode = "1101", rankCode = "04", period = "daily" } = req.query;
  if (!startDate || !endDate || !itemCode) {
    return res.status(400).json({ error: "startDate, endDate, itemCode 파라미터가 필요합니다." });
  }
  const action = KAMIS_ACTIONS[period] || KAMIS_ACTIONS.daily;
  const params = new URLSearchParams({
    p_cert_key: KAMIS_KEY,
    p_cert_id: "5005",
    p_returntype: "json",
    p_startday: startDate,
    p_endday: endDate,
    p_itemcode: itemCode,
    p_kindcode: kindCode || "01",
    p_countrycode: countryCode,
    p_rankcode: rankCode,
  });
  try {
    const r = await fetch(`http://www.kamis.or.kr/service/price/xml.do?action=${action}&${params}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
  res.json({ ok: true, hasKey: !!API_KEY && !API_KEY.includes("여기에") });
});

app.listen(PORT, () => {
  console.log(`AI 분석 서버 실행 중: http://localhost:${PORT}`);
});
