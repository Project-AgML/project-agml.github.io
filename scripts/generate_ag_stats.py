#!/usr/bin/env python3
"""
Build the JSON files behind the Ag Stats page (src/pages/ag-stats) from the
`agml.ag_stats` loaders.

Writes three files to static/data/ag_stats/:

- catalog.json: every table and layer of every source, with coverage numbers,
  columns, and a code snippet. Powers the filterable catalog.
- nass_yield.json: national and state yield series of the main NASS crops.
  Powers the NASS yield trend chart.
- cali_yield.json: every county, crop, and year of the California Crop Yield
  Benchmark yield table. Powers the California yield trend chart.

The page only reads these files, so this script is run by hand when a source
changes, not on every build. It needs the AgML package with the `ag_stats`
extras (pandas, pyarrow, huggingface_hub, rasterio, xarray).

Usage:
    python3 scripts/generate_ag_stats.py
    python3 scripts/generate_ag_stats.py --nass-root /path/to/nass-usda-full-data

`--nass-root` (or the AGML_NASS_PATH environment variable) reads a local copy
of the NASS dataset. Without it, the NASS tables are downloaded from the
Hugging Face Hub (about 170 MB). The California tables always come from the Hub.
"""

import argparse
import json
import os
from datetime import date
from pathlib import Path

import pyarrow.dataset as ds
import pyarrow.parquet as pq

from agml.ag_stats import calicropyield, nass

OUT_DIR = Path(__file__).resolve().parent.parent / "static" / "data" / "ag_stats"

NASS_LEVELS = {
    "NATIONAL": "National",
    "STATE": "State",
    "AGRICULTURAL DISTRICT": "District",
    "COUNTY": "County",
}

# What each NASS table is for and how to call it. Coverage numbers are read from the data.
NASS_TABLES = {
    "yield": {
        "title": "Crop yield",
        "time_step": "Annual",
        "method": "load_yield",
        "snippet": 'nass.load_yield(crop="corn", utilization="grain", state="IA",\n'
        '                county="Story", years=(2000, 2024))',
    },
    "county_yield": {
        "title": "County yield (main crops)",
        "time_step": "Annual",
        "method": "load_county_yield",
        "snippet": 'nass.load_county_yield(crop="soybeans", state="IL", years=(2010, 2024))',
    },
    "area_production": {
        "title": "Area and production",
        "time_step": "Annual",
        "method": "load_area_production",
        "snippet": 'nass.load_area_production(crop="wheat", state="KS",\n'
        '                           statistic="area_harvested", level="county")',
    },
    "census": {
        "title": "Census of Agriculture",
        "time_step": "Every 5 years",
        "method": "load_census",
        "snippet": 'nass.load_census(crop="tomatoes", state="CA", statistic="production")',
    },
    "forecast": {
        "title": "In-season yield forecast",
        "time_step": "Monthly (in season)",
        "method": "load_forecast",
        "snippet": 'nass.load_forecast(crop="corn", state="IA", years=2024)',
    },
    "progress": {
        "title": "Crop progress",
        "time_step": "Weekly",
        "method": "load_progress",
        "snippet": 'nass.load_progress(crop="soybeans", state="IL", years=2023, stage="planted")',
    },
    "condition": {
        "title": "Crop condition (wide)",
        "time_step": "Weekly",
        "method": "load_condition",
        "snippet": 'nass.load_condition(crop="corn", state="NE", years=(2020, 2024))',
    },
    "condition_long": {
        "title": "Crop condition (long)",
        "time_step": "Weekly",
        "method": "load_condition",
        "snippet": 'nass.load_condition(crop="corn", state="NE", years=2024, long=True)',
    },
}

# The NASS crops shown in the yield trend chart: (commodity, class, utilization).
NASS_TREND_CROPS = [
    ("CORN", "ALL CLASSES", "GRAIN"),
    ("SOYBEANS", "ALL CLASSES", "ALL UTILIZATION PRACTICES"),
    ("WHEAT", "ALL CLASSES", "ALL UTILIZATION PRACTICES"),
    ("WHEAT", "WINTER", "ALL UTILIZATION PRACTICES"),
    ("COTTON", "ALL CLASSES", "ALL UTILIZATION PRACTICES"),
    ("RICE", "ALL CLASSES", "ALL UTILIZATION PRACTICES"),
    ("SORGHUM", "ALL CLASSES", "GRAIN"),
    ("BARLEY", "ALL CLASSES", "ALL UTILIZATION PRACTICES"),
    ("OATS", "ALL CLASSES", "ALL UTILIZATION PRACTICES"),
    ("PEANUTS", "ALL CLASSES", "ALL UTILIZATION PRACTICES"),
    ("POTATOES", "ALL CLASSES", "ALL UTILIZATION PRACTICES"),
    ("SUGARBEETS", "ALL CLASSES", "ALL UTILIZATION PRACTICES"),
    ("HAY", "ALL CLASSES", "ALL UTILIZATION PRACTICES"),
    ("SUNFLOWER", "ALL CLASSES", "ALL UTILIZATION PRACTICES"),
]

