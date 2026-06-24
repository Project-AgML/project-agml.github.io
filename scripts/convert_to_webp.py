#!/usr/bin/env python3
"""
Convert PNG sample images to WebP and update JSON dataset manifests.

Usage:
    python3 scripts/convert_to_webp.py [--quality 85] [--dry-run] [--keep-originals]

Converts every .png in static/img/agml/sample_images/ to .webp at the same
dimensions, then rewrites examples_image_url in both JSON manifests so .png
paths become .webp paths.
"""

import argparse
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install Pillow")

REPO_ROOT = Path(__file__).resolve().parent.parent
IMAGES_DIR = REPO_ROOT / "static" / "img" / "agml" / "sample_images"
DATA_DIR = REPO_ROOT / "static" / "data"
MANIFESTS = [DATA_DIR / "datasets.json", DATA_DIR / "hf_datasets.json"]


def convert_one(args: tuple[Path, int]) -> tuple[str, int, int, str | None]:
    """Worker: convert a single PNG to WebP. Returns (filename, old_bytes, new_bytes, error)."""
    png_path, quality = args
    webp_path = png_path.with_suffix(".webp")
    old_size = png_path.stat().st_size
    try:
        with Image.open(png_path) as img:
            img.save(webp_path, "WEBP", quality=quality, method=6)
        return png_path.name, old_size, webp_path.stat().st_size, None
    except Exception as exc:
        if webp_path.exists():
            webp_path.unlink()
        return png_path.name, old_size, 0, str(exc)


def update_manifest(path: Path, dry_run: bool) -> int:
    """Replace .png with .webp in examples_image_url fields. Returns number of entries changed."""
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)

    changed = 0

    def patch(obj):
        nonlocal changed
        if isinstance(obj, dict):
            for key, value in obj.items():
                if key == "examples_image_url" and isinstance(value, str) and value.endswith(".png"):
                    obj[key] = value[:-4] + ".webp"
                    changed += 1
                else:
                    patch(value)
        elif isinstance(obj, list):
            for item in obj:
                patch(item)

    patch(data)

    if not dry_run and changed:
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    return changed


def main():
    parser = argparse.ArgumentParser(description="Convert PNG sample images to WebP.")
    parser.add_argument("--quality", type=int, default=85, help="WebP quality 1-100 (default 85)")
    parser.add_argument("--dry-run", action="store_true", help="Report what would happen without writing files")
    parser.add_argument("--keep-originals", action="store_true", help="Keep original PNG files after conversion")
    parser.add_argument("--workers", type=int, default=os.cpu_count(), help="Parallel worker processes")
    args = parser.parse_args()

    pngs = sorted(IMAGES_DIR.glob("*.png"))
    if not pngs:
        print(f"No PNG files found in {IMAGES_DIR}")
        return

    print(f"Found {len(pngs)} PNG files in {IMAGES_DIR.relative_to(REPO_ROOT)}")
    print(f"Quality: {args.quality}  Workers: {args.workers}  Dry-run: {args.dry_run}\n")

    if args.dry_run:
        print("[dry-run] Skipping conversion — would convert the following:")
        for png in pngs:
            print(f"  {png.name}")
        print()
    else:
        total_old = 0
        total_new = 0
        errors = []
        start = time.perf_counter()

        tasks = [(png, args.quality) for png in pngs]

        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(convert_one, task): task[0] for task in tasks}
            completed = 0
            for future in as_completed(futures):
                name, old_bytes, new_bytes, error = future.result()
                completed += 1
                if error:
                    errors.append((name, error))
                    print(f"  [{completed:>3}/{len(pngs)}] ERROR  {name}: {error}")
                else:
                    ratio = (1 - new_bytes / old_bytes) * 100 if old_bytes else 0
                    total_old += old_bytes
                    total_new += new_bytes
                    print(f"  [{completed:>3}/{len(pngs)}] {name[:-4]}.webp  {old_bytes/1e6:.1f}MB → {new_bytes/1e6:.1f}MB  (-{ratio:.0f}%)")

        elapsed = time.perf_counter() - start
        overall = (1 - total_new / total_old) * 100 if total_old else 0
        print(f"\nConverted {len(pngs) - len(errors)}/{len(pngs)} images in {elapsed:.1f}s")
        print(f"Total: {total_old/1e6:.1f} MB → {total_new/1e6:.1f} MB  (-{overall:.0f}%)")

        if not args.keep_originals:
            removed = 0
            for png in pngs:
                webp = png.with_suffix(".webp")
                if webp.exists():
                    png.unlink()
                    removed += 1
            print(f"Removed {removed} original PNG files")

        if errors:
            print(f"\n{len(errors)} conversion(s) failed:")
            for name, err in errors:
                print(f"  {name}: {err}")

    print("\nUpdating JSON manifests...")
    for manifest in MANIFESTS:
        if not manifest.exists():
            print(f"  SKIP {manifest.name} (not found)")
            continue
        changed = update_manifest(manifest, args.dry_run)
        tag = "[dry-run] would update" if args.dry_run else "Updated"
        print(f"  {tag} {manifest.name}: {changed} entries changed")

    print("\nDone.")


if __name__ == "__main__":
    main()
