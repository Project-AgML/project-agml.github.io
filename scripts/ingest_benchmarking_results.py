#!/usr/bin/env python3
"""
Pull the latest benchmark run for every dataset out of agml-benchmarking's
benchmark/results/ tree, merge the report.json files into
static/data/dataset-benchmarking/results.json, and re-encode each dataset's
umap_2d.json / umap_3d.json into the UEB2 binary format described in
agml-benchmarking's README ("UMAP embedding format (UEB2)").

Newer pipeline runs already write <dataset>_umap.bin into the run's
embeddings/ dir; that file is copied to the site as-is. Older runs only have
umap_2d.json/umap_3d.json: those are converted to <dataset>_umap.bin in the
same run dir and the json files are deleted.

At the end, run dirs without a usable report.json (crashed/killed jobs) and
dataset dirs with no complete run are listed and then deleted from the source
results tree, unless --dry-run is passed.

Usage:
    python3 scripts/ingest_benchmarking_results.py [--results-dir PATH] [--dry-run]
"""

import argparse
import filecmp
import json
import re
import shutil
import struct
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RESULTS_DIR = (
    REPO_ROOT.parent / "agml-benchmarking" / "benchmark" / "results"
)
STATIC_DATA_DIR = REPO_ROOT / "static" / "data" / "dataset-benchmarking"
RESULTS_JSON_PATH = STATIC_DATA_DIR / "results.json"
EMBEDDINGS_DIR = STATIC_DATA_DIR / "embeddings"

RUN_DIR_RE = re.compile(r"^\d{8}_\d{6}$")
INATAG_PREFIXES = ("iNatAg", "iNatAg-mini")

# A real metric block is a few hundred bytes. Anything past this is almost
# certainly a pipeline bug (seen in the wild: metadata_coverage dumping a raw
# multispectral "bands" column's byte strings into a value-counts dict,
# producing a ~1.5GB report.json) rather than legitimate benchmark output.
MAX_METRIC_BYTES = 1_000_000

# Metrics the pipeline still emits but the site no longer shows; dropped on
# ingest so they never land in results.json.
DROPPED_METRICS = ("metadata_coverage",)


# A report.json bigger than this is never parsed (parsing the pipeline-bug ones,
# up to ~12GB, takes minutes and can exhaust memory). Such a run still counts as
# a complete run (it is NOT deleted); its results.json entry is just left as-is.
MAX_REPORT_FILE_BYTES = 200_000_000
OVERSIZED = object()


def is_run_dir(path: Path) -> bool:
    return path.is_dir() and bool(RUN_DIR_RE.match(path.name))


def load_valid_report(run_dir: Path):
    """Return the parsed report.json for a run dir, or None if it's missing/corrupt."""
    report_path = run_dir / "report.json"
    if not report_path.is_file():
        return None
    try:
        if report_path.stat().st_size > MAX_REPORT_FILE_BYTES:
            return OVERSIZED
    except OSError:
        return None
    try:
        with report_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None
    if not isinstance(data, dict) or "metrics" not in data:
        return None
    return data


def sanitize_report(report: dict, key: str) -> dict:
    """Drop DROPPED_METRICS, and strip any metric block that's absurdly large for what it represents
    (a pipeline bug, not real data) so it doesn't get baked into the site's
    results.json. Warns loudly instead of silently dropping it."""
    metrics = report.get("metrics")
    if not isinstance(metrics, dict):
        return report
    for metric_name in DROPPED_METRICS:
        metrics.pop(metric_name, None)
    for metric_name, value in list(metrics.items()):
        size = len(json.dumps(value))
        if size > MAX_METRIC_BYTES:
            print(
                f"  [warn] {key}: metrics.{metric_name} is {size / 1e6:.1f}MB "
                f"(likely a pipeline bug upstream) -- replacing with a placeholder"
            )
            metrics[metric_name] = {
                "error": "omitted during ingestion: oversized, likely a pipeline bug",
                "original_size_bytes": size,
            }
    return report


def iter_dataset_dirs(base: Path, prefix: str = ""):
    """Yield (key, path) for every leaf dataset directory under base.
    iNatAg / iNatAg-mini are one level of nesting with their species as the
    actual dataset dirs, so recurse into those instead of treating them as
    datasets themselves."""
    for entry in sorted(base.iterdir(), key=lambda p: p.name):
        if not entry.is_dir():
            continue
        if entry.name in INATAG_PREFIXES:
            yield from iter_dataset_dirs(entry, prefix=f"{entry.name}/")
        else:
            yield prefix + entry.name, entry