# Spatial and temporal resolution of each California layer.
CALI_LAYERS = {
    "cdl": ("Cropland Data Layer", "30 m", "Raster (GeoTIFF)", "load_cdl", 'cali.load_cdl("Yolo", 2020, crops="Tomatoes")'),
    "landsat": ("Landsat reflectance", "30 m", "Raster (GeoTIFF)", "load_landsat", 'cali.load_landsat("Yolo", 2020, months=[6, 7, 8])'),
    "et": ("OpenET evapotranspiration", "30 m", "Raster (GeoTIFF)", "load_et", 'cali.load_et("Fresno", 2021, months=range(4, 10))'),
    "irrigation": ("Irrigated land (IrrMapper)", "30 m", "Raster (GeoTIFF)", "load_irrigation", 'cali.load_irrigation("Kern", 2019)'),
    "climate": ("DayMet weather", "1 km", "Zarr", "load_climate", 'cali.load_climate("Yolo", years=(2018, 2020), monthly=True)'),
    "soil": ("Soil attributes (gNATSGO)", "30 m", "Zarr", "load_soil", 'cali.load_soil("Yolo", variables=["nccpi3all", "aws0100wta"])'),
}


def year_span(years):
    years = sorted(int(y) for y in years)
    return [years[0], years[-1]]


def missing_years(years):
    years = sorted(set(int(y) for y in years))
    return [y for y in range(years[0], years[-1] + 1) if y not in years]


def schema_columns(schema):
    return [{"name": field.name, "type": str(field.type)} for field in schema]


def nass_entries(loader):
    entries = []
    for name, info in NASS_TABLES.items():
        spec = nass.TABLES[name]
        dataset = loader._dataset(name)
        wanted = ["commodity", spec.year_column]
        if spec.has_agg_level:
            wanted.append("agg_level")
        table = dataset.to_table(columns=wanted).to_pandas()
        years = table[spec.year_column].dropna().unique()
        levels = (
            [NASS_LEVELS[level] for level in NASS_LEVELS if level in set(table["agg_level"].unique())]
            if spec.has_agg_level
            else ["County"]
        )
        entries.append(
            {
                "id": f"nass.{name}",
                "source": "nass",
                "name": name,
                "title": info["title"],
                "kind": "Table",
                "format": "Parquet",
                "description": spec.description,
                "spatial_levels": levels,
                "resolution": None,
                "time_step": info["time_step"],
                "years": year_span(years),
                "missing_years": [],
                "rows": int(dataset.count_rows()),
                "files": None,
                "crops": int(table["commodity"].nunique()),
                "columns": schema_columns(dataset.schema),
                "method": f"nass.{info['method']}()",
                "snippet": info["snippet"],
            }
        )

    for level in ("county", "state"):
        path = loader._file("boundaries", nass.loader._BOUNDARY_FILES[(level, False)])
        schema = pq.read_schema(path)
        entries.append(
            {
                "id": f"nass.boundaries_{level}",
                "source": "nass",
                "name": f"boundaries ({level})",
                "title": f"{level.title()} boundaries",
                "kind": "Table",
                "format": "Parquet (WKB geometry)",
                "description": f"2020 Census {level} polygons with FIPS code, names, area, and centroid.",
                "spatial_levels": [level.title()],
                "resolution": None,
                "time_step": "Static",
                "years": [2020, 2020],
                "missing_years": [],
                "rows": int(pq.ParquetFile(path).metadata.num_rows),
                "files": None,
                "crops": None,
                "columns": schema_columns(schema) + [{"name": "geometry", "type": "binary (WKB)"}],
                "method": "nass.load_boundaries()",
                "snippet": f'nass.load_boundaries(level="{level}")',
            }
        )
    return entries


