import React, { useEffect, useState } from "react";
import { loadIncomeData, loadPublicDatasets } from "../lib/dataLoader";
import { CROP_REGISTRY, findCrop, parseUnitKg } from "../lib/cropRegistry";
import { classifySupplyStageByItem } from "../lib/supplyThresholds";
import { theme, card, badge } from "../theme";

const inputStyle = {
  width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${theme.panelBorder}`,
  background: theme.panelAlt, color: theme.text, fontSize: 13, boxSizing: "border-box",
};
const labelStyle = { fontSize: 12, color: theme.textMuted, marginBottom: 4, display: "block" };

// 농산물 수급관리 가이드라인(공공데이터 카탈로그) 연계 ID
const SUPPLY_GUIDE_ID = "MAFRA-SUPPLY-2025-01";

// 현재 도매가의 평년 대비 편차(%)를 수급 단계로 분류.
// 수급관리 가이드라인의 가격 기반 단계 개념을 단순화한 추정치(작목 공통 밴드)이며,
// 품목별 공식 임계치와는 다를 수 있음.
function classifySupplyStage(dev) {
  if (dev >= 30)  return { label: "가격 급등 · 공급부족 우려", color: theme.danger, band: "평년 대비 +30% 이상" };
  if (dev >= 15)  return { label: "상승 주의",               color: theme.warn,   band: "평년 대비 +15~30%" };
  if (dev > -15)  return { label: "안정",                    color: theme.accent, band: "평년 대비 ±15% 이내" };
  if (dev > -30)  return { label: "하락 주의",               color: theme.warn,   band: "평년 대비 -15~-30%" };
  return            { label: "가격 급락 · 공급과잉 우려",     color: theme.danger, band: "평년 대비 -30% 이하" };
}

export default function FarmDiagnosis() {
  const [crops, setCrops] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ crop: "", area: "", volume: "", price: "", cost: "" });
  const [result, setResult] = useState(null);
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    loadIncomeData()
      .then(({ items }) => { if (alive) setCrops(items); })
      .catch((e) => { if (alive) setError(e.message); });
    loadPublicDatasets()
      .then(({ items }) => { if (alive) setDatasets(items); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const update = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // 진단 드롭다운: 레지스트리 작목 + income-data 작목 합집합
  const cropOptions = (() => {
    const names = new Set(CROP_REGISTRY.map((c) => c.name));
    (crops || []).forEach((c) => { if (c.name && !c.name.startsWith("예시")) names.add(c.name); });
    return [...names];
  })();

  async function runDiagnosis() {
    const areaPyeong = parseFloat(form.area);
    const volumeKg = parseFloat(form.volume);
    const priceWon = parseFloat(form.price);
    const costWon = parseFloat(form.cost);

    if (!form.crop || !areaPyeong || !volumeKg || !priceWon || !costWon) {
      setResult({ error: "작목, 재배면적, 총생산량, 평균단가, 총경영비를 모두 입력해주세요." });
      setInsights(null);
      return;
    }

    const area10a = areaPyeong / 300; // 10a = 300평
    const totalRevenue = volumeKg * priceWon;
    const income = totalRevenue - costWon;
    const incomeRate = totalRevenue ? (income / totalRevenue) * 100 : 0;
    const benchmark = (crops || []).find((c) => c.name === form.crop) || null;

    setResult({
      myRevenue10a: totalRevenue / area10a,
      myCost10a: costWon / area10a,
      myIncome10a: income / area10a,
      incomeRate,
      benchmark,
    });

    fetchInsights(form.crop, priceWon);
  }

  // 연계 인사이트: KAMIS 시세 / 소비 트렌드 / 출하 가이드
  async function fetchInsights(cropName, myPriceWon) {
    const crop = findCrop(cropName);
    setInsightsLoading(true);
    setInsights({ crop });

    const next = { crop, kamis: null, trend: null, guide: null };

    // 출하 가이드 (로컬, 즉시)
    if (crop?.guideId) {
      next.guide = (datasets || []).find((d) => d.id === crop.guideId) || null;
    }

    // KAMIS 도매시세 (월별 — 일별 API는 itemCode를 무시하므로 월별로 작목 정확도 확보)
    const kamisP = (async () => {
      if (!crop?.kamis) return;
      try {
        const nowY = new Date().getFullYear();
        const params = new URLSearchParams({
          startDate: `${nowY - 1}0101`, endDate: `${nowY}1231`,
          itemCode: crop.kamis.itemCode, kindCode: crop.kamis.kindCode, period: "monthly",
        });
        const res = await fetch(`/api/kamis/price?${params}`);
        const json = await res.json();
        const list = Array.isArray(json.price) ? json.price : [];
        // 도매(02) 우선, 없으면 첫 항목
        const entry = list.find((p) => p.productclscode === "02" && Array.isArray(p.item) && p.item.length)
          || list.find((p) => Array.isArray(p.item) && p.item.length);
        if (!entry) return;
        // 가장 최근 연도의 마지막 유효 월 값 찾기
        const MK = ["m1","m2","m3","m4","m5","m6","m7","m8","m9","m10","m11","m12"];
        let found = null;
        for (const yrow of entry.item) { // item[0]이 최신 연도
          for (let mi = 11; mi >= 0; mi--) {
            const v = yrow[MK[mi]];
            if (v && v !== "-") { found = { year: yrow.yyyy, month: mi + 1, val: v }; break; }
          }
          if (found) break;
        }
        if (!found) return;
        const raw = parseFloat(String(found.val).replace(/,/g, ""));
        const capKg = parseUnitKg(entry.caption); // 단위가 caption 끝에 포함 (예: ...10kg(그물망 3포기))
        const kg = capKg || crop.kamis.unitKg || null; // kg 없으면 개당 환산무게 폴백
        const estUnit = !capKg && !!crop.kamis.unitKg; // 개당 환산 여부
        const perKg = kg ? raw / kg : null;
        next.kamis = {
          caption: entry.caption, refYM: `${found.year}.${found.month}`,
          clsName: entry.productclscode === "02" ? "도매" : "소매",
          raw, kg, perKg, estUnit,
          diffPct: perKg && myPriceWon ? ((myPriceWon - perKg) / perKg) * 100 : null,
        };

        // 수급 단계: 현재 도매가 vs 평년 (수급관리 가이드라인 연계)
        if (perKg != null) {
          try {
            const yp = new URLSearchParams({
              startDate: `${nowY - 4}0101`, endDate: `${nowY}1231`,
              itemCode: crop.kamis.itemCode, kindCode: crop.kamis.kindCode, period: "yearly",
            });
            const yres = await fetch(`/api/kamis/price?${yp}`);
            const yjson = await yres.json();
            const ylist = Array.isArray(yjson.price) ? yjson.price : [];
            const yentry = ylist.find((p) => p.productclscode === "02" && Array.isArray(p.item) && p.item.length)
              || ylist.find((p) => Array.isArray(p.item) && p.item.length);
            const normalRow = yentry?.item?.find((r) => r.div === "평년");
            const ykg = parseUnitKg(yentry?.caption) || crop.kamis.unitKg || kg;
            if (normalRow && ykg) {
              const normalPerKg = parseFloat(String(normalRow.avg_data).replace(/,/g, "")) / ykg;
              if (normalPerKg > 0) {
                const devPct = ((perKg - normalPerKg) / normalPerKg) * 100;
                // 품목별 작형 임계치 우선, 없으면 일반 밴드로 폴백
                const itemStage = classifySupplyStageByItem(crop.name, devPct, found.month);
                next.supply = {
                  normalPerKg, curPerKg: perKg, devPct,
                  stage: itemStage || classifySupplyStage(devPct),
                  itemSpecific: !!itemStage,
                  guide: (datasets || []).find((d) => d.id === SUPPLY_GUIDE_ID) || null,
                };
              }
            }
          } catch { /* 무시 */ }
        }
      } catch { /* 무시 */ }
    })();

    // 소비 트렌드
    const trendP = (async () => {
      if (!crop?.trendItem) return;
      try {
        const res = await fetch(`/api/consume/trend?item=${encodeURIComponent(crop.trendItem)}`);
        const json = await res.json();
        const rows = (json.rows || [])
          .filter((r) => r.monAvgAmt > 0)
          .sort((a, b) => (a.year + a.month.padStart(2, "0")).localeCompare(b.year + b.month.padStart(2, "0")));
        if (rows.length < 2) { if (rows.length) next.trend = { latest: rows[rows.length - 1], rows }; return; }
        const latest = rows[rows.length - 1];
        const prev = rows[rows.length - 2];
        next.trend = {
          latest, prev, rows,
          dirPct: prev.monAvgAmt ? ((latest.monAvgAmt - prev.monAvgAmt) / prev.monAvgAmt) * 100 : 0,
        };
      } catch { /* 무시 */ }
    })();

    await Promise.all([kamisP, trendP]);
    setInsights(next);
    setInsightsLoading(false);
  }

  if (error) {
    return <div style={{ color: theme.danger, padding: 24 }}>데이터를 불러오지 못했습니다: {error}</div>;
  }

  return (
    <div>
      <h2 style={{ color: theme.text, fontSize: 18, margin: 0 }}>내 농가 경영 진단</h2>
      <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 6, marginBottom: 16 }}>
        작목과 생산·판매 정보를 입력하면 전국 평균 비교 + 실시간 도매시세·소비추세·출하가이드를 함께 진단합니다.
      </p>

      <div style={{ ...card, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px", marginBottom: 16 }}>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>작목 선택</label>
          <select style={inputStyle} value={form.crop} onChange={(e) => update("crop", e.target.value)}>
            <option value="">선택하세요</option>
            {cropOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>재배 면적 (평)</label>
          <input style={inputStyle} value={form.area} onChange={(e) => update("area", e.target.value)} placeholder="예: 3000" />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>총 생산량 (kg, 전체 면적 기준)</label>
          <input style={inputStyle} value={form.volume} onChange={(e) => update("volume", e.target.value)} placeholder="예: 5000" />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>평균 판매 단가 (원/kg)</label>
          <input style={inputStyle} value={form.price} onChange={(e) => update("price", e.target.value)} placeholder="예: 3500" />
        </div>
        <div style={{ gridColumn: "1 / -1", marginBottom: 14 }}>
          <label style={labelStyle}>총 경영비 (원, 전체 면적 기준)</label>
          <input style={inputStyle} value={form.cost} onChange={(e) => update("cost", e.target.value)} placeholder="예: 8000000" />
        </div>
      </div>

      <button
        onClick={runDiagnosis}
        style={{ background: theme.accent, color: "#06210f", border: "none", borderRadius: 10, padding: "10px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
      >
        경영 진단 실행
      </button>

      {result && (
        <div style={{ ...card, marginTop: 20 }}>
          {result.error ? (
            <div style={{ color: theme.warn, fontSize: 13 }}>{result.error}</div>
          ) : (
            <>
              <div style={{ color: theme.text, fontWeight: 700, marginBottom: 12 }}>진단 결과 (10a 기준 환산)</div>
              <Row label="소득률" mine={`${result.incomeRate.toFixed(1)}%`} bench={result.benchmark ? `${result.benchmark.income_rate_pct}%` : "비교 데이터 없음"} />
              <Row label="소득 (원/10a)" mine={Math.round(result.myIncome10a).toLocaleString()} bench={result.benchmark ? (result.benchmark.income_per_10a ?? 0).toLocaleString() : "-"} />
              <Row label="총수입 (원/10a)" mine={Math.round(result.myRevenue10a).toLocaleString()} bench={result.benchmark ? (result.benchmark.total_revenue_per_10a ?? 0).toLocaleString() : "-"} />
              <Row label="경영비 (원/10a)" mine={Math.round(result.myCost10a).toLocaleString()} bench={result.benchmark ? (result.benchmark.management_cost_per_10a ?? 0).toLocaleString() : "-"} />
              {!result.benchmark && (
                <div style={{ color: theme.warn, fontSize: 12.5, marginTop: 8 }}>
                  income-data.json에 "{form.crop}" 항목이 없어 전국 평균과 비교하지 못했습니다.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 연계 인사이트 */}
      {result && !result.error && (
        <Insights insights={insights} loading={insightsLoading} myPrice={parseFloat(form.price)} />
      )}
    </div>
  );
}

function Insights({ insights, loading, myPrice }) {
  if (!insights) return null;
  const { crop, kamis, trend, guide, supply } = insights;

  return (
    <div style={{ ...card, marginTop: 16 }}>
      <div style={{ color: theme.text, fontWeight: 700, marginBottom: 4 }}>연계 인사이트</div>
      <div style={{ color: theme.textMuted, fontSize: 12, marginBottom: 14 }}>
        진단 작목 <b style={{ color: theme.accent }}>{crop?.name || "—"}</b> 기준 · 도매시세 / 소비추세 / 출하가이드 연결
      </div>

      {loading && <div style={{ color: theme.textMuted, fontSize: 13 }}>실시간 데이터 불러오는 중...</div>}

      {/* KAMIS 도매시세 */}
      <Block icon="📊" title="실시간 도매시세 (KAMIS)">
        {!crop?.kamis ? (
          <Muted>이 작목은 KAMIS 시세 매핑이 없습니다.</Muted>
        ) : !kamis ? (
          !loading && <Muted>최근 시세 데이터를 찾지 못했습니다.</Muted>
        ) : (
          <>
            <div style={{ fontSize: 13, color: theme.text }}>
              <span style={badge(theme.accent)}>{kamis.clsName}</span>{" "}
              <b>{kamis.raw.toLocaleString()}원</b>
              <span style={{ color: theme.textMuted }}> ({kamis.refYM} 기준)</span>
            </div>
            <div style={{ fontSize: 11.5, color: theme.textFaint, marginTop: 3 }}>
              {kamis.caption}{kamis.estUnit && ` · 개당 약 ${kamis.kg}kg 기준 환산(추정)`}
            </div>
            {kamis.perKg != null && (
              <div style={{ fontSize: 12.5, color: theme.textMuted, marginTop: 4 }}>
                환산 도매가 ≈ <b style={{ color: theme.text }}>{Math.round(kamis.perKg).toLocaleString()}원/kg</b>
                {kamis.diffPct != null && (
                  <> · 내 판매단가({myPrice.toLocaleString()}원/kg)는{" "}
                    <b style={{ color: kamis.diffPct < 0 ? theme.danger : theme.accent }}>
                      {kamis.diffPct < 0 ? `${Math.abs(kamis.diffPct).toFixed(0)}% 낮음` : `${kamis.diffPct.toFixed(0)}% 높음`}

                    </b>
                  </>
                )}
              </div>
            )}
            {kamis.diffPct != null && kamis.diffPct < -10 && (
              <Advice>도매시세 대비 단가가 낮습니다. 출하 시기 조정·등급 상향·직거래/온라인 판로를 검토해보세요.</Advice>
            )}
          </>
        )}
      </Block>

      {/* 수급 단계 (수급관리 가이드라인 연계) */}
      <Block icon="📉" title="수급 단계 (수급관리 가이드라인 연계)">
        {!crop?.kamis ? (
          <Muted>이 작목은 KAMIS 시세 매핑이 없어 수급 단계를 판정할 수 없습니다.</Muted>
        ) : !supply ? (
          !loading && <Muted>평년 시세 데이터를 찾지 못해 수급 단계를 판정할 수 없습니다.</Muted>
        ) : (
          <>
            <div style={{ fontSize: 13, color: theme.text }}>
              현재 도매가 <b>{Math.round(supply.curPerKg).toLocaleString()}원/kg</b>
              <span style={{ color: theme.textMuted }}> · 평년 {Math.round(supply.normalPerKg).toLocaleString()}원/kg 대비 </span>
              <b style={{ color: supply.stage.color }}>
                {supply.devPct >= 0 ? "+" : ""}{supply.devPct.toFixed(0)}%
              </b>
            </div>
            <div style={{ marginTop: 6 }}>
              <span style={{ ...badge(supply.stage.color), fontSize: 12 }}>{supply.stage.label}</span>
              <span style={{ fontSize: 11.5, color: theme.textFaint, marginLeft: 6 }}>({supply.stage.band})</span>
              {supply.itemSpecific && supply.stage.season && (
                <span style={{ fontSize: 11.5, color: theme.textMuted, marginLeft: 6 }}>· {supply.stage.season} 기준</span>
              )}
            </div>
            {supply.guide && (
              <div style={{ fontSize: 12, color: theme.accent, marginTop: 8 }}>
                📄 {supply.guide.title} → 공공데이터 탭에서 대응 기준 확인
              </div>
            )}
            <div style={{ fontSize: 11, color: theme.textFaint, marginTop: 6 }}>
              {supply.itemSpecific
                ? "※ 수급관리 가이드라인의 품목별·작형별 위기단계 등락률 기준을 적용했습니다. 현재가는 평년 연평균 대비치로, 월별 안정대 기준과는 다소 차이가 있을 수 있습니다."
                : "※ 이 품목은 가이드라인 대상이 아니어서 일반 밴드(±15/±30%)로 추정했습니다."}
            </div>
          </>
        )}
      </Block>

      {/* 소비 트렌드 */}
      <Block icon="🛒" title="소비 트렌드 (농식품)">
        {!crop?.trendItem ? (
          <Muted>이 작목은 소비 트렌드 매핑이 없습니다.</Muted>
        ) : !trend ? (
          !loading && <Muted>소비 트렌드 데이터를 찾지 못했습니다.</Muted>
        ) : (
          <>
            <div style={{ fontSize: 13, color: theme.text }}>
              {trend.latest.year}년 {trend.latest.month}월 월평균 구매가{" "}
              <b>{trend.latest.monAvgAmt.toLocaleString()}원</b>
              {trend.dirPct != null && (
                <span style={{ color: trend.dirPct >= 0 ? theme.accent : theme.danger, marginLeft: 6 }}>
                  {trend.dirPct >= 0 ? "▲" : "▼"} {Math.abs(trend.dirPct).toFixed(1)}%
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 4 }}>
              분류 {trend.latest.category} · 직전 대비 수요 단가 추세
            </div>
          </>
        )}
      </Block>

      {/* 출하 가이드 */}
      <Block icon="📄" title="최적 출하 가이드" last>
        {guide ? (
          <>
            <div style={{ fontSize: 13, color: theme.text, fontWeight: 600 }}>{guide.title}</div>
            <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 4 }}>{guide.agency} · {guide.description?.slice(0, 80)}…</div>
            <div style={{ fontSize: 12, color: theme.accent, marginTop: 6 }}>→ 공공데이터 탭에서 전체 가이드를 확인하세요.</div>
          </>
        ) : (
          <Muted>이 작목에 매칭되는 출하 가이드가 아직 없습니다.</Muted>
        )}
      </Block>
    </div>
  );
}

function Block({ icon, title, last, children }) {
  return (
    <div style={{ padding: "10px 0", borderBottom: last ? "none" : `1px solid ${theme.divider}` }}>
      <div style={{ fontSize: 12.5, color: theme.textMuted, marginBottom: 6 }}>{icon} {title}</div>
      {children}
    </div>
  );
}
const Muted = ({ children }) => <div style={{ fontSize: 12.5, color: theme.textFaint }}>{children}</div>;
const Advice = ({ children }) => (
  <div style={{ fontSize: 12.5, color: theme.warn, marginTop: 8, background: `${theme.warn}14`, padding: "6px 10px", borderRadius: 8 }}>
    💡 {children}
  </div>
);

function Row({ label, mine, bench }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${theme.divider}`, fontSize: 13 }}>
      <span style={{ color: theme.textMuted }}>{label}</span>
      <span style={{ color: theme.text }}>
        내 농가 {mine} <span style={{ color: theme.textFaint, margin: "0 6px" }}>vs</span> 전국평균 {bench}
      </span>
    </div>
  );
}
