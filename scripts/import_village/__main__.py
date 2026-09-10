"""CLI: build the normalized village registry from the local source files.

    python -m import_village --source "<path to 은점마을_시뮬레이터.html>"

Output goes to local-data/normalized/ which is git-ignored. The raw sources are
never copied into the repository and are never modified.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if __package__ in (None, ""):  # allow `python scripts/import_village/__main__.py`
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from import_village.extract import extract  # type: ignore
    from import_village.normalize import normalize, write  # type: ignore
else:
    from .extract import extract
    from .normalize import normalize, write

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = REPO_ROOT / "docs" / "research" / "source-manifest.json"
DEFAULT_OUT = REPO_ROOT / "local-data" / "normalized"
PRIMARY_SOURCE_NAME = "은점마을_시뮬레이터.html"


def resolve_source(explicit: str | None) -> Path:
    if explicit:
        return Path(explicit)
    manifest = json.loads(DEFAULT_MANIFEST.read_text(encoding="utf-8"))
    for entry in manifest["sources"]:
        if entry["name"] == PRIMARY_SOURCE_NAME:
            return Path(entry["localPath"])
    raise SystemExit("primary source not listed in %s" % DEFAULT_MANIFEST)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import the village registry")
    parser.add_argument("--source", help="path to the original simulator HTML")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="output directory")
    args = parser.parse_args(argv)

    source = resolve_source(args.source)
    if not source.exists():
        print("source not found: %s" % source, file=sys.stderr)
        print("the raw research data lives outside this repository; pass --source", file=sys.stderr)
        return 2

    raw, meta = extract(source)
    data = normalize(raw, [meta.as_dict()])
    target = write(Path(args.out), data, raw)

    print("wrote %s" % target)
    print("  residents          : %d" % len(data["residents"]))
    print("  road nodes / edges : %d / %d" % (
        len(data["roadGraph"]["nodes"]),
        sum(len(v) for v in data["roadGraph"]["adjacency"].values()) // 2,
    ))
    print("  road components    : %s" % data["roadGraphComponents"])
    overlay = sum(len(r["plan"]["overlay"]) for r in data["residents"])
    print("  baseline steps     : %d" % sum(len(r["plan"]["baseline"]) for r in data["residents"]))
    print("  task overlay steps : %d" % overlay)
    print("  data issues        : %s" % ", ".join(i["id"] for i in data["dataIssues"]))
    image = data.get("mapImage")
    print("  map raster         : %s" % ("%s (%d bytes)" % (image["file"], image["bytes"]) if image else "none"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