def cali_entries(loader, yield_df, detail_df):
    counties = len(calicropyield.COUNTIES)
    entries = []
    for name, (title, resolution, fmt, method, snippet) in CALI_LAYERS.items():
        spec = calicropyield.LAYERS[name]
        years = list(spec.years)
        files = counties * len(years) * (12 if spec.monthly else 1)
        entries.append(
            {
                "id": f"calicropyield.{name}",
                "source": "calicropyield",
                "name": name,
                "title": title,
                "kind": "Zarr" if spec.zarr else "Raster",
                "format": fmt,
                "description": spec.description,
                "spatial_levels": ["Pixel"],
                "resolution": resolution,
                "time_step": "Daily" if name == "climate" else "Monthly" if spec.monthly else "Static" if name == "soil" else "Annual",
                "years": year_span(years),
                "missing_years": missing_years(years),
                "rows": None,
                "files": files,
                "crops": len({v for v in calicropyield.CDL_CLASSES.values()} - calicropyield.catalog.NON_CROP_CLASSES)
                if name == "cdl"
                else None,
                "columns": [],
                "method": f"cali.{method}()",
                "snippet": snippet,
            }
        )

    for detail, df in ((False, yield_df), (True, detail_df)):
        year_col, crop_col = ("Year", "Crop_Name_Clean") if detail else ("year", "crop")
        entries.append(
            {
                "id": f"calicropyield.yield{'_detail' if detail else ''}",
                "source": "calicropyield",
                "name": "yield_detail" if detail else "yield",
                "title": "County yield (report rows)" if detail else "County crop yield",
                "kind": "Table",
                "format": "Parquet",
                "description": (
                    "Per-commodity rows of the county agricultural commissioner reports, with "
                    "harvested area, production, price, and value."
                    if detail
                    else "One row per county, crop group, and year, with yield in t/ha."
                ),
                "spatial_levels": ["County"],
                "resolution": None,
                "time_step": "Annual",
                "years": year_span(df[year_col].unique()),
                "missing_years": missing_years(df[year_col].unique()),
                "rows": int(len(df)),
                "files": None,
                "crops": int(df[crop_col].nunique()),
                "columns": [{"name": c, "type": str(t)} for c, t in df.dtypes.items()],
                "method": "cali.load_yield()",
                "snippet": 'cali.load_yield(county="Fresno", crop="Tomatoes Processing",\n'
                "                detail=True)"
                if detail
                else 'cali.load_yield(county="Yolo", crop="tomatoes", years=(2015, 2020))',
            }
        )
    return entries


def nass_trend(loader):
    dim = loader.catalog.crops()
    crop_ids, labels, queries = [], {}, {}
    for commodity, crop_class, utilization in NASS_TREND_CROPS:
        rows = dim[
            (dim["commodity"] == commodity)
            & (dim["class"] == crop_class)
            & (dim["utilization"] == utilization)
            & (dim["practice"] == "ALL PRODUCTION PRACTICES")
        ]
        if rows.empty:
            raise ValueError(f"No NASS crop for {commodity} / {crop_class} / {utilization}.")
        crop_id = rows["crop_id"].iloc[0]
        crop_ids.append(crop_id)
        label = commodity.title()
        if crop_class != "ALL CLASSES":
            label += f", {crop_class.title()}"
        if utilization != "ALL UTILIZATION PRACTICES":
            label += f" ({utilization.lower()})"
        labels[crop_id] = label
        # The loader arguments that select exactly this series, shown in the page's code snippet.
        query = [f'crop="{commodity.lower()}"']
        if crop_class != "ALL CLASSES":
            query.append(f'crop_class="{crop_class.lower()}"')
        if utilization != "ALL UTILIZATION PRACTICES":
            query.append(f'utilization="{utilization.lower()}"')
        query.append('practice="all production practices"')
        queries[crop_id] = ", ".join(query)

    df = loader.query(
        "yield",
        crop=crop_ids,
        columns=["crop_id", "unit", "agg_level", "state_alpha", "year", "value", "value_t_ha"],
    )
    df = df[df["agg_level"].isin(["NATIONAL", "STATE"])].dropna(subset=["value"])
    states = loader.catalog._dims["state"].set_index("state_alpha")["state_name"].to_dict()

    crops = []
    for crop_id in crop_ids:
        sub = df[df["crop_id"] == crop_id].sort_values("year")
        series = {}
        for (level, state), group in sub.groupby(["agg_level", "state_alpha"], dropna=False):
            key = "US" if level == "NATIONAL" else state
            series[key] = [
                [int(r.year), round(float(r.value), 2), None if r.value_t_ha != r.value_t_ha else round(float(r.value_t_ha), 3)]
                for r in group.itertuples()
            ]
        crops.append(
            {
                "id": crop_id,
                "label": labels[crop_id],
                "query": queries[crop_id],
                "unit": sub["unit"].iloc[0],
                "series": dict(sorted(series.items(), key=lambda kv: (kv[0] != "US", kv[0]))),
            }
        )
    return {
        "generated": date.today().isoformat(),
        "states": {alpha: str(name).title() for alpha, name in states.items()},
        "crops": crops,
    }


