#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
농사로 작목별 소득자료(CSV/XLSX) → data/income-data.json 변환 스크립트

나중에 농사로에서 받은 원본 파일을 그대로 이 스크립트에 넘기면,
대시보드가 읽는 JSON 스키마로 변환해 data/income-data.json에 반영합니다.
(JSON을 직접 손으로 고치지 않아도 됩니다.)

사용법
    pip install pandas openpyxl --break-system-packages   # 최초 1회
    python ingest_income_data.py 농사로_2026_소득자료.xlsx
    python ingest_income_data.py 농사로_2026_소득자료.csv --year 2026

원본 파일 컬럼명이 아래 한글 헤더와 다르면 COLUMN_MAP만 고쳐서 다시 실행하세요.
필요한 컬럼: 작목명, 분류, 총수입, 경영비, 단가, 생산량
  - 단위는 모두 "원/10a", "원/kg", "kg/10a" 기준 (10a = 300평 = 1,000㎡)
  - 소득/소득률은 총수입·경영비로 자동 계산됩니다 (원본에 이미 있으면 그 값을 우선 사용)
"""

import argparse
import json
import sys
from pathlib import Path

DATA_FILE = Path(__file__).resolve().parent.parent / "public" / "data" / "income-data.json"

# 원본 파일 컬럼명 -> 내부 필드명. 원본 헤더가 다르면 여기만 고치면 됩니다.
COLUMN_MAP = {
    "작목명": "name",
    "분류": "category",
    "총수입": "total_revenue_per_10a",
    "경영비": "management_cost_per_10a",
    "소득": "income_per_10a",
    "소득률": "income_rate_pct",
    "단가": "unit_price_per_kg",
    "생산량": "yield_per_10a_kg",
}

REQUIRED = ["name", "total_revenue_per_10a", "management_cost_per_10a"]


def load_table(path: Path, sheet: str | None):
    try:
        import pandas as pd
    except ImportError:
        sys.exit("pandas가 필요합니다: pip install pandas openpyxl --break-system-packages")

    if path.suffix.lower() in (".xlsx", ".xls"):
        df = pd.read_excel(path, sheet_name=sheet or 0)
    else:
        df = pd.read_csv(path)
    df = df.rename(columns=COLUMN_MAP)
    return df


def to_records(df, year: int | None):
    records = []
    skipped = []
    for _, row in df.iterrows():
        rec = {k: row.get(k) for k in COLUMN_MAP.values() if k in df.columns}
        missing = [r for r in REQUIRED if not rec.get(r) and rec.get(r) != 0]
        if missing:
            skipped.append((rec.get("name", "(이름없음)"), missing))
            continue

        total = float(rec["total_revenue_per_10a"])
        cost = float(rec["management_cost_per_10a"])
        income = rec.get("income_per_10a")
        income = float(income) if income not in (None, "") else round(total - cost, 1)
        rate = rec.get("income_rate_pct")
        rate = float(rate) if rate not in (None, "") else (round(income / total * 100, 1) if total else None)

        records.append({
            "id": f"CROP-{rec['name']}",
            "_example": False,
            "name": str(rec["name"]).strip(),
            "category": str(rec.get("category") or "").strip(),
            "total_revenue_per_10a": total,
            "management_cost_per_10a": cost,
            "income_per_10a": income,
            "income_rate_pct": rate,
            "unit_price_per_kg": rec.get("unit_price_per_kg"),
            "yield_per_10a_kg": rec.get("yield_per_10a_kg"),
        })
    return records, skipped


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("source", type=Path, help="농사로 원본 CSV/XLSX 경로")
    ap.add_argument("--sheet", default=None, help="엑셀 시트 이름 (기본: 첫 시트)")
    ap.add_argument("--year", type=int, default=None, help="기준 연도 (예: 2026)")
    ap.add_argument("--out", type=Path, default=DATA_FILE, help="출력 JSON 경로")
    args = ap.parse_args()

    if not args.source.exists():
        sys.exit(f"파일을 찾을 수 없습니다: {args.source}")

    df = load_table(args.source, args.sheet)
    records, skipped = to_records(df, args.year)

    if not records:
        sys.exit("변환된 작목이 없습니다. COLUMN_MAP과 원본 헤더를 확인하세요.")

    payload = {
        "_안내": "이 파일은 ingest_income_data.py로 자동 생성/갱신되었습니다. 수동 편집 시 다음 실행에서 덮어쓰일 수 있습니다.",
        "meta": {
            "year": args.year,
            "unit": "원/10a (10a = 300평 = 1,000㎡)",
            "source": "농촌진흥청 농사로 농산물소득자료",
            "crop_count": len(records),
        },
        "crops": records,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"변환 완료: {len(records)}개 작목 → {args.out}")
    if skipped:
        print(f"건너뜀 {len(skipped)}건 (필수값 누락):")
        for name, missing in skipped:
            print(f"  - {name}: {missing} 없음")


if __name__ == "__main__":
    main()
