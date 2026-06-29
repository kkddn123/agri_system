// 작목 ↔ 데이터소스 공유 매핑 레이어
// ----------------------------------------------------------------------------
// 농가 진단을 중심으로 KAMIS 도매시세 / 소비 트렌드 / 출하 가이드(PDF) /
// 농식품 소비월보(소비자 선호)를 한 작목으로 묶어주는 단일 진실 공급원.
//
//   name       : 작목명 (진단 드롭다운 + income-data.json name 과 매칭)
//   kamis      : KAMIS 가격 조회용 코드 | null
//   trendItem  : 소비 트렌드(MAFRA) ITEM_NM | null
//   guideId    : public-datasets.json 출하 가이드 id | null
//   consumeId  : public-datasets.json 농식품 소비월보 id | null
//                → consumerInsight 필드를 AI 프롬프트에 주입해 "소비자가 원하는 상품" 맥락을 제공

// kamis.itemCode / kindCode 는 KAMIS monthlySalesList 응답 caption 으로 실측 검증한 값.
export const CROP_REGISTRY = [
  { name: "감자",   category: "식량작물", kamis: { categoryCode: "100", itemCode: "152", kindCode: "01" }, trendItem: "감자",   guideId: "RDA-GUIDE-2026-05",  consumeId: "RDA-CONSUME-2024-12" },
  { name: "고구마", category: "식량작물", kamis: { categoryCode: "100", itemCode: "151", kindCode: "00" }, trendItem: "고구마", guideId: "RDA-GUIDE-2026-02",  consumeId: "RDA-CONSUME-2026-02" },
  { name: "무",     category: "채소류",   kamis: { categoryCode: "200", itemCode: "231", kindCode: "01" }, trendItem: "무",     guideId: "RDA-GUIDE-2026-03",  consumeId: null },
  { name: "당근",   category: "채소류",   kamis: { categoryCode: "200", itemCode: "232", kindCode: "01" }, trendItem: "당근",   guideId: "RDA-GUIDE-2026-04",  consumeId: "RDA-CONSUME-2025-02" },
  { name: "감귤",   category: "과일류",   kamis: { categoryCode: "400", itemCode: "415", kindCode: "01" }, trendItem: null,     guideId: "RDA-GUIDE-2026-01",  consumeId: null },
  { name: "배추",   category: "채소류",   kamis: { categoryCode: "200", itemCode: "211", kindCode: "01" }, trendItem: "배추",   guideId: null,                 consumeId: null },
  { name: "상추",   category: "채소류",   kamis: { categoryCode: "200", itemCode: "214", kindCode: "01" }, trendItem: "상추",   guideId: null,                 consumeId: null },
  { name: "딸기",   category: "채소류",   kamis: { categoryCode: "200", itemCode: "226", kindCode: "00" }, trendItem: "딸기",   guideId: "RDA-GUIDE-TRADE-04", consumeId: "RDA-CONSUME-2025-01" },
  { name: "양파",   category: "채소류",   kamis: { categoryCode: "200", itemCode: "245", kindCode: "00" }, trendItem: "양파",   guideId: null,                 consumeId: "RDA-CONSUME-2026-03" },
  { name: "마늘",   category: "채소류",   kamis: { categoryCode: "200", itemCode: "258", kindCode: "01" }, trendItem: "마늘",   guideId: null,                 consumeId: "RDA-CONSUME-2026-03" },
  { name: "대파",   category: "채소류",   kamis: { categoryCode: "200", itemCode: "246", kindCode: "00" }, trendItem: null,     guideId: "RDA-GUIDE-TRADE-05", consumeId: null },
  { name: "토마토", category: "채소류",   kamis: { categoryCode: "200", itemCode: "225", kindCode: "00" }, trendItem: "토마토", guideId: "RDA-GUIDE-TRADE-07", consumeId: "RDA-CONSUME-2025-05" },
  { name: "오이",   category: "채소류",   kamis: { categoryCode: "200", itemCode: "223", kindCode: "01" }, trendItem: "오이",   guideId: "RDA-GUIDE-TRADE-08", consumeId: null },
  { name: "사과",   category: "과일류",   kamis: { categoryCode: "400", itemCode: "411", kindCode: "05" }, trendItem: "사과",   guideId: "RDA-GUIDE-TRADE-01", consumeId: "RDA-CONSUME-2024-10" },
  { name: "배",     category: "과일류",   kamis: { categoryCode: "400", itemCode: "412", kindCode: "01" }, trendItem: "배",     guideId: "RDA-GUIDE-TRADE-11", consumeId: "RDA-CONSUME-2025-09" },
  { name: "수박",   category: "과일류",   kamis: { categoryCode: "200", itemCode: "221", kindCode: "00", unitKg: 8 }, trendItem: "수박", guideId: "RDA-GUIDE-TRADE-03", consumeId: null },
  { name: "참외",   category: "과일류",   kamis: { categoryCode: "200", itemCode: "222", kindCode: "00" }, trendItem: "참외",   guideId: "RDA-GUIDE-TRADE-02", consumeId: "RDA-CONSUME-2024-08" },
  { name: "포도",   category: "과일류",   kamis: { categoryCode: "400", itemCode: "414", kindCode: "01" }, trendItem: "포도",   guideId: "RDA-GUIDE-TRADE-06", consumeId: "RDA-CONSUME-2025-08" },
  { name: "복숭아", category: "과일류",   kamis: { categoryCode: "400", itemCode: "413", kindCode: "01" }, trendItem: "복숭아", guideId: "RDA-GUIDE-TRADE-10", consumeId: "RDA-CONSUME-2025-06" },
  { name: "옥수수", category: "식량작물", kamis: null, trendItem: null, guideId: "RDA-GUIDE-TRADE-09", consumeId: "RDA-CONSUME-2025-07" },
];

export function findCrop(name) {
  if (!name) return null;
  return CROP_REGISTRY.find((c) => c.name === name) || null;
}

// "10kg", "1.2kg(8~9개)", "kg", "8kg(상자)" 등에서 kg 환산 무게를 추출.
// 추출 실패 시 null (원/kg 정규화 불가).
export function parseUnitKg(unitStr) {
  if (!unitStr) return null;
  const m = String(unitStr).match(/([\d.]+)\s*kg/i);
  if (m) return parseFloat(m[1]);
  if (/(^|[^a-z])kg([^a-z]|$)/i.test(unitStr)) return 1; // 단위가 그냥 'kg'
  return null;
}
