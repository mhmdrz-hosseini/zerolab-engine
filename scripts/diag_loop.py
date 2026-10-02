# Diagnose the "infinite loop" report: ingest a known never-passes model
# (Spider-Man) at 16 cm in the real browser, record EVERY progress stage with
# timestamps for up to N minutes, then report the timeline + final phase.
# Also probes the dead-worker hypothesis: after the run settles, re-ingest a
# small file and see if the worker still responds.
import base64
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(r"D:/code/3d/MOLD/MOLDGENRATOR")
MODEL = Path(r"D:/code/3d/MOLD/MOLD-generator base/input/obj_1_Spiderman urban.stl")
URL = "http://localhost:5189"
OUT = REPO / "scratch" / "loop_diag"
WATCH_MIN = float(sys.argv[1]) if len(sys.argv) > 1 else 10.0

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_context(viewport={"width": 1500, "height": 950}).new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        # intercept worker progress messages with timestamps (must be registered
        # BEFORE goto — init scripts only run on future navigations)
        page.add_init_script("""
            window.__stages = [];
            const OrigWorker = window.Worker;
            window.Worker = class extends OrigWorker {
                constructor(url, opts) {
                    super(url, opts);
                    this.addEventListener('message', (e) => {
                        const d = e.data;
                        if (d && d.type === 'progress') window.__stages.push([Date.now(), d.stage, d.pct]);
                        if (d && (d.type === 'result' || d.type === 'failure' || d.type === 'error'))
                            window.__terminal = [Date.now(), d.type, (d.message || '').slice(0, 300)];
                    });
                }
            };
        """)
        page.goto(URL, wait_until="networkidle")
        t0 = time.time()
        b64 = base64.b64encode(MODEL.read_bytes()).decode()
        page.evaluate(
            "(b64) => window.postMessage({type:'matrix-mold:ingest', bytes: Uint8Array.from(atob(b64), c=>c.charCodeAt(0)).buffer, name:'spiderman.stl'}, '*')",
            b64,
        )
        page.wait_for_selector(".btn.primary", timeout=120000)
        print(f"[{time.time()-t0:7.1f}s] ingested, analysis shown")

        # 16 cm preset = the max preset chip (last size preset row chip)
        page.locator(".chips").nth(0).locator("button.chip").last.click()
        print(f"[{time.time()-t0:7.1f}s] 16 cm generate clicked")

        deadline = time.time() + WATCH_MIN * 60
        last_count = -1
        while time.time() < deadline:
            stages = page.evaluate("window.__stages")
            term = page.evaluate("window.__terminal || null")
            if term:
                print(f"[{time.time()-t0:7.1f}s] TERMINAL: {term[1]} — {term[2]}")
                break
            if len(stages) != last_count:
                last_count = len(stages)
                # show only stage CHANGES with gaps > 2s highlighted
                page.evaluate(f"window.__mark = {last_count}")
            time.sleep(5)
            phase_txt = page.locator(".status").inner_text() if page.locator(".status").count() else "?"
            print(f"[{time.time()-t0:7.1f}s] stage #{last_count}: {stages[-1][1][:70] if stages else '—'} | pct {stages[-1][2] if stages else '—'} | ui {phase_txt}")
        else:
            print(f"[{time.time()-t0:7.1f}s] WATCH WINDOW ENDED — no terminal message yet")

        stages = page.evaluate("window.__stages")
        # timeline: compress consecutive repeats
        prev = None
        print("\n--- stage timeline (unique transitions) ---")
        t0ms = stages[0][0] if stages else 0
        for ts, stage, pct in stages:
            key = stage
            if key != prev:
                print(f"  +{(ts-t0ms)/1000:7.1f}s  {stage[:90]}")
                prev = key
        repeats = {}
        for ts, stage, pct in stages:
            repeats[stage] = repeats.get(stage, 0) + 1
        top = sorted(repeats.items(), key=lambda kv: -kv[1])[:8]
        print("--- most-repeated stages ---")
        for s, n in top:
            print(f"  {n:4d}×  {s[:80]}")
        if errors:
            print("--- browser errors/warnings (first 10) ---")
            for e in errors[:10]:
                print("  ", e[:200])

        # dead-worker probe: re-ingest a tiny file — does analysis come back?
        tiny = REPO / "scratch" / "tray_plaque.stl"
        b64b = base64.b64encode(tiny.read_bytes()).decode()
        page.evaluate(
            "(b64) => window.postMessage({type:'matrix-mold:ingest', bytes: Uint8Array.from(atob(b64), c=>c.charCodeAt(0)).buffer, name:'plaque.stl'}, '*')",
            b64b,
        )
        try:
            page.wait_for_selector(".btn.primary", timeout=60000)
            print("DEAD-WORKER PROBE: worker still responds to ingest ✓")
        except Exception:
            print("DEAD-WORKER PROBE: worker did NOT respond after the heavy run ✗")
        browser.close()

main()
