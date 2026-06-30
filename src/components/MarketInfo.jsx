import React, { useState } from "react";
import { theme } from "../theme";
import CropProfitability from "./CropProfitability";
import KamisPrice from "./KamisPrice";
import ConsumeTrend from "./ConsumeTrend";

// "시장 정보" — 진단을 돕는 참고·열람용 자료를 한곳에 모은 카테고리.
// 작목별 수익성 비교 / 도매시장 가격 / 소비 트렌드를 하위 탭으로 전환하며 봅니다.
const SUBTABS = [
  { key: "profit", label: "작목별 수익성 비교", Comp: CropProfitability },
  { key: "kamis", label: "도매시장 가격", Comp: KamisPrice },
  { key: "consume", label: "소비 트렌드", Comp: ConsumeTrend },
];

export default function MarketInfo() {
  const [sub, setSub] = useState("profit");
  const Active = (SUBTABS.find((t) => t.key === sub) || SUBTABS[0]).Comp;

  return (
    <div>
      <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 0, marginBottom: 14 }}>
        진단을 돕는 참고 자료입니다. 작목 수익성·도매가격·소비 트렌드를 한곳에서 열람하세요.
      </p>

      <div style={{ display: "flex", gap: 6, marginBottom: 22, flexWrap: "wrap" }}>
        {SUBTABS.map((t) => {
          const on = sub === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setSub(t.key)}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: on ? 700 : 500,
                color: on ? "#06210f" : theme.textMuted,
                background: on ? theme.accent : theme.panelAlt,
                border: `1px solid ${on ? theme.accent : theme.panelBorder}`,
                borderRadius: 999,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <Active />
    </div>
  );
}
