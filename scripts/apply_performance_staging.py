#!/usr/bin/env python3
"""Appends run records from performance_staging/*.json into the matching
static/data/performance/<dataset>.json files. Staging files are left in
place (not cleared) after merging. Run the start command afterward to
regenerate the index.json/global.json leaderboard manifests.

Usage: python3 scripts/apply_performance_staging.py [--dry-run]
"""

import json
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent
staging_dir = project_root / 'performance_staging'
performance_dir = project_root / 'static' / 'data' / 'performance'
dry_run = '--dry-run' in sys.argv[1:]


def read_json_array(file_path):
    if not file_path.exists():
        return []
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError(f'Expected a JSON array in {file_path}')
    return data


def write_json_array(file_path, records):
    file_path.parent.mkdir(parents=True, exist_ok=True)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(json.dumps(records, indent=2) + '\n')


def main():
    if not staging_dir.exists():
        print('No performance_staging directory found, nothing to do.')
        return

    staging_files = sorted(f.name for f in staging_dir.iterdir() if f.suffix == '.json')
    if not staging_files:
        print('performance_staging is empty, nothing to do.')
        return

    for file in staging_files:
        staging_path = staging_dir / file
        target_path = performance_dir / file

        new_records = read_json_array(staging_path)
        existing_records = read_json_array(target_path)
        merged = existing_records + new_records

        print(
            f'{file}: {len(existing_records)} existing + {len(new_records)} staged = {len(merged)} total'
        )

        if not dry_run:
            write_json_array(target_path, merged)

    if dry_run:
        print('\nDry run - no files were changed.')
        return

    print('\nDone.')


if __name__ == '__main__':
    main()
