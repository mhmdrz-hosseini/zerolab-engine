# Live engine E2E: real vite dev server + real planMold worker, driven through the UI.
# kittie.stl: ingest → analysis → 5 cm generate → 20 cm regen → exploded view → export ZIP.
from pathlib import Path
import base64
import sys
from playwright.sync_api import sync_playwright

REPO = Path(r"D:/code/3d/MOLD/MOLDGENRATOR")
MODEL = Path(r"D:/code/3d/MOLD/MOLD-generator base/input/kittie.stl")
URL = "http://127.0.0.1:5189"
OUT = REPO / "scratch"

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_context(viewport={"width": 1500, "height": 950}, device_scale_factor=2).new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        page.goto(URL, wait_until="networkidle")
        assert page.locator(".logo").inner_text() == "MATRIX MOLD", "app did not mount"
        print("app mounted:", page.title() or "MATRIX MOLD @5174")

        # 1) ingest real input bytes through the embed contract
        b64 = base64.b64encode(MODEL.read_bytes()).decode()
        page.evaluate("(b64) => window.postMessage({type:'matrix-mold:ingest', bytes: Uint8Array.from(atob(b64), c=>c.charCodeAt(0)).buffer, name:'kittie.stl'}, '*')", b64)
        page.wait_for_selector(".btn.primary", timeout=60000)  # Generate button appears after analysis
        phase = page.locator(".status").inner_text()
        analysis = page.locator("aside section.panel").nth(0).inner_text().split("\n")[0]
        print("after ingest:", phase, "| analysis:", analysis)
        page.screenshot(path=str(OUT / "engine_e2e_1_ingested.png"))

        # 2) commit 5 cm via the size preset chip, which triggers the worker generate
        page.get_by_role("button", name="· 5", exact=False).first.click()
        page.wait_for_selector(".result-box", timeout=180000)
        page.wait_for_function("document.querySelector('.status')?.className.includes('ready')", timeout=180000)
        res = page.locator(".result-box .big-number").inner_text().replace("\n", " ")
        print("5cm result:", res)
        gates = page.locator(".gates .gate").all_inner_texts()
        print("gates:", " | ".join(g.replace("\n", " ") for g in gates)[:300])
        page.screenshot(path=str(OUT / "engine_e2e_2_gen_5cm.png"))

        # 3) exploded view
        page.evaluate("""() => {
            const el = document.querySelector('.stage-bar input[type=range]');
            const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            set.call(el, '40'); el.dispatchEvent(new Event('input', { bubbles: true }));
        }""")
        page.wait_for_timeout(800)
        page.screenshot(path=str(OUT / "engine_e2e_3_exploded.png"))

        # 4) regen at 20 cm via the number box (onBlur commits)
        num = page.locator("input.size-num")
        num.fill("20")
        num.blur()
        page.wait_for_function("document.querySelector('.status')?.className.includes('ready') && document.querySelector('.result-box')", timeout=240000)
        print("20cm result:", page.locator(".result-box .big-number").inner_text().replace("\n", " "))
        page.screenshot(path=str(OUT / "engine_e2e_4_gen_20cm.png"))

        # 5) export the print package: click exportPkg (worker weld+zip), then the
        #    download link the button becomes once the blob URL is ready
        page.locator(".result-box button.btn.primary").last.click()
        link = page.locator(".result-box a.btn.primary")
        link.wait_for(timeout=300000)
        with page.expect_download(timeout=120000) as dl:
            link.click()
        d = dl.value
        path = OUT / f"engine_e2e_5_{d.suggested_filename}"
        d.save_as(str(path))
        print("export:", d.suggested_filename, f"{path.stat().st_size/1e6:.1f} MB")

        print("page errors:", errors if errors else "none")
        browser.close()
        return 0 if not errors else 1

if __name__ == "__main__":
    sys.exit(main())
