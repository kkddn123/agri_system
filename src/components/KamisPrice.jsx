import React, { useState, useCallback } from "react";
import { theme, card, badge } from "../theme";
import { CROP_REGISTRY } from "../lib/cropRegistry";

const CATEGORIES = [
  { code: "100", name: "식량작물" },
  { code: "200", name: "채소류" },
  { code: "300", name: "특용작물" },
  { code: "400", name: "과일류" },
  { code: "500", name: "축산물" },
  { code: "600", name: "수산물" },
];

// 진단 연계 품목의 itemCode/kindCode 는 cropRegistry(CROP_REGISTRY)를 단일 진실
// 공급원으로 사용한다. 아래 EXTRA_ITEMS 는 진단과 무관한 분류 탐색용 보조 품목으로,
// 레지스트리에 이미 있는 코드와 충돌하면 무시된다.
const EXTRA_ITEMS = {
  "100": [
    { code: "111", name: "쌀", kindCode: "01" },
    { code: "141", name: "콩", kindCode: "01" },
  ],
  "200": [
    { code: "212", name: "양배추", kindCode: "01" },
    { code: "215", name: "시금치", kindCode: "01" },
    { code: "252", name: "호박", kindCode: "01" },
    { code: "271", name: "버섯", kindCode: "01" },
  ],
  "300": [
    { code: "312", name: "참깨", kindCode: "01" },
    { code: "321", name: "들깨", kindCode: "01" },
  ],
  "400": [
    { code: "421", name: "복숭아", kindCode: "01" },
    { code: "423", name: "포도", kindCode: "01" },
    { code: "426", name: "단감", kindCode: "01" },
    { code: "431", name: "바나나", kindCode: "01" },
    { code: "432", name: "참다래", kindCode: "01" },
    { code: "441", name: "수박", kindCode: "01" },
    { code: "442", name: "멜론", kindCode: "01" },
  ],
  "500": [
    { code: "511", name: "쇠고기", kindCode: "01" },
    { code: "521", name: "돼지고기", kindCode: "01" },
    { code: "531", name: "닭", kindCode: "01" },
    { code: "541", name: "달걀", kindCode: "01" },
  ],
};

const ITEMS = buildItems();
function buildItems() {
  const out = { "100": [], "200": [], "300": [], "400": [], "500": [], "600": [] };
  for (const c of CROP_REGISTRY) {
    const cat = c.kamis?.categoryCode;
    if (!cat || !out[cat]) continue;
    out[cat].push({ code: c.kamis.itemCode, kindCode: c.kamis.kindCode, name: c.name, categoryCode: cat });
  }
  for (const [cat, items] of Object.entries(EXTRA_ITEMS)) {
    for (const it of items) {
      if (!out[cat].some((x) => x.code === it.code)) out[cat].push({ ...it, categoryCode: cat });
    }
  }
  return out;
}

const PERIODS = [
  { key: "daily",   label: "일별" },
  { key: "monthly", label: "월별" },
  { key: "yearly",  label: "연별" },
];

const MONTH_KEYS = ["m1","m2","m3","m4","m5","m6","m7","m8","m9","m10","m11","m12"];
const MONTH_LABELS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

