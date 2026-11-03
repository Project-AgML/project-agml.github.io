"""Extract iNatAg species -> (family, common-name search terms) for the taxonomy explorer.

The site's datasets.json lists iNatAg's 2,958 species only as child dataset names
("iNatAg/zea_mays"), without family information. The AgML library's asset manifest carries
`extra_metadata.family_name` and `common_name` for each one; this script distills that into
static/data/taxonomy/inatag_taxa.json, which /datasets/explore uses to place iNatAg in the
family -> genus -> species tree.

Usage:
    python scripts/extract_inatag_taxa.py ../AgML/agml/_assets/iNatAg_public_datasources.json
"""

import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "static" / "data" / "taxonomy" / "inatag_taxa.json"


def main(source: str) -> None:
    records = json.loads(Path(source).read_text())

    # A handful of species carry family "Unknown"; borrow the family from a sibling species in the
    # same genus when one has it.
    genus_family: dict[str, str] = {}
    for name, record in records.items():
        family = (record.get("extra_metadata") or {}).get("family_name")
        if family and family != "Unknown":
            genus_family.setdefault(name.split("/")[-1].split("_")[0], family)

    out: dict[str, list[str]] = {}
    for name, record in sorted(records.items()):
        slug = name.split("/")[-1]
        meta = record.get("extra_metadata") or {}
        family = meta.get("family_name")
        if not family or family == "Unknown":
            family = genus_family.get(slug.split("_")[0], "Unknown")
        # Common names come in many languages with no language tag, so they're kept only as search
        # terms (first few), never displayed.
        common_names = [n for n in (meta.get("common_name") or []) if isinstance(n, str) and n.strip()]
        out[slug] = [family, "; ".join(common_names[:4])]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "{\n" + ",\n".join(f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}" for k, v in out.items()) + "\n}\n"
    )
    print(f"wrote {len(out)} species to {OUT}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
