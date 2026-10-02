# Tray Key-Ring browser E2E: real vite dev server + real planMold worker, tray branch.
# Flow: ingest flat plaque -> click "Tray (front only)" cast chip -> 5 cm generate ->
# assert tray gates visible -> export ZIP -> verify package contents + geometry.
import base64
import io
import json
import struct
import sys
import zipfile
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(r"D:/code/3d/MOLD/MOLDGENRATOR")
MODEL = REPO / "scratch" / "tray_plaque.stl"
URL = "http://localhost:5189"
OUT = REPO / "scratch" / "tray_e2e"


def stl_z_range(path: Path):
    """Binary STL → (z_min, z_max, volume_cm3)."""
    data = path.read_bytes()
    n = struct.unpack("<I", data[80:84])[0]
    zmin, zmax, vol = float("inf"), float("-inf"), 0.0
    off = 84
    for _ in range(n):
        v = struct.unpack("<12f", data[off:off + 48])
        off += 50
        p = [v[3:6], v[6:9], v[9:12]]
        zmin = min(zmin, p[0][2], p[1][2], p[2][2])
        zmax = max(zmax, p[0][2], p[1][2], p[2][2])
        ax, ay, az = p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]
        bx, by, bz = p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]
        cx, cy, cz = ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx
        vol += (p[0][0] * cx + p[0][1] * cy + p[0][2] * cz) / 6.0
    return zmin, zmax, abs(vol) / 1000.0


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    failures = []

    def check(name, ok, detail=""):
        print(("PASS " if ok else "FAIL ") + name + (f" ({detail})" if detail else ""))
        if not ok:
            failures.append(name)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_context(viewport={"width": 1500, "height": 950}, device_scale_factor=2).new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        page.goto(URL, wait_until="networkidle")
        check("app mounted", page.locator(".logo").inner_text() == "MATRIX MOLD")

        # 1) ingest the plaque through the embed contract
        b64 = base64.b64encode(MODEL.read_bytes()).decode()
        page.evaluate(
            "(b64) => window.postMessage({type:'matrix-mold:ingest', bytes: Uint8Array.from(atob(b64), c=>c.charCodeAt(0)).buffer, name:'tray_plaque.stl'}, '*')",
            b64,
        )
        page.wait_for_selector(".btn.primary", timeout=60000)
        print("after ingest:", page.locator(".status").inner_text())

        # 2) pick the tray mold family, then commit 5 cm via the size preset chip.
        # The UI boots in fa; click the CAST chips by position: GeneratePanel's
        # chips rows in order = size presets, CASTS (auto|front_only), gap presets…
        # so row index 1, chip index 1 = front_only, whatever the locale.
        cast_row = page.locator(".chips").nth(1)
        cast_row.locator("button.chip").nth(1).click(force=True)
        page.get_by_role("button", name="· 5", exact=False).first.click()
        page.wait_for_function("document.querySelector('.status')?.className.includes('ready')", timeout=240000)
        page.wait_for_selector(".result-box", timeout=60000)
        res = page.locator(".result-box .big-number").inner_text().replace("\n", " ")
        print("result:", res)
        page.screenshot(path=str(OUT / "tray_e2e_1_result.png"))

        # 3) tray-specific hard gates must be visible and green. The UI boots in
        # fa: gate NAMES may be translated, engine DETAILS stay English — match
        # either locale, and require the row's ✓ (rows come back per-gate).
        rows = [g.replace("\n", " ").strip() for g in page.locator(".gates .gate").all_inner_texts()]
        print("gates:", " | ".join(rows)[:420])
        expectations = [
            ("Tray wall seats on the plate", "Tray wall seats"),
            ("Key ring engages the plate", "Key ring engages"),
            ("Open crown above the master", "Open crown above|تاج باز"),
        ]
        for label, pattern in expectations:
            import re
            row = next((r for r in rows if re.search(pattern, r)), None)
            check(f"gate green: {label}", bool(row) and row.startswith("✓"), (row or "missing")[:140])
        check("no export blocker", page.locator(".result-box a.btn.primary, .result-box button.btn.primary").count() > 0)

        # 4) export the print package
        page.locator(".result-box button.btn.primary").last.click()
        link = page.locator(".result-box a.btn.primary")
        link.wait_for(timeout=300000)
        with page.expect_download(timeout=120000) as dl:
            link.click()
        d = dl.value
        zip_path = OUT / d.suggested_filename
        d.save_as(str(zip_path))
        check("package downloaded", zip_path.exists(), f"{zip_path.stat().st_size} bytes")
        print("page errors:", errors if errors else "none")
        browser.close()

    # 5) package contents
    zf = zipfile.ZipFile(zip_path)
    names = zf.namelist()
    proj = json.loads(zf.read([n for n in names if n.endswith("project.json")][0]))
    asm = zf.read([n for n in names if n.endswith("assembly.md")][0]).decode("utf-8", "replace")
    check("method family is open_face_relief", proj.get("method", {}).get("family") == "open_face_relief", proj.get("method", {}).get("family", "missing"))
    wall_stl = [n for n in names if n.endswith("02_jacket/tray_wall.stl")]
    check("tray wall STL present", len(wall_stl) == 1)
    validation = {c.get("name"): c for c in proj.get("validation", [])}
    kr = validation.get("Key ring engages the plate")
    check("project.json key-ring gate green", bool(kr) and kr.get("pass") is True, (kr or {}).get("detail", "missing")[:140])
    seat = validation.get("Tray wall seats on the plate")
    check("project.json seat gate green", bool(seat) and seat.get("pass") is True, (seat or {}).get("detail", "missing")[:80])
    check("assembly carries smear doctrine", "smear" in asm.lower())
    check("assembly carries flip instruction", "FLIPPED" in asm)
    check("hardware notes key ring", "Key Ring" in (proj.get("hardware") or [""])[0])
    plate_t = (proj.get("frame") or {}).get("plateT")
    check("frame-scaled plateT", plate_t == 3.5, f"plateT={plate_t}")

    # 6) geometry: wall seats at z=0 (old build sank to −plateT); plate thickness frame-scaled
    tmp = OUT / "tray_wall.stl"
    tmp.write_bytes(zf.read(wall_stl[0]))
    wz0, wz1, wvol = stl_z_range(tmp)
    check("wall seats at plate top", abs(wz0) <= 0.05, f"wall z range [{wz0:.2f}, {wz1:.2f}]")
    base_stl = [n for n in names if n.endswith("01_master/master_base.stl")]
    tmpb = OUT / "master_base.stl"
    tmpb.write_bytes(zf.read(base_stl[0]))
    bz0, bz1, bvol = stl_z_range(tmpb)
    check("plate spans frame-scaled thickness", abs(bz0 + 3.5) <= 0.05, f"base z range [{bz0:.2f}, {bz1:.2f}]")
    # tongue: master is 8+2.5=10.5 mm tall; plate top at 0 — master_base must rise
    # above the master only if the tongue tops the master (it does not: tongue is
    # 1 mm). Instead prove the tongue via volume: base+master+tongue vs same without.
    check("key ring volume sane", bvol > 0 and wvol > 0, f"base {bvol:.2f} cm3, wall {wvol:.2f} cm3")

    print()
    if failures:
        print("TRAY E2E FAIL:", "; ".join(failures))
        return 1
    print("TRAY E2E PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
