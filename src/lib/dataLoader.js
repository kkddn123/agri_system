// data/*.json 파일을 읽어오는 공용 유틸.
// 이 파일의 데이터를 교체하기만 하면, 코드를 다시 건드릴 필요 없이 화면에 자동 반영됩니다.
//
// 주의: DATA_BASE는 정적 파일 서버(Express static, Vite public 등)가 /data 를
// 그대로 서빙하는 경로를 가정합니다. 실제 배치 위치가 다르면 이 한 줄만 고치세요.
const DATA_BASE = "/data";

async function loadJSON(filename) {
  const res = await fetch(`${DATA_BASE}/${filename}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${filename} 로드 실패 (HTTP ${res.status})`);
  return res.json();
}

export async function loadPublicDatasets() {
  const data = await loadJSON("public-datasets.json");
  return { items: data.datasets || [], meta: data.meta || {} };
}

export async function loadIncomeData() {
  const data = await loadJSON("income-data.json");
  return { items: data.crops || [], meta: data.meta || {} };
}

export async function loadRdaCases() {
  const data = await loadJSON("rda-cases.json");
  return { items: data.cases || [], meta: data.meta || {} };
}

export function isExample(item) {
  return !!item?._example;
}
