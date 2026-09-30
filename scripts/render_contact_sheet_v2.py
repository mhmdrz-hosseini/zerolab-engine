# Contact-sheet renderer for OUTPUT V2 (Python playwright + repo's three.js).
# 1) serves the repo over local HTTP so the page can import three from node_modules
# 2) renders each run's PRINTED parts (master + jackets/tray wall) as one tile
# 3) composites per-size + combined contact sheets with labels
import base64
import json
import os
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(r"D:/code/3d/MOLD/MOLDGENRATOR")
OUT_ROOT = REPO / (sys.argv[1] if len(sys.argv) > 1 else "OUTPUT V2")
RENDER_DIR = OUT_ROOT / "_renders"
PORT = 8127

# stable part colors: master neutral, A/B/B1/B2 warm pair, tray teal
COLORS = {
    "master_base": 0x9AA5B1,
    "jacket_A": 0x4F8FD6,
    "jacket_B": 0xE8913A,
    "jacket_B1": 0xE8913A,
    "jacket_B2": 0xD6C24F,
    "tray_wall": 0x53B8A5,
}


def serve():
    handler = partial(SimpleHTTPRequestHandler, directory=str(REPO))
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def tile_has_content(png_path: Path) -> bool:
    """Blank-tile guard: WebGL readback can race the driver and return an
    unpresented (white) buffer — measured on long batch sessions. A real tile
    always has >0.5% non-white pixels."""
    import io
    from PIL import Image
    im = Image.open(io.BytesIO(png_path.read_bytes())).convert("L").resize((200, 150))
    px = list(im.getdata())
    return sum(1 for v in px if v < 240) / len(px) > 0.005


def main():
    manifest = json.loads((OUT_ROOT / "manifest.json").read_text(encoding="utf-8"))
    rows = manifest["rows"]
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    serve()

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 820, "height": 640}, device_scale_factor=2)
        page = ctx.new_page()
        page.goto(f"http://127.0.0.1:{PORT}/scratch/render_v2.html")
        page.wait_for_function("typeof window.renderTile === 'function'", timeout=15000)

        tiles = {}  # run -> dataURL
        for i, row in enumerate(rows):
            run = row["run"]
            ok = row["status"] == "OK"
            if ok and row["parts"]:
                items = []
                for part in row["parts"]:
                    stem = Path(part).stem
                    rel = OUT_ROOT.relative_to(REPO).as_posix()
                    items.append({"url": f"/{rel}/{part}", "color": COLORS.get(stem)})
                try:
                    png = RENDER_DIR / f"{run}.png"
                    for attempt in range(3):
                        page.evaluate("(items) => window.renderTile(items)", items)
                        page.locator("#tileCanvas").screenshot(path=str(png))
                        if tile_has_content(png):
                            break
                        print(f"[{i+1}/{len(rows)}] blank tile {run} (attempt {attempt+1}) — re-rendering")
                    tiles[run] = "data:image/png;base64," + base64.b64encode(png.read_bytes()).decode()
                    print(f"[{i+1}/{len(rows)}] tile {run}")
                except Exception as e:  # rendering must never kill the sheet
                    print(f"[{i+1}/{len(rows)}] TILE-FAIL {run}: {e}")
            else:
                print(f"[{i+1}/{len(rows)}] skip {run} ({row['status']})")

        def card(row):
            return {
                "img": tiles.get(row["run"]),
                "name": row["model"],
                "sizeLabel": "50 mm" if "small" in row["size"] else "200 mm",
                "meta": f"{row['family']} · {row['panels']}pc · ±{row['axis']} · {row['ml']} mL" if row["status"] == "OK" else "",
                "ok": row["status"] == "OK",
                "failReason": row["status"] if row["status"] != "OK" else None,
            }

        ok_n = sum(1 for r in rows if r["status"] == "OK")
        import datetime
        stamp = datetime.date.today().isoformat()
        title = "OUTPUT V2 — new planMold pipeline"
        sub = f"20 input models · small 50 mm + extra-big 200 mm · {ok_n}/{len(rows)} runs OK · {stamp}"

        def shoot(rows_subset, name, extra_sub=""):
            page.evaluate("(x) => window.buildSheet(x.items, x.title, x.sub)", {
                "items": [card(r) for r in rows_subset],
                "title": title,
                "sub": (sub + extra_sub),
            })
            page.set_viewport_size({"width": 1720, "height": 1200})
            page.screenshot(path=str(OUT_ROOT / name), full_page=True)
            print("sheet →", name)

        small = [r for r in rows if "small" in r["size"]]
        big = [r for r in rows if "big" in r["size"]]
        shoot(small, "CONTACT_SHEET_small_50mm.png", " · small set")
        shoot(big, "CONTACT_SHEET_big_200mm.png", " · extra-big set")
        shoot(rows, "CONTACT_SHEET_ALL.png")
        browser.close()


if __name__ == "__main__":
    sys.exit(main())