function today() { return new Date().toISOString().slice(0, 10).replace(/-/g, ""); }
function nDaysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}
function nMonthsAgo(n) {
  const d = new Date(); d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}01`;
}
function nYearsAgo(n) { return `${new Date().getFullYear() - n}0101`; }

function formatInput(val, period) {
  if (!val || val.length < 6) return "";
  if (period === "yearly")  return val.slice(0, 4);
  if (period === "monthly") return `${val.slice(0, 4)}-${val.slice(4, 6)}`;
  return `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}`;
}
function parseInput(raw, period) {
  const s = raw.replace(/-/g, "");
  if (period === "yearly")  return s.slice(0, 4) + "0101";
  if (period === "monthly") return s.slice(0, 6) + "01";
  return s.slice(0, 8);
}
function defaultDates(period) {
  if (period === "daily")   return { start: nDaysAgo(30), end: today() };
  if (period === "monthly") return { start: nMonthsAgo(11), end: nMonthsAgo(0) };
  return { start: nYearsAgo(4), end: nYearsAgo(0) };
}

const clsLabel = (code) => (code === "02" ? "도매" : "소매");
const clsColor = (code) => (code === "02" ? theme.accent : theme.info);

const CLS_OPTIONS = [
  { code: "02", label: "도매" },
  { code: "01", label: "소매" },
];

export default function KamisPrice() {
  const [categoryCode, setCategoryCode] = useState("200");
  const [selectedItem, setSelectedItem] = useState(ITEMS["200"][0]);
  const [period, setPeriod] = useState("daily");
  const [clsCode, setClsCode] = useState("02");
  const [startDate, setStartDate] = useState(nDaysAgo(30));
  const [endDate, setEndDate] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleCategoryChange = (code) => {
    setCategoryCode(code);
    setSelectedItem(ITEMS[code]?.[0] || null);
    setData(null);
  };
  const handlePeriodChange = (p) => {
    setPeriod(p);
    const { start, end } = defaultDates(p);
    setStartDate(start);
    setEndDate(end);
    setData(null);
  };

  const fetchPrice = useCallback(async () => {
    if (!selectedItem) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const params = new URLSearchParams({
        startDate, endDate,
        itemCode: selectedItem.code,
        kindCode: selectedItem.kindCode,
        categoryCode: selectedItem.categoryCode || categoryCode,
        clsCode,
        period,
      });
      const res = await fetch(`/api/kamis/price?${params}`);
      if (!res.ok) throw new Error(`서버 오류: ${res.status}`);
      const json = await res.json();
      if (json.error_code && json.error_code !== "000") {
        throw new Error(`KAMIS 오류 코드: ${json.error_code}`);
      }
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedItem, startDate, endDate, period, clsCode, categoryCode]);

  const priceList = Array.isArray(data?.price) ? data.price : [];
  const inputType = period === "yearly" ? "number" : period === "monthly" ? "month" : "date";

  return (
    <div>
      <h2 style={{ color: theme.text, fontSize: 18, margin: 0 }}>도매시장 가격 조회</h2>
      <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 6, marginBottom: 20 }}>
        KAMIS 농산물 유통정보 · 소매/도매 가격 (일별 · 월별 · 연별)
      </p>

      <div style={{ ...card, marginBottom: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 조회 주기 */}
        <div>
          <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 8 }}>조회 주기</div>
          <div style={{ display: "flex", gap: 6 }}>
            {PERIODS.map((p) => (
              <button key={p.key} onClick={() => handlePeriodChange(p.key)} style={{
                padding: "5px 18px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                border: `1px solid ${period === p.key ? theme.accent : theme.panelBorder}`,
                background: period === p.key ? `${theme.accent}22` : theme.panelAlt,
                color: period === p.key ? theme.accent : theme.textMuted,
                fontWeight: period === p.key ? 700 : 400,
              }}>{p.label}</button>
            ))}
          </div>
        </div>

        {/* 가격 구분 (일별 조회에만 적용 — 월별·연별은 도매·소매가 함께 옴) */}
        {period === "daily" && (
          <div>
            <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 8 }}>가격 구분</div>
            <div style={{ display: "flex", gap: 6 }}>
              {CLS_OPTIONS.map((c) => (
                <button key={c.code} onClick={() => { setClsCode(c.code); setData(null); }} style={{
                  padding: "5px 18px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                  border: `1px solid ${clsCode === c.code ? theme.accent : theme.panelBorder}`,
                  background: clsCode === c.code ? `${theme.accent}22` : theme.panelAlt,
                  color: clsCode === c.code ? theme.accent : theme.textMuted,
                  fontWeight: clsCode === c.code ? 700 : 400,
                }}>{c.label}</button>
              ))}
            </div>
          </div>
        )}

        {/* 품목 분류 */}
        <div>
          <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 8 }}>품목 분류</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {CATEGORIES.map((c) => (
              <button key={c.code} onClick={() => handleCategoryChange(c.code)} style={{
                padding: "5px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                border: `1px solid ${categoryCode === c.code ? theme.warn : theme.panelBorder}`,
                background: categoryCode === c.code ? `${theme.warn}22` : theme.panelAlt,
                color: categoryCode === c.code ? theme.warn : theme.textMuted,
                fontWeight: categoryCode === c.code ? 700 : 400,
              }}>{c.name}</button>
            ))}
          </div>
        </div>

        {/* 품목 선택 */}
        <div>
          <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 8 }}>품목 선택</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(ITEMS[categoryCode] || []).map((item) => (
              <button key={item.code} onClick={() => { setSelectedItem(item); setData(null); }} style={{
                padding: "5px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                border: `1px solid ${selectedItem?.code === item.code ? theme.info : theme.panelBorder}`,
                background: selectedItem?.code === item.code ? `${theme.info}22` : theme.panelAlt,
                color: selectedItem?.code === item.code ? theme.info : theme.textMuted,
                fontWeight: selectedItem?.code === item.code ? 700 : 400,
              }}>{item.name}</button>
            ))}
          </div>
        </div>

        {/* 기간 + 조회 */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>
              {period === "yearly" ? "시작 연도" : period === "monthly" ? "시작 월" : "시작일"}
            </div>
            <input
              type={inputType}
              value={formatInput(startDate, period)}
              min={period === "yearly" ? "2000" : undefined}
              max={period === "yearly" ? String(new Date().getFullYear()) : undefined}
              onChange={(e) => setStartDate(parseInput(e.target.value, period))}
              style={{ background: theme.panelAlt, border: `1px solid ${theme.panelBorder}`, borderRadius: 8, color: theme.text, padding: "6px 10px", fontSize: 13 }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>
              {period === "yearly" ? "종료 연도" : period === "monthly" ? "종료 월" : "종료일"}
            </div>
            <input
              type={inputType}
              value={formatInput(endDate, period)}
              min={period === "yearly" ? "2000" : undefined}
              max={period === "yearly" ? String(new Date().getFullYear()) : undefined}
              onChange={(e) => setEndDate(parseInput(e.target.value, period))}
              style={{ background: theme.panelAlt, border: `1px solid ${theme.panelBorder}`, borderRadius: 8, color: theme.text, padding: "6px 10px", fontSize: 13 }}
            />
          </div>
          <button
            onClick={fetchPrice}
            disabled={loading || !selectedItem}
            style={{ padding: "8px 24px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", background: theme.accent, color: "#0a0e1a", border: "none", opacity: loading || !selectedItem ? 0.5 : 1 }}
          >
            {loading ? "조회 중..." : "조회"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ ...card, borderColor: theme.danger, color: theme.danger, fontSize: 13, marginBottom: 16 }}>
          오류: {error}
        </div>
      )}

      {data && period === "daily"   && <DailyResult series={data.series} itemName={selectedItem?.name} clsCode={clsCode} />}
      {data && period === "monthly" && <MonthlyResult priceList={priceList} />}
      {data && period === "yearly"  && <YearlyResult priceList={priceList} />}
    </div>
  );
}

/* ---------- 일별 ---------- */
// periodProductList 는 같은 날짜에 "평균"(당해) · "평년"(최근 5년) · 지역명 계열을
// 함께 돌려준다. 당해 평균을 본선으로, 평년을 비교선으로 쓴다.
function pickSeries(series, name) {
  const rows = (series || []).filter((s) => s.market === name);
  return new Map(rows.map((s) => [s.date, s.price]));
}

function DailyResult({ series, itemName, clsCode }) {
  const cur = pickSeries(series, "평균");
  const normal = pickSeries(series, "평년");
  const dates = [...cur.keys()].sort();
  if (!dates.length) return <Empty />;

  const prices = dates.map((d) => cur.get(d));
  const latestDate = dates[dates.length - 1];
  const latest = cur.get(latestDate);
  const prev = dates.length > 1 ? cur.get(dates[dates.length - 2]) : null;
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  const latestNormal = normal.get(latestDate);
  const vsNormal = latestNormal ? Math.round(((latest - latestNormal) / latestNormal) * 1000) / 10 : null;
  const dayChange = prev ? Math.round(((latest - prev) / prev) * 1000) / 10 : null;

  const won = (n) => (n == null ? "-" : `${n.toLocaleString()}원`);
  const summary = [
    ["최근 시세", won(latest), latestDate, theme.text],
    ["기간 평균", won(avg), `${dates.length}일 조회`, theme.text],
    ["기간 최고", won(max), "", theme.danger],
    ["기간 최저", won(min), "", theme.info],
  ];

  return (
    <>
      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 10 }}>
        <span style={badge(clsColor(clsCode))}>{clsLabel(clsCode)}</span>{" "}
        {itemName} · 최근 갱신일 <b style={{ color: theme.text }}>{latestDate}</b>
        {dayChange != null && (
          <span style={{ color: dayChange > 0 ? theme.danger : dayChange < 0 ? theme.info : theme.textMuted, marginLeft: 8 }}>
            직전 조사일 대비 {dayChange > 0 ? "▲" : dayChange < 0 ? "▼" : "—"} {Math.abs(dayChange)}%
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
        {summary.map(([label, value, sub, color]) => (
          <div key={label} style={{ ...card, padding: 14 }}>
            <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color }}>{value}</div>
            {sub && <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 2 }}>{sub}</div>}
          </div>
        ))}
      </div>

      {vsNormal != null && (
        <div style={{ ...card, marginBottom: 12, fontSize: 13, color: theme.textMuted }}>
          최근 시세는 평년({won(latestNormal)}) 대비{" "}
          <b style={{ color: vsNormal >= 0 ? theme.danger : theme.info }}>
            {vsNormal >= 0 ? "+" : ""}{vsNormal}%
          </b>{" "}
          {Math.abs(vsNormal) < 5 ? "— 평년과 비슷한 수준입니다." : vsNormal > 0 ? "— 평년보다 높습니다." : "— 평년보다 낮습니다."}
        </div>
      )}

      <PriceChart dates={dates} cur={cur} normal={normal} />

      <div style={{ ...card, marginTop: 12, overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: theme.textMuted, borderBottom: `1px solid ${theme.divider}` }}>
              <th style={th("left")}>날짜</th>
              <th style={th("right")}>가격</th>
              <th style={th("right")}>평년</th>
              <th style={th("right")}>평년 대비</th>
            </tr>
          </thead>
          <tbody>
            {[...dates].reverse().map((d) => {
              const p = cur.get(d);
              const n = normal.get(d);
              const gap = n ? Math.round(((p - n) / n) * 1000) / 10 : null;
              return (
                <tr key={d} style={{ borderBottom: `1px solid ${theme.divider}`, color: theme.text }}>
                  <td style={td()}>{d}</td>
                  <td style={td("right", 600)}>{p.toLocaleString()}</td>
                  <td style={td("right", 400, theme.textMuted)}>{n ? n.toLocaleString() : "-"}</td>
                  <td style={{ ...td("right", 600), color: gap == null ? theme.textMuted : gap >= 0 ? theme.danger : theme.info }}>
                    {gap == null ? "-" : `${gap >= 0 ? "+" : ""}${gap}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 8 }}>
        단위: 원 · 조사일이 없는 날(주말·공휴일)은 표에 나타나지 않습니다 · 평년은 최근 5년 같은 시기 평균
      </div>
    </>
  );
}