def scan_runs(dataset_path: Path):
    """Return (valid_runs, incomplete_runs) for a dataset dir, oldest first.
    A run is incomplete when it has no usable report.json. Nothing is deleted
    here; deletion is deferred to the end of the run (see delete_paths)."""
    run_dirs = sorted((p for p in dataset_path.iterdir() if is_run_dir(p)), key=lambda p: p.name)
    valid_runs, incomplete_runs = [], []
    for run_dir in run_dirs:
        (valid_runs if load_valid_report(run_dir) is not None else incomplete_runs).append(run_dir)
    return valid_runs, incomplete_runs


def is_valid_ueb2(path: Path) -> bool:
    try:
        with path.open("rb") as f:
            return f.read(4) == b"UEB2" and path.stat().st_size > 4
    except OSError:
        return False


def ensure_run_bin(run_dir: Path, leaf: str, dry_run: bool):
    """Make sure a run's embeddings/ dir holds <leaf>_umap.bin (UEB2) and no
    umap *.json. Newer pipeline runs already write the .bin; older ones have
    umap_2d.json/umap_3d.json, which are converted in place and then deleted
    (only after the .bin is written and verified). Returns the .bin path, or
    None if there isn't one (missing/unconvertible, or dry-run)."""
    embeddings_dir = run_dir / "embeddings"
    bin_path = embeddings_dir / f"{leaf}_umap.bin"
    json_files = sorted(embeddings_dir.glob("*umap*.json")) if embeddings_dir.is_dir() else []
    rel = run_dir.relative_to(run_dir.parent.parent.parent)

    if is_valid_ueb2(bin_path):
        if json_files:
            print(f"  {rel}: .bin already present, removing {len(json_files)} leftover umap json file(s)")
            if not dry_run:
                for jf in json_files:
                    jf.unlink()
        return bin_path

    p2d, p3d = embeddings_dir / "umap_2d.json", embeddings_dir / "umap_3d.json"
    if not (p2d.is_file() and p3d.is_file()):
        print(f"  [warn] {rel}: no umap .bin and no umap_2d.json/umap_3d.json")
        return None
    if dry_run:
        print(f"  {rel}: would convert umap json -> {bin_path.name} and delete the json files")
        return None

    try:
        with p2d.open("r", encoding="utf-8") as f:
            points_2d = json.load(f)
        with p3d.open("r", encoding="utf-8") as f:
            points_3d = json.load(f)
        write_ueb2(points_2d, points_3d, bin_path)
    except (AssertionError, ValueError, KeyError, OSError) as e:
        print(f"  [warn] {rel}: umap conversion failed ({e!r}), keeping json files")
        bin_path.unlink(missing_ok=True)
        return None
    if not is_valid_ueb2(bin_path):
        print(f"  [warn] {rel}: written .bin failed verification, keeping json files")
        return None
    for jf in json_files:
        jf.unlink()
    print(f"  {rel}: converted umap json -> {bin_path.name}, deleted {len(json_files)} json file(s)")
    return bin_path


def sync_site_bin(key: str, src: Path, dry_run: bool):
    """Copy a run's .bin into the site's embeddings dir unless it's already identical."""
    dest = EMBEDDINGS_DIR / f"{key}_umap.bin"
    if dest.is_file() and filecmp.cmp(src, dest, shallow=False):
        print("  site embedding: unchanged")
        return
    state = "updated" if dest.is_file() else "new"
    print(f"  site embedding: {state}{' (dry-run, not written)' if dry_run else ''}")
    if not dry_run:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)


