import React, { useState } from "react";
import { theme } from "./theme";
import PortfolioDiagnosis from "./components/PortfolioDiagnosis";
import MarketInfo from "./components/MarketInfo";
import PublicDataCatalog from "./components/PublicDataCatalog";

const TABS = [
  { key: "diagnosis", label: "농가 진단", Comp: PortfolioDiagnosis },
  { key: "market", label: "시장 정보", Comp: MarketInfo },
  { key: "public", label: "공공데이터", Comp: PublicDataCatalog },
];

export default function App() {
  const [tab, setTab] = useState("diagnosis");
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