/* 기간 시세 추이 — 당해(실선) vs 평년(점선) */
function PriceChart({ dates, cur, normal }) {
  const W = 720, H = 180, PAD = { t: 12, r: 12, b: 22, l: 56 };
  const all = [...dates.map((d) => cur.get(d)), ...dates.map((d) => normal.get(d)).filter(Boolean)];
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (i) => PAD.l + (i * (W - PAD.l - PAD.r)) / Math.max(1, dates.length - 1);
  const y = (v) => PAD.t + (1 - (v - lo) / span) * (H - PAD.t - PAD.b);
  const path = (get) => {
    const pts = dates.map((d, i) => [i, get(d)]).filter(([, v]) => v != null);
    return pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  };
  const label = (v) => (v >= 10000 ? `${Math.round(v / 1000)}천` : v.toLocaleString());

  return (
    <div style={{ ...card, padding: 14 }}>
      <div style={{ display: "flex", gap: 14, fontSize: 11, color: theme.textMuted, marginBottom: 6 }}>
        <span><span style={{ color: theme.accent, fontWeight: 700 }}>—</span> 당해</span>
        <span><span style={{ color: theme.textFaint, fontWeight: 700 }}>┄</span> 평년</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {[0, 0.5, 1].map((r) => {
          const v = lo + span * (1 - r);
          const yy = PAD.t + r * (H - PAD.t - PAD.b);
          return (
            <g key={r}>
              <line x1={PAD.l} x2={W - PAD.r} y1={yy} y2={yy} stroke={theme.divider} strokeWidth="1" />
              <text x={PAD.l - 8} y={yy + 4} textAnchor="end" fontSize="10" fill={theme.textMuted}>{label(Math.round(v))}</text>
            </g>
          );
        })}
        <path d={path((d) => normal.get(d))} fill="none" stroke={theme.textFaint} strokeWidth="1.5" strokeDasharray="4 3" />
        <path d={path((d) => cur.get(d))} fill="none" stroke={theme.accent} strokeWidth="2" />
        {[0, dates.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : "end"} fontSize="10" fill={theme.textMuted}>
            {dates[i]?.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ---------- 월별 ---------- */
function MonthlyResult({ priceList }) {
  const valid = priceList.filter((p) => Array.isArray(p.item) && p.item.length);
  if (!valid.length) return <Empty />;
  return (
    <>
      {valid.map((p, idx) => (
        <div key={idx} style={{ ...card, marginBottom: 14, overflowX: "auto" }}>
          <div style={{ fontSize: 12.5, color: theme.text, fontWeight: 600, marginBottom: 10 }}>
            <span style={badge(clsColor(p.productclscode))}>{clsLabel(p.productclscode)}</span>{" "}{p.caption}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: theme.textMuted, borderBottom: `1px solid ${theme.divider}` }}>
                <th style={th("left")}>연도</th>
                {MONTH_LABELS.map((m) => <th key={m} style={th("right")}>{m}</th>)}
                <th style={{ ...th("right"), color: theme.accent }}>연평균</th>
              </tr>
            </thead>
            <tbody>
              {p.item.map((row, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${theme.divider}`, color: theme.text }}>
                  <td style={td("left", 700)}>{row.yyyy}</td>
                  {MONTH_KEYS.map((k) => (
                    <td key={k} style={td("right", 400, row[k] === "-" ? theme.textMuted : theme.text)}>{row[k]}</td>
                  ))}
                  <td style={td("right", 700, theme.accent)}>{row.yearavg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div style={{ fontSize: 11, color: theme.textMuted }}>단위: 원 · "-"는 해당 월 거래/수집 데이터 없음</div>
    </>
  );
}

/* ---------- 연별 ---------- */
function YearlyResult({ priceList }) {
  const valid = priceList.filter((p) => Array.isArray(p.item) && p.item.length);
  if (!valid.length) return <Empty />;
  return (
    <>
      {valid.map((p, idx) => (
        <div key={idx} style={{ ...card, marginBottom: 14, overflowX: "auto" }}>
          <div style={{ fontSize: 12.5, color: theme.text, fontWeight: 600, marginBottom: 10 }}>
            <span style={badge(clsColor(p.productclscode))}>{clsLabel(p.productclscode)}</span>{" "}{p.caption}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: theme.textMuted, borderBottom: `1px solid ${theme.divider}` }}>
                <th style={th("left")}>연도</th>
                <th style={th("right")}>평균</th>
                <th style={th("right")}>최고</th>
                <th style={th("right")}>최저</th>
                <th style={th("right")}>표준편차</th>
                <th style={th("right")}>변동계수(%)</th>
              </tr>
            </thead>
            <tbody>
              {p.item.map((row, i) => {
                const isAvg = row.div === "평년";
                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${theme.divider}`, color: theme.text, background: isAvg ? `${theme.accent}11` : "transparent" }}>
                    <td style={td("left", 700, isAvg ? theme.accent : theme.text)}>{row.div}</td>
                    <td style={td("right", 700)}>{row.avg_data}</td>
                    <td style={td("right", 400, theme.danger)}>{row.max_data}</td>
                    <td style={td("right", 400, theme.info)}>{row.min_data}</td>
                    <td style={td("right", 400, theme.textMuted)}>{row.stddev_data}</td>
                    <td style={td("right", 400, parseFloat((row.cv_data || "0").replace(/,/g, "")) > 20 ? theme.warn : theme.textMuted)}>{row.cv_data}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      <div style={{ fontSize: 11, color: theme.textMuted }}>단위: 원 · 변동계수가 높을수록 연중 가격 변동이 큼</div>
    </>
  );
}

function Empty() {
  return (
    <div style={{ ...card, color: theme.textMuted, fontSize: 13, textAlign: "center", lineHeight: 1.7 }}>
      해당 기간에 조사된 가격이 없습니다.<br />
      <span style={{ fontSize: 12, color: theme.textFaint }}>
        제철이 아닌 품목은 거래가 없어 시세가 집계되지 않습니다. 조회 기간을 넓히거나 출하기로 옮겨 다시 조회해 보세요.
      </span>
    </div>
  );
}

const th = (align) => ({ padding: "6px 8px", textAlign: align });
const td = (align = "left", weight = 400, color = theme.text) => ({ padding: "6px 8px", textAlign: align, fontWeight: weight, color });
