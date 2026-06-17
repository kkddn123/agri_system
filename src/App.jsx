import React, { useState } from "react";
import { theme } from "./theme";
import PublicDataCatalog from "./components/PublicDataCatalog";
import CropProfitability from "./components/CropProfitability";
import FarmDiagnosis from "./components/FarmDiagnosis";
import PortfolioDiagnosis from "./components/PortfolioDiagnosis";
import Guide from "./components/Guide";
import KamisPrice from "./components/KamisPrice";
import ConsumeTrend from "./components/ConsumeTrend";

const TABS = [
  { key: "profit", label: "작목별 수익성 비교", Comp: CropProfitability },
  { key: "diagnosis", label: "내 농가 경영 진단", Comp: FarmDiagnosis },
  { key: "portfolio", label: "판매경로 진단", Comp: PortfolioDiagnosis },
  { key: "kamis", label: "도매시장 가격", Comp: KamisPrice },
  { key: "consume", label: "소비 트렌드", Comp: ConsumeTrend },
  { key: "public", label: "공공데이터", Comp: PublicDataCatalog },
  { key: "guide", label: "가이드", Comp: Guide },
];

export default function App() {
  const [tab, setTab] = useState("public");
  const active = TABS.find((t) => t.key === tab);
  const Active = active ? active.Comp : null;

  return (
    <div style={{ minHeight: "100vh", background: theme.bg, fontFamily: "'Noto Sans KR', 'Malgun Gothic', sans-serif", color: theme.text }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>
        <header style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: theme.accent, fontWeight: 700, marginBottom: 4 }}>AGR</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>농가 경영진단 AI 대시보드</h1>
        </header>

        <nav style={{ display: "flex", gap: 4, borderBottom: `1px solid ${theme.divider}`, marginBottom: 24, flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: "10px 16px", fontSize: 13, fontWeight: tab === t.key ? 700 : 400,
                color: tab === t.key ? theme.text : theme.textMuted,
                background: "transparent", border: "none", cursor: "pointer",
                borderBottom: tab === t.key ? `2px solid ${theme.accent}` : "2px solid transparent",
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <main>{Active && <Active />}</main>
      </div>
    </div>
  );
}
