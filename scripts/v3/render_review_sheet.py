# Review renderer for OUTPUT/v3 runs (Python Playwright + the worktree's
# three.js). For each case it draws two measured tiles:
#   (a) the PRINTED parts — master_base + jackets / tray wall
#   (b) master_base with the silicone skin translucent — shows the cavity,
#       hole posts and any unexpected silicone material
# and composites one annotated review sheet. Saves every tile PNG under
# <run>/_renders/ as evidence for the non-automated visual review.
import base64
import io
import json
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
RUN_ID = sys.argv[1] if len(sys.argv) > 1 else "pilot-three-final"
OUT_ROOT = REPO / "OUTPUT/v3" / RUN_ID
RENDER_DIR = OUT_ROOT / "_renders"
PORT = 8131
CASES = ["montagem-50", "montagem-200", "cap-50", "cap-200", "koerper-50", "koerper-200"]

COLORS = {
    "master_base": 0x9AA5B1,
    "jacket_A": 0x4F8FD6,
    "jacket_B": 0xE8913A,
    "jacket_B1": 0xE8913A,
    "jacket_B2": 0xD6C24F,
    "tray_wall": 0x53B8A5,
    "silicone_skin": 0xE0738A,
}


def serve():
    handler = partial(SimpleHTTPRequestHandler, directory=str(REPO))
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def tile_has_content(png_path: Path) -> bool:
    from PIL import Image
    im = Image.open(io.BytesIO(png_path.read_bytes())).convert("L").resize((200, 150))
    px = list(im.getdata())
    return sum(1 for v in px if v < 240) / len(px) > 0.005


def main():
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    serve()
    cards = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 820, "height": 640}, device_scale_factor=2)
        page = ctx.new_page()
        page.goto(f"http://127.0.0.1:{PORT}/scratch/render_v3.html")
        page.wait_for_function("typeof window.renderTile === 'function'", timeout=15000)

        def shoot(items, name):
            png = RENDER_DIR / name
            for attempt in range(3):
                page.evaluate("(items) => window.renderTile(items)", items)
                page.locator("#tileCanvas").screenshot(path=str(png))
                if tile_has_content(png):
                    return "data:image/png;base64," + base64.b64encode(png.read_bytes()).decode()
                print(f"blank tile {name} (attempt {attempt + 1}) — re-rendering")
            raise RuntimeError(f"tile {name} stayed blank")

        for case in CASES:
            attempts = sorted((OUT_ROOT / case).glob("attempt-*"))
            if not attempts:
                cards.append({"img": None, "name": case, "meta": "", "ok": False, "failReason": "no attempt"})
                continue
            att = attempts[-1]
            projects = list(att.rglob("project.json"))
            if not projects:
                cards.append({"img": None, "name": case, "meta": "", "ok": False, "failReason": "no project"})
                continue
            pkg = projects[0].parent
            rel = pkg.relative_to(REPO).as_posix()
            proj = json.loads(projects[0].read_text(encoding="utf-8"))
            url = lambda f: f"/{rel}/{f}"
            printed = [f for f in ["01_master/master_base.stl", "02_jacket/jacket_A.stl",
                                   "02_jacket/jacket_B.stl", "02_jacket/tray_wall.stl"]
                       if (pkg / f).exists()]
            items_printed = [{"url": url(f), "color": COLORS[Path(f).stem]} for f in printed]
            items_skin = [
                {"url": url("01_master/master_base.stl"), "color": COLORS["master_base"]},
                {"url": url("03_preview/silicone_skin.stl"), "color": COLORS["silicone_skin"], "opacity": 0.42},
            ]
            try:
                img_print = shoot(items_printed, f"{case}_printed.png")
                img_skin = shoot(items_skin, f"{case}_skin.png")
                fam = proj["method"]["family"]
                ml = proj["siliconeMl"]
                rep = proj.get("topologyRepair")
                meta = f"{fam} · {ml} mL" + (f" · skin repair {rep['toleranceMm']} mm" if rep and rep.get("applied") else "")
                cards.append({"img": img_print, "img2": img_skin, "name": case, "meta": meta,
                              "ok": all(a["verdict"] == "valid" for a in proj["finalFileAudit"].values()),
                              "failReason": None})
                print(f"tile {case}")
            except Exception as e:
                cards.append({"img": None, "name": case, "meta": "", "ok": False, "failReason": str(e)[:60]})

        page.evaluate("""(cards) => {
          document.getElementById('tileWrap').style.display = 'none';
          const sheet = document.getElementById('sheet');
          sheet.style.display = 'block';
          sheet.innerHTML = `<h1></h1><div class="sub"></div><div class="grid"></div>`;
          sheet.querySelector('h1').textContent = 'V3 pilot-three-final — visual review';
          sheet.querySelector('.sub').textContent = 'left tile: printed parts · right tile: master + translucent silicone skin · 6 required cases';
          const grid = sheet.querySelector('.grid');
          for (const it of cards) {
            const card = document.createElement('div');
            card.className = 'card' + (it.ok ? '' : ' fail');
            const shot = it.img
              ? `<img src="${it.img}"><img src="${it.img2}">`
              : `<div class="ph">✗ ${it.failReason ?? 'no output'}</div>`;
            card.innerHTML = `${shot}<div class="lbl"><div class="name">${it.name}</div>
              <div class="meta"><span class="badge ${it.ok ? 'ok' : 'fail'}">${it.ok ? 'VALID' : 'FAIL'}</span> ${it.meta}</div></div>`;
            grid.appendChild(card);
          }
          return true;
        }""", cards)
        page.set_viewport_size({"width": 1720, "height": 1400})
        page.screenshot(path=str(OUT_ROOT / "REVIEW_SHEET.png"), full_page=True)
        print("sheet →", OUT_ROOT / "REVIEW_SHEET.png")
        browser.close()


if __name__ == "__main__":
    sys.exit(main())
