#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
data/ 폴더의 3개 JSON이 올바른 형식인지, 예시(_example) 데이터가 아직 남아있는지 점검합니다.
실제 데이터를 넣은 뒤 사이트에 올리기 전에 한 번 돌려보세요.

사용법: python validate_data.py
"""

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "public" / "data"

CHECKS = {
    "public-datasets.json": ("datasets", ["id", "title", "agency", "category"]),
    "income-data.json": ("crops", ["id", "name", "total_revenue_per_10a", "management_cost_per_10a"]),
    "rda-cases.json": ("cases", ["id", "label", "form", "behaviorAnswers"]),
}


def check_file(filename: str, list_key: str, required_fields: list[str]):
    path = DATA_DIR / filename
    print(f"\n--- {filename} ---")
    if not path.exists():
        print("  ❌ 파일이 없습니다.")
        return

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"  ❌ JSON 형식 오류: {e}")
        return

    items = data.get(list_key, [])
    if not isinstance(items, list):
        print(f"  ❌ '{list_key}' 항목이 배열이 아닙니다.")
        return

    real_items = [i for i in items if not i.get("_example")]
    example_items = [i for i in items if i.get("_example")]
    ids = [i.get("id") for i in items]
    dup_ids = {i for i in ids if ids.count(i) > 1}

    print(f"  전체 {len(items)}건 (실데이터 {len(real_items)} / 예시 {len(example_items)})")
    if example_items:
        print(f"  ⚠️  예시 데이터가 아직 {len(example_items)}건 남아 있습니다. 실데이터 입력 후 지워주세요.")
    if dup_ids:
        print(f"  ❌ id 중복: {dup_ids}")

    missing_report = []
    for item in real_items:
        missing = [f for f in required_fields if item.get(f) in (None, "")]
        if missing:
            missing_report.append((item.get("id", "?"), missing))
    if missing_report:
        print("  ⚠️  필수 필드 누락:")
        for item_id, missing in missing_report:
            print(f"     - {item_id}: {missing}")

    if real_items and not dup_ids and not missing_report:
        print("  ✅ 실데이터 항목 모두 정상")


def main():
    for filename, (list_key, required_fields) in CHECKS.items():
        check_file(filename, list_key, required_fields)


if __name__ == "__main__":
    main()
