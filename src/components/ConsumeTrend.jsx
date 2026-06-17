import React, { useState, useEffect, useCallback } from "react";
import { theme, card, badge } from "../theme";

const YEARS = ["2021", "2022", "2023", "2024", "2025"];
const MONTHS = ["1","2","3","4","5","6","7","8","9","10","11","12"];

const CATEGORIES = ["전체", "근채류", "과채류", "엽경채류", "과실류", "양념채소류", "버섯류"];

function fmt(n) {
  if (!n) return "-";
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}억`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(0)}만`;
  return n.toLocaleString();
}

export default function ConsumeTrend() {
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [category, setCategory] = useState("전체");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalCnt, setTotalCnt] = useState(0);
  const [sampleOnly, setSampleOnly] = useState(false);

  const fetchData = useCallback(async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: p, size: 200 });
      if (year) params.set("year", year);
      if (month) params.set("month", month);
      const res = await fetch(`/api/consume/trend?${params}`);
      if (!res.ok) throw new Error(`서버 오류: ${res.status}`);
      const json = await res.json();
      setTotalCnt(json.totalCnt);
      setSampleOnly(json.sampleOnly);
      setPage(p);
      const filtered = category === "전체"
        ? json.rows
        : json.rows.filter((r) => r.category === category);
      setRows(filtered);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [year, month, category]);

  useEffect(() => { fetchData(1); }, [fetchData]);

  // 품목별 집계
  const byItem = Object.values(
    rows.reduce((acc, r) => {
      if (!acc[r.item]) acc[r.item] = { item: r.item, category: r.category, totalAmt: 0, totalCnt: 0, avgAmtSum: 0, cnt: 0, maxAmt: 0 };
      acc[r.item].totalAmt += r.monPurchaseAmt;
      acc[r.item].totalCnt += r.monPurchaseCnt;
      acc[r.item].avgAmtSum += r.monAvgAmt;
      acc[r.item].cnt += 1;
      acc[r.item].maxAmt = Math.max(acc[r.item].maxAmt, r.monMaxAmt);
      return acc;
    }, {})
  ).sort((a, b) => b.totalAmt - a.totalAmt);

  const maxTotalAmt = byItem[0]?.totalAmt || 1;

  return (
    <div>
      <h2 style={{ color: theme.text, fontSize: 18, margin: 0 }}>농식품 소비 트렌드</h2>
      <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 6, marginBottom: 20 }}>
        농림축산식품부 소매가격 및 소비 트렌드 결합정보 · 품목별 월간 구매액·건수·평균가격
      </p>

      {sampleOnly && (
        <div style={{ ...card, borderColor: theme.warn, marginBottom: 16, fontSize: 12.5, color: theme.warn }}>
          현재 샘플 API 키로 연결되어 있어 전체 {totalCnt.toLocaleString()}건 중 일부만 표시됩니다. 농림축산식품부 공공데이터 포털에서 실제 API 키를 발급받으면 전체 데이터를 조회할 수 있습니다.
        </div>
      )}

      {/* 필터 */}
      <div style={{ ...card, marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>연도</div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setYear("")} style={{
                padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                border: `1px solid ${year === "" ? theme.accent : theme.panelBorder}`,
                background: year === "" ? `${theme.accent}22` : theme.panelAlt,
                color: year === "" ? theme.accent : theme.textMuted,
                fontWeight: year === "" ? 700 : 400,
              }}>전체</button>
          {YEARS.map((y) => (
              <button key={y} onClick={() => setYear(y)} style={{
                padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                border: `1px solid ${year === y ? theme.accent : theme.panelBorder}`,
                background: year === y ? `${theme.accent}22` : theme.panelAlt,
                color: year === y ? theme.accent : theme.textMuted,
                fontWeight: year === y ? 700 : 400,
              }}>{y}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>월 (선택)</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <button onClick={() => setMonth("")} style={{
              padding: "4px 8px", borderRadius: 6, fontSize: 12, cursor: "pointer",
              border: `1px solid ${month === "" ? theme.warn : theme.panelBorder}`,
              background: month === "" ? `${theme.warn}22` : theme.panelAlt,
              color: month === "" ? theme.warn : theme.textMuted,
            }}>전체</button>
            {MONTHS.map((m) => (
              <button key={m} onClick={() => setMonth(m)} style={{
                padding: "4px 8px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                border: `1px solid ${month === m ? theme.warn : theme.panelBorder}`,
                background: month === m ? `${theme.warn}22` : theme.panelAlt,
                color: month === m ? theme.warn : theme.textMuted,
                fontWeight: month === m ? 700 : 400,
              }}>{m}월</button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>분류</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {CATEGORIES.map((c) => (
              <button key={c} onClick={() => setCategory(c)} style={{
                padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                border: `1px solid ${category === c ? theme.info : theme.panelBorder}`,
                background: category === c ? `${theme.info}22` : theme.panelAlt,
                color: category === c ? theme.info : theme.textMuted,
                fontWeight: category === c ? 700 : 400,
              }}>{c}</button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div style={{ ...card, borderColor: theme.danger, color: theme.danger, fontSize: 13, marginBottom: 16 }}>
          오류: {error}
        </div>
      )}

      {loading && (
        <div style={{ ...card, color: theme.textMuted, fontSize: 13, textAlign: "center" }}>
          데이터 불러오는 중...
        </div>
      )}

      {!loading && byItem.length > 0 && (
        <>
          {/* 상위 품목 바 차트 */}
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: theme.text, marginBottom: 12 }}>
              품목별 구매금액 순위 (상위 15개)
            </div>
            {byItem.slice(0, 15).map((it, i) => (
              <div key={it.item} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: theme.text, fontWeight: i < 3 ? 700 : 400 }}>
                    {i + 1}. {it.item}
                    <span style={{ ...badge(theme.info), marginLeft: 6 }}>{it.category}</span>
                  </span>
                  <span style={{ color: theme.textMuted }}>{fmt(it.totalAmt)}원</span>
                </div>
                <div style={{ background: theme.panelAlt, borderRadius: 4, height: 8, overflow: "hidden" }}>
                  <div style={{
                    width: `${(it.totalAmt / maxTotalAmt) * 100}%`,
                    height: "100%",
                    background: i < 3 ? theme.accent : `${theme.accent}88`,
                    borderRadius: 4,
                    transition: "width 0.4s ease",
                  }} />
                </div>
              </div>
            ))}
          </div>

          {/* 상세 테이블 */}
          <div style={{ ...card, overflowX: "auto" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: theme.text, marginBottom: 12 }}>
              품목별 상세 ({rows.length}건)
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: theme.textMuted, borderBottom: `1px solid ${theme.divider}` }}>
                  <th style={{ padding: "6px 8px", textAlign: "left" }}>분류</th>
                  <th style={{ padding: "6px 8px", textAlign: "left" }}>품목</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>연도</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>월</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>월 구매금액</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>구매건수</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>월 평균가</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>최고가</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>최저가</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>변동계수</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${theme.divider}`, color: theme.text }}>
                    <td style={{ padding: "5px 8px" }}>
                      <span style={badge(theme.info)}>{r.category}</span>
                    </td>
                    <td style={{ padding: "5px 8px", fontWeight: 600 }}>{r.item}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: theme.textMuted }}>{r.year}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: theme.textMuted }}>{r.month}월</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>{r.monPurchaseAmt.toLocaleString()}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: theme.textMuted }}>{r.monPurchaseCnt.toLocaleString()}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>{r.monAvgAmt.toLocaleString()}원</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: theme.danger }}>{r.monMaxAmt.toLocaleString()}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: theme.info }}>{r.monMinAmt.toLocaleString()}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: r.monFlctnCffcnt > 20 ? theme.warn : theme.textMuted }}>
                      {r.monFlctnCffcnt}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && byItem.length === 0 && !error && (
        <div style={{ ...card, color: theme.textMuted, fontSize: 13, textAlign: "center" }}>
          해당 조건의 데이터가 없습니다.
        </div>
      )}
    </div>
  );
}
