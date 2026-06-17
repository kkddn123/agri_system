// 농산물 수급관리 가이드라인(2025 개정안, 농림축산식품부) 품목별 위기단계 임계치
// ----------------------------------------------------------------------------
// 가이드라인은 품목별로 평년 안정대(上品 평년가격)를 기준으로, 작형/시기별 등락률(%)에
// 따라 위기단계를 6단계(상승: 주의·경계·심각 / 하락: 주의·경계·심각)로 구분한다.
// 아래 값은 PDF의 "작형별(등락률)" / "시기별(등락률)" 표를 그대로 옮긴 것(평년 대비 %).
//   up   = [상승주의, 상승경계, 상승심각]   (모두 양수)
//   down = [하락주의, 하락경계, 하락심각]   (모두 음수)
//   months = 해당 작형/시기가 적용되는 월(1~12)
// 가이드라인이 다루는 품목: 배추·무·마늘(깐마늘)·양파·건고추·대파(겨울대파)·감자

export const SUPPLY_THRESHOLDS = {
  배추: {
    unitNote: "10kg",
    bands: [
      { label: "봄배추",   months: [5, 6],          up: [14, 27, 43], down: [-14, -27, -60] },
      { label: "여름배추", months: [7, 8, 9, 10],    up: [24, 48, 76], down: [-24, -48, -60] },
      { label: "가을배추", months: [11, 12],         up: [18, 37, 58], down: [-18, -37, -38] },
      { label: "겨울배추", months: [1, 2, 3, 4],     up: [15, 29, 46], down: [-15, -29, -55] },
    ],
  },
  무: {
    unitNote: "20kg",
    bands: [
      { label: "봄무",   months: [6, 7],             up: [14, 28, 45], down: [-14, -28, -37] },
      { label: "여름무", months: [8, 9, 10],         up: [20, 40, 64], down: [-20, -40, -48] },
      { label: "가을무", months: [11, 12],           up: [28, 55, 87], down: [-7, -14, -22] },
      { label: "겨울무", months: [1, 2, 3, 4, 5],    up: [15, 29, 46], down: [-15, -15, -16] },
    ],
  },
  마늘: {
    unitNote: "깐마늘 KAMIS 중도매인 기준",
    bands: [
      { label: "수확기",     months: [7, 8],                     up: [8, 15, 24],  down: [-8, -15, -49] },
      { label: "저장출하기", months: [9, 10, 11, 12, 1, 2],      up: [11, 15, 24], down: [-8, -15, -50] },
      { label: "단경기",     months: [3, 4, 5, 6],               up: [11, 23, 36], down: [-11, -23, -47] },
    ],
  },
  양파: {
    unitNote: "kg",
    bands: [
      { label: "수확기",     months: [4, 5, 6, 7],                  up: [17, 33, 53], down: [-17, -33, -35] },
      { label: "저장출하기", months: [8, 9, 10, 11, 12, 1, 2, 3],   up: [15, 29, 46], down: [-15, -20, -26] },
    ],
  },
  건고추: {
    unitNote: "600g",
    bands: [
      { label: "수확기",     months: [8, 9, 10],                          up: [7, 14, 23],  down: [-7, -7, -7] },
      { label: "저장출하기", months: [11, 12, 1, 2, 3, 4, 5, 6, 7],       up: [10, 19, 30], down: [-2, -5, -7] },
    ],
  },
  대파: {
    unitNote: "겨울대파 kg",
    bands: [
      { label: "겨울대파", months: [12, 1, 2, 3, 4], up: [30, 61, 97], down: [-30, -37, -44] },
    ],
  },
  감자: {
    unitNote: "20kg",
    bands: [
      { label: "시설감자", months: [1, 2, 3, 4],  up: [15, 29, 46], down: [-15, -29, -30] },
      { label: "5월감자",  months: [5],           up: [15, 30, 47], down: [-15, -30, -38] },
      { label: "봄감자",   months: [6, 7],        up: [14, 28, 44], down: [-4, -9, -13] },
      { label: "여름감자", months: [8, 9, 10],    up: [8, 16, 26],  down: [-8, -16, -23] },
      { label: "가을감자", months: [11, 12],      up: [10, 21, 33], down: [-10, -11, -12] },
    ],
  },
};

const STAGE_STYLE = {
  "상승 심각": { color: "#ef5350" },
  "상승 경계": { color: "#e8721c" },
  "상승 주의": { color: "#f0a93a" },
  "안정":      { color: "#3ecf6e" },
  "하락 주의": { color: "#f0a93a" },
  "하락 경계": { color: "#e8721c" },
  "하락 심각": { color: "#ef5350" },
};

function pickBand(bands, month) {
  return bands.find((b) => b.months.includes(month)) || bands[0];
}

// 품목별 작형 임계치로 수급 단계를 판정. 해당 품목 데이터가 없으면 null 반환.
export function classifySupplyStageByItem(cropName, devPct, month) {
  const item = SUPPLY_THRESHOLDS[cropName];
  if (!item) return null;
  const band = pickBand(item.bands, month);
  const [u1, u2, u3] = band.up;
  const [d1, d2, d3] = band.down;

  let label, bandText;
  if (devPct >= u3)      { label = "상승 심각"; bandText = `평년 +${u3}% 이상`; }
  else if (devPct >= u2) { label = "상승 경계"; bandText = `평년 +${u2}~${u3}%`; }
  else if (devPct >= u1) { label = "상승 주의"; bandText = `평년 +${u1}~${u2}%`; }
  else if (devPct > d1)  { label = "안정";      bandText = `평년 ${d1}~+${u1}%`; }
  else if (devPct > d2)  { label = "하락 주의"; bandText = `평년 ${d2}~${d1}%`; }
  else if (devPct > d3)  { label = "하락 경계"; bandText = `평년 ${d3}~${d2}%`; }
  else                   { label = "하락 심각"; bandText = `평년 ${d3}% 이하`; }

  return {
    label,
    color: STAGE_STYLE[label].color,
    band: bandText,
    season: band.label,
  };
}
