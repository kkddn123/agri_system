import React from "react";
import { theme, card } from "../theme";

export default function Guide() {
  return (
    <div>
      <h2 style={{ color: theme.text, fontSize: 18, margin: 0 }}>가이드</h2>
      <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 6, marginBottom: 20 }}>
        이 대시보드로 무엇을 할 수 있는지, 데이터를 어떻게 채우는지 안내합니다.
      </p>

      <Section title="이 대시보드로 할 수 있는 것">
        <Item title="작목별 수익성 비교">농사로 소득자료를 넣으면 소득률·소득액·총수입 기준으로 작목을 비교할 수 있습니다.</Item>
        <Item title="내 농가 경영 진단">내 면적·생산량·단가·경영비를 입력하면 전국 평균과 즉시 비교합니다.</Item>
        <Item title="판매경로 진단">행동기반 5문항으로 농가 유형을 분류하고, 규칙기반 TOPSIS 점수로 5개 판매경로 적합도를 진단합니다.</Item>
        <Item title="공공데이터 카탈로그">관련 공공데이터셋을 한 곳에서 검색·필터링합니다.</Item>
      </Section>

      <Section title="데이터를 채우는 방법">
        <Item title="A. AI 어시스턴트에게 요청">"public/data/income-data.json에 OO 작목 추가해줘"처럼 요청하면 파일이 갱신되고, 새로고침하면 화면에 반영됩니다.</Item>
        <Item title="B. JSON 직접 수정">public/data/ 폴더의 JSON 파일을 열어 _example 항목을 지우고 실제 값을 채웁니다. 필드 설명은 public/data/SCHEMA.md를 참고하세요.</Item>
        <Item title="C. 파이썬 스크립트로 일괄 변환">농사로 원본 CSV/XLSX를 scripts/ingest_income_data.py에 넘기면 income-data.json이 자동으로 생성·갱신됩니다. 넣은 뒤 scripts/validate_data.py로 형식을 점검하세요.</Item>
      </Section>

      <Section title="데이터 출처">
        <div style={{ color: theme.textMuted, fontSize: 13, lineHeight: 1.7 }}>
          작목별 소득자료는 농촌진흥청 농사로(nongsaro.go.kr)의 농산물소득자료를 기준으로 하며,
          단위는 원/10a(10a = 300평 = 1,000㎡)로 통일합니다. 공공데이터 카탈로그의 각 항목은
          public/data/public-datasets.json에 적힌 출처 기관과 링크를 그대로 보여줍니다.
        </div>
      </Section>

      <div style={{ ...card, marginTop: 24, fontSize: 12, color: theme.textFaint, textAlign: "center" }}>
        규칙기반 진단 시스템 · 실제 통계모형이 아님을 명확히 밝힙니다
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h3 style={{ color: theme.text, fontSize: 14, marginBottom: 12, borderBottom: `1px solid ${theme.divider}`, paddingBottom: 8 }}>
        {title}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </div>
  );
}

function Item({ title, children }) {
  return (
    <div style={{ ...card, padding: 14 }}>
      <div style={{ color: theme.text, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{title}</div>
      <div style={{ color: theme.textMuted, fontSize: 12.5, lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}
