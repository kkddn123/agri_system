import React, { useEffect, useMemo, useState } from "react";
import { loadIncomeData, isExample } from "../lib/dataLoader";
import { theme, card, badge } from "../theme";

const SORT_OPTIONS = [
  { key: "income_rate_pct", label: "소득률순" },
  { key: "income_per_10a", label: "소득액순" },
  { key: "total_revenue_per_10a", label: "총수입순" },
];

export default function CropProfitability() {
  const [items, setItems] = useState(null);
  const [meta, setMeta] = useState({});
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState("income_rate_pct");

  useEffect(() => {
    let alive = true;
    loadIncomeData()
      .then(({ items, meta }) => { if (alive) { setItems(items); setMeta(meta); } })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);

  const sorted = useMemo(() => {
    return [...(items || [])].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));
  }, [items, sortKey]);

  const max = useMemo(() => {
    const vals = sorted.map((d) => d[sortKey] || 0);
    return Math.max(1, ...vals);
  }, [sorted, sortKey]);

  if (error) {
    return <div style={{ color: theme.danger, padding: 24 }}>데이터를 불러오지 못했습니다: {error}</div>;
  }
  if (items === null) {
    return <div style={{ color: theme.textMuted, padding: 24 }}>불러오는 중...</div>;
  }

  const allExample = items.length > 0 && items.every(isExample);

  return (
    <div>
      <h2 style={{ color: theme.text, fontSize: 18, margin: 0 }}>작목별 수익성 비교</h2>
      <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 6, marginBottom: 16 }}>
        {meta.source || "농촌진흥청 농사로 농산물소득자료"}{meta.year ? ` · ${meta.year}년 기준` : ""}{meta.unit ? ` · ${meta.unit}` : ""}
      </p>

      {allExample && (
        <div style={{ ...card, borderColor: theme.warn, marginBottom: 16, fontSize: 13, color: theme.warn }}>
          아직 예시 데이터만 들어 있습니다. public/data/income-data.json에 실제 작목 소득자료를 채우거나
          scripts/ingest_income_data.py로 원본 파일을 변환해 넣어주세요.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setSortKey(opt.key)}
            style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer",
              border: `1px solid ${sortKey === opt.key ? theme.accent : theme.panelBorder}`,
              background: sortKey === opt.key ? `${theme.accent}22` : theme.panelAlt,
              color: sortKey === opt.key ? theme.accent : theme.textMuted,
              fontWeight: sortKey === opt.key ? 700 : 400,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
        {sorted.map((d) => (
          <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 130, color: theme.text, fontSize: 13, flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
              {d.name}
              {d._example && <span style={badge(theme.warn)}>예시</span>}
            </div>
            <div style={{ flex: 1, height: 10, background: theme.panelAlt, borderRadius: 6, overflow: "hidden" }}>
              <div style={{ width: `${Math.max(2, ((d[sortKey] || 0) / max) * 100)}%`, height: "100%", background: theme.accent }} />
            </div>
            <div style={{ width: 120, textAlign: "right", color: theme.textMuted, fontSize: 12.5, flexShrink: 0 }}>
              {sortKey === "income_rate_pct" ? `${d.income_rate_pct ?? "-"}%` : `${(d[sortKey] ?? 0).toLocaleString()}원`}
            </div>
          </div>
        ))}
      </div>

      <div style={{ ...card, marginTop: 16, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: theme.textMuted, textAlign: "left", borderBottom: `1px solid ${theme.divider}` }}>
              <th style={{ padding: "6px 8px" }}>작목</th>
              <th style={{ padding: "6px 8px" }}>분류</th>
              <th style={{ padding: "6px 8px" }}>총수입</th>
              <th style={{ padding: "6px 8px" }}>경영비</th>
              <th style={{ padding: "6px 8px" }}>소득</th>
              <th style={{ padding: "6px 8px" }}>소득률</th>
              <th style={{ padding: "6px 8px" }}>단가(원/kg)</th>
              <th style={{ padding: "6px 8px" }}>생산량(kg)</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => (
              <tr key={d.id} style={{ color: theme.text, borderBottom: `1px solid ${theme.divider}` }}>
                <td style={{ padding: "6px 8px" }}>{d.name}</td>
                <td style={{ padding: "6px 8px", color: theme.textMuted }}>{d.category || "-"}</td>
                <td style={{ padding: "6px 8px" }}>{(d.total_revenue_per_10a ?? 0).toLocaleString()}</td>
                <td style={{ padding: "6px 8px" }}>{(d.management_cost_per_10a ?? 0).toLocaleString()}</td>
                <td style={{ padding: "6px 8px" }}>{(d.income_per_10a ?? 0).toLocaleString()}</td>
                <td style={{ padding: "6px 8px" }}>{d.income_rate_pct ?? "-"}%</td>
                <td style={{ padding: "6px 8px" }}>{d.unit_price_per_kg ?? "-"}</td>
                <td style={{ padding: "6px 8px" }}>{d.yield_per_10a_kg ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
