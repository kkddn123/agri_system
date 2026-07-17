// 이 서버는 브라우저 대신 AI API(Anthropic/OpenAI/Gemini)를 호출해주는 역할만 합니다.
// API 키는 .env 파일에만 두고, 프론트엔드(브라우저) 코드에는 절대 넣지 않습니다.
import "dotenv/config";
import express from "express";
import cors from "cors";

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
  const provider = PROVIDERS[AI_PROVIDER];
  const key = provider ? process.env[provider.keyEnv] : null;
  res.json({ ok: true, provider: AI_PROVIDER, hasKey: !!key && !key.includes("여기에") });
});

app.listen(PORT, () => {
  console.log(`AI 분석 서버 실행 중: http://localhost:${PORT}`);
});
