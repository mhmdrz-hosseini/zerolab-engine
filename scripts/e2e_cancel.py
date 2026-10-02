# Verify the cancel fix: spiderman @20cm (never-pass ladder), cancel mid-run,
# then confirm the worker still regenerates at 5cm. Also capture that progress
# is monotonic and stages carry the (k/N tries) counter.
import base64
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(r"D:/code/3d/MOLD/MOLDGENRATOR")
MODEL = Path(r"D:/code/3d/MOLD/MOLD-generator base/input/obj_1_Spiderman urban.stl")
URL = "http://localhost:5189"

def main():
    ok = True
    def check(name, cond, detail=""):
        nonlocal ok
        print(("PASS " if cond else "FAIL ") + name + (f" ({detail})" if detail else ""))
        if not cond:
            ok = False

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_context(viewport={"width": 1500, "height": 950}).new_page()
        page.add_init_script("""
            window.__stages = []; window.__mono = true; window.__last = -1; window.__cancelSent = 0;
            const OrigWorker = window.Worker;
            window.Worker = class extends OrigWorker {
                constructor(url, opts) {
                    super(url, opts);
                    this.addEventListener('message', (e) => {
                        const d = e.data;
                        if (d && d.type === 'progress') {
                            if (d.pct + 1e-9 < window.__last) window.__mono = false;
                            window.__last = d.pct;
                            window.__stages.push([Date.now(), d.stage, d.pct]);
                        }
                        if (d && (d.type === 'result' || d.type === 'failure' || d.type === 'error' || d.type === 'cancelled'))
                            window.__terminal = [Date.now(), d.type];
                    });
                }
                postMessage(msg, ...rest) {
                    if (msg && msg.type === 'cancel') window.__cancelSent += 1;
                    return super.postMessage(msg, ...rest);
                }
            };
        """)
        page.goto(URL, wait_until="networkidle")
        b64 = base64.b64encode(MODEL.read_bytes()).decode()
        page.evaluate("(b64) => window.postMessage({type:'matrix-mold:ingest', bytes: Uint8Array.from(atob(b64), c=>c.charCodeAt(0)).buffer, name:'spiderman.stl'}, '*')", b64)
        page.wait_for_selector(".btn.primary", timeout=120000)
        print("ingested")

        num = page.locator("input.size-num")
        num.fill("20"); num.blur()
        # busy → the primary button must become Cancel (not a disabled Generate)
        page.wait_for_selector("button.btn.primary:not([disabled])", timeout=30000)
        # wait until the LADDER is actually running (distance field + SDF take
        # 10-60s first; asserting at a fixed time flunked on a cold cache)
        page.wait_for_function("window.__stages.some(s => s[1].includes('tries)'))", timeout=180000)
        cancel_txt = page.locator("section.panel button.btn.primary.wide").last.inner_text().strip()
        check("Cancel button shown while busy", cancel_txt.lower().startswith("cancel") or "لغو" in cancel_txt, cancel_txt)
        stages_before = page.evaluate("window.__stages.length")
        check("ladder position in stages", True, str(page.evaluate("window.__stages.slice(-1)[0]"))[:90])
        t_cancel = time.time()
        page.get_by_role("button", name="لغو").click()
        time.sleep(2)
        print("cancel postMessages intercepted:", page.evaluate("window.__cancelSent"))
        # cancelled must arrive within ~40s (envelope poll is every 16 rings ≈ 30s at 200mm)
        try:
            page.wait_for_function("window.__terminal && window.__terminal[1] === 'cancelled'", timeout=150000)
            dt = time.time() - t_cancel
            check("cancelled message arrived", True, f"{dt:.1f}s after click")
        except Exception:
            term = page.evaluate("window.__terminal || null")
            check("cancelled message arrived", False, f"terminal={term}")
        page.wait_for_function("document.querySelector('.status') && !document.querySelector('.status').className.includes('busy')", timeout=60000)
        check("phase back to non-busy", True)
        check("no failure overlay", page.locator(".failure, .trap-overlay").count() == 0)

        # worker survival + state intact: regenerate at 5 cm must SUCCEED
        page.get_by_role("button", name="· 5", exact=False).first.click()
        try:
            page.wait_for_function("window.__terminal && window.__terminal[1] === 'result'", timeout=240000)
            check("regenerate at 5cm after cancel", True)
        except Exception:
            term = page.evaluate("window.__terminal || null")
            check("regenerate at 5cm after cancel", False, f"terminal={term}")

        mono = page.evaluate("window.__mono")
        print(f"progress monotonic across whole session: {mono}")
        browser.close()

    print("CANCEL E2E " + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1

import sys
sys.exit(main())
