#!/usr/bin/env python3
"""
Append today's dataset/image counts to static/data/dataset_history.json, which powers the
homepage growth charts. dataset_history.json is otherwise hand-maintained (see its `_readme`
field) -- this just automates counting the current catalog so you don't have to.

Usage:
    python3 scripts/append_dataset_snapshot.py
"""

import json
from datetime import date, datetime, timezone
from pathlib import Path

STATIC_DATA_DIR = Path(__file__).resolve().parent.parent / "static" / "data"
HISTORY_PATH = STATIC_DATA_DIR / "dataset_history.json"


def read_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def is_child_dataset(entry: dict) -> bool:
    return bool(entry.get("parent_dataset")) and entry.get("dataset_type") != "vlm"


def current_counts() -> tuple[int, int]:
    """Same counting rules as computeDatasetStats in src/lib/datasets.ts: dedupe the two
    manifests by name, drop child/variant datasets, and exclude iNatAg-mini's images as a
    reduced duplicate of iNatAg's."""
    datasets = read_json(STATIC_DATA_DIR / "datasets.json") + read_json(STATIC_DATA_DIR / "hf_datasets.json")

    merged: dict[str, dict] = {}
    for entry in datasets:
        name = entry.get("name")
        if name and name not in merged:
            merged[name] = entry

    top_level = [entry for entry in merged.values() if not is_child_dataset(entry)]
    dataset_count = len(top_level)
    image_count = sum(
        entry.get("num_images") or 0
        for entry in top_level
        if not entry["name"].startswith("iNatAg-mini")
    )
    return dataset_count, image_count


def main() -> None:
    history = read_json(HISTORY_PATH)
    dataset_count, image_count = current_counts()
    today = date.today().isoformat()

    points = history["points"]
    last = points[-1] if points else None
    if last and last.get("date") == today:
        last["datasetCount"] = dataset_count
        last["imageCount"] = image_count
        print(f"Updated today's ({today}) snapshot: {dataset_count} datasets, {image_count} images")
    else:
        period = datetime.now(timezone.utc).strftime("%b ") + str(int(datetime.now(timezone.utc).strftime("%d")))
        points.append({
            "period": period,
            "date": today,
            "datasetCount": dataset_count,
            "imageCount": image_count,
        })
        print(f"Appended {today} snapshot: {dataset_count} datasets, {image_count} images")

    history["generatedAt"] = today
    with HISTORY_PATH.open("w", encoding="utf-8") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)
        f.write("\n")


if __name__ == "__main__":
    main()