def cali_trend(yield_df):
    counties = sorted(yield_df["county"].unique())
    crops = sorted(yield_df["crop"].unique())
    county_index = {c: i for i, c in enumerate(counties)}
    crop_index = {c: i for i, c in enumerate(crops)}
    rows = [
        [county_index[r.county], crop_index[r.crop], int(r.year), round(float(r.yield_t_per_ha), 3)]
        for r in yield_df.dropna(subset=["yield_t_per_ha"]).itertuples()
    ]
    return {"generated": date.today().isoformat(), "counties": counties, "crops": crops, "rows": rows}


def write(name, payload):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / name
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
        f.write("\n")
    print(f"wrote {path} ({path.stat().st_size / 1024:.0f} KB)")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--nass-root", default=os.environ.get("AGML_NASS_PATH"), help="local copy of the NASS dataset")
    args = parser.parse_args()

    nass_loader = nass.NASSDataLoader(args.nass_root)
    cali_loader = calicropyield.CaliCropYieldLoader()
    yield_df = cali_loader.load_yield()
    detail_df = cali_loader.load_yield(detail=True)

    nass_items = nass_entries(nass_loader)
    cali_items = cali_entries(cali_loader, yield_df, detail_df)
    nass_dims = nass_loader.catalog._dims

    catalog = {
        "generated": date.today().isoformat(),
        "sources": [
            {
                "id": "nass",
                "name": "USDA NASS Crop Statistics",
                "module": "agml.ag_stats.nass",
                "loader": "NASSDataLoader",
                "install": "pip install agml[ag_stats]",
                "hf_repo": nass.DEFAULT_REPO_ID,
                "region": "United States",
                "license": "CC0 1.0",
                "paper": None,
                "viewer": None,
                "description": (
                    "Yield, area, production, census, forecasts, crop progress, and crop condition "
                    "from the USDA NASS Quick Stats database, at national, state, district, and "
                    "county level."
                ),
                "years": [min(e["years"][0] for e in nass_items), max(e["years"][1] for e in nass_items)],
                "rows": sum(e["rows"] for e in nass_items if not e["name"].startswith("boundaries")),
                "crops": int(nass_dims["crop"]["commodity"].nunique()),
                "places": {"states": int(len(nass_dims["state"])), "counties": int(len(nass_dims["county"]))},
                "items": len(nass_items),
            },
            {
                "id": "calicropyield",
                "name": "California Crop Yield Benchmark",
                "module": "agml.ag_stats.calicropyield",
                "loader": "CaliCropYieldLoader",
                "install": "pip install agml[calicropyield]",
                "hf_repo": calicropyield.DEFAULT_REPO_ID,
                "region": "California",
                "license": "BSD 3-Clause",
                "paper": "https://arxiv.org/abs/2506.10228",
                "viewer": "https://hkaman7.github.io/calicropyield-viewer/",
                "description": (
                    "County crop yield for California, paired with Cropland Data Layer, Landsat, "
                    "OpenET, irrigation, DayMet climate, and soil layers for every county."
                ),
                "years": [min(e["years"][0] for e in cali_items), max(e["years"][1] for e in cali_items)],
                "rows": int(len(yield_df)),
                "crops": int(yield_df["crop"].nunique()),
                "places": {"counties": len(calicropyield.COUNTIES)},
                "items": len(cali_items),
            },
        ],
        "entries": nass_items + cali_items,
    }
    write("catalog.json", catalog)
    write("nass_yield.json", nass_trend(nass_loader))
    write("cali_yield.json", cali_trend(yield_df))


if __name__ == "__main__":
    main()
