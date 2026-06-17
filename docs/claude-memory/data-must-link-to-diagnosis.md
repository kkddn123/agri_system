---
name: data-must-link-to-diagnosis
description: Core project principle — every data source added to the dashboard must connect to the farm diagnosis (농가 진단)
metadata: 
  node_type: memory
  type: project
  originSessionId: 113395c2-a1e3-497e-a501-057ab2eac437
---

모든 추가 데이터(KAMIS 도매시장 가격, MAFRA 소비 트렌드, 농촌진흥청 출하 가이드 PDF, 공공데이터 등)는 **농가 진단(FarmDiagnosis)을 중심으로 연관성을 가져야 한다**. 독립된 탭으로 따로 노는 것은 안 됨.

**Why:** 사용자가 명시한 핵심 설계 원칙 (2026-06-17). 대시보드의 목적은 농가 경영 진단이고, 나머지 데이터는 진단 결과를 보강/설명하는 역할이어야 한다.

**How to apply:** 새 데이터를 추가할 때마다 진단의 작목(crop)과 매핑되도록 연결 고리를 만든다. 예: 진단한 작목 → 해당 작목의 KAMIS 실시간 도매시세(내 판매단가와 비교), 소비 트렌드(수요 추세), 매칭되는 출하 가이드. 작목↔데이터소스 매핑 레이어를 공유하는 것이 핵심.

진단 입력/벤치마크는 [income-data.json] (crops 배열, 작목별 10a 기준 수익성)을 사용한다.