def write_ueb2(points_2d, points_3d, out_path: Path):
    assert len(points_2d) == len(points_3d), "2D/3D point count mismatch"
    for a, b in zip(points_2d, points_3d):
        assert a["label"] == b["label"]
        assert a.get("split", "train") == b.get("split", "train")
        assert a.get("index") == b.get("index")

    labels = sorted({p["label"] for p in points_2d})
    splits = sorted({p.get("split", "train") for p in points_2d})
    label_idx = {label: i for i, label in enumerate(labels)}
    split_idx = {split: i for i, split in enumerate(splits)}

    if len(labels) > 0xFFFF:
        raise ValueError(f"too many labels ({len(labels)}) for uint16 label table")
    if len(splits) > 0xFF:
        raise ValueError(f"too many splits ({len(splits)}) for uint8 split table")

    flags = 0b01 | 0b10  # both 2D and 3D sections present

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("wb") as f:
        f.write(b"UEB2")
        f.write(struct.pack("<B", flags))
        f.write(struct.pack("<H", len(labels)))
        f.write(struct.pack("<B", len(splits)))
        f.write(struct.pack("<I", len(points_2d)))

        for label in labels:
            encoded = label.encode("utf-8")
            f.write(struct.pack("<B", len(encoded)))
            f.write(encoded)

        for split in splits:
            encoded = split.encode("utf-8")
            f.write(struct.pack("<B", len(encoded)))
            f.write(encoded)

        for p in points_2d:
            f.write(struct.pack(
                "<HBI",
                label_idx[p["label"]],
                split_idx[p.get("split", "train")],
                p.get("index", 0),
            ))

        for p in points_2d:
            f.write(struct.pack("<ff", p["x"], p["y"]))

        for p in points_3d:
            f.write(struct.pack("<fff", p["x"], p["y"], p["z"]))


def process_dataset(key: str, valid_runs: list, results: dict, dry_run: bool):
    leaf = valid_runs[-1].parent.name
    # Every kept run gets its umap json converted to .bin; only the latest feeds the site.
    bins = {run: ensure_run_bin(run, leaf, dry_run) for run in valid_runs}
    latest = valid_runs[-1]

    report = load_valid_report(latest)
    if report is OVERSIZED:
        size_mb = (latest / "report.json").stat().st_size / 1e6
        print(f"  [warn] {key}: report.json is {size_mb:.0f}MB (pipeline bug upstream), "
              f"not parsed -- results.json entry left unchanged")
        if bins[latest] is not None:
            sync_site_bin(key, bins[latest], dry_run)
        return
    report = sanitize_report(report, key)
    if key not in results:
        status = "new"
    elif results[key] != report:
        status = "updated"
    else:
        status = "unchanged"
    print(f"  results.json entry: {status}")
    results[key] = report

    if bins[latest] is not None:
        sync_site_bin(key, bins[latest], dry_run)
    elif not dry_run:
        print(f"  [warn] {key}: no embedding .bin available for the latest run")


def delete_paths(paths: list, root: Path, dry_run: bool):
    for path in paths:
        print(f"  {'would delete' if dry_run else 'deleting'}: {path.relative_to(root)}")
        if not dry_run:
            shutil.rmtree(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results-dir", type=Path, default=DEFAULT_RESULTS_DIR)
    parser.add_argument("--dry-run", action="store_true", help="report what would happen without writing or deleting anything")
    args = parser.parse_args()

    results_dir = args.results_dir
    if not results_dir.is_dir():
        raise SystemExit(f"results dir not found: {results_dir}")

    results = {}
    if RESULTS_JSON_PATH.is_file():
        with RESULTS_JSON_PATH.open("r", encoding="utf-8") as f:
            results = json.load(f)

    processed = 0
    incomplete_runs = []   # failed run dirs inside datasets that still have valid runs
    empty_datasets = []    # dataset dirs with no valid run at all

    for key, dataset_path in iter_dataset_dirs(results_dir):
        print(f"{key}")
        valid_runs, bad_runs = scan_runs(dataset_path)
        if not valid_runs:
            empty_datasets.append(dataset_path)
            continue
        incomplete_runs.extend(bad_runs)
        process_dataset(key, valid_runs, results, args.dry_run)
        processed += 1

    if not args.dry_run:
        with RESULTS_JSON_PATH.open("w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, ensure_ascii=False, sort_keys=True)
            f.write("\n")

    print(f"\nProcessed {processed} datasets")
    if not args.dry_run:
        print(f"Wrote {RESULTS_JSON_PATH.relative_to(REPO_ROOT)}")

    print(f"\nIncomplete runs (no usable report.json): {len(incomplete_runs)}")
    delete_paths(incomplete_runs, results_dir, args.dry_run)
    print(f"\nDataset dirs with no complete run: {len(empty_datasets)}")
    delete_paths(empty_datasets, results_dir, args.dry_run)


if __name__ == "__main__":
    main()
