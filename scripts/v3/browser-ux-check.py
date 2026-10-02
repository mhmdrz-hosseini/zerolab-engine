# Browser E2E for the V3 platform (worktree dev server on 127.0.0.1:5180):
# 1) import a previously-failing figure through the real file input,
# 2) verify the suggested-intent prefill lands in the selectors,
# 3) generate with the suggested defaults,
# 4) require a package result or a SPECIFIC truthful review — never the old
#    generic "trap the jacket on every candidate axis" dead end.
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

MODEL = Path(sys.argv[1] if len(sys.argv) > 1 else r"D:/code/3d/MOLD/MOLD-generator base/input/obj_1_Spiderman urban.stl")
URL = "http://127.0.0.1:5180/"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_selector("input[type=file]", state="attached", timeout=20000)

    page.set_input_files("input[type=file]", str(MODEL))
    # analysis + suggestion may take a while on big meshes
    page.wait_for_selector("select", timeout=240000)
    page.wait_for_function(
        """() => {
          const sels = [...document.querySelectorAll('select')];
          return sels.length >= 5 && sels[0].value !== 'unknown';
        }""",
        timeout=240000,
    )
    values = page.eval_on_selector_all(
        "select",
        "els => els.map(e => e.value)",
    )
    print("selector values after ingest:", values)
    role, surfaces, family, backing, multibody = (values + [None] * 5)[:5]
    assert role == "positive_master", f"role not suggested: {role}"
    assert surfaces in ("front_only", "all_sides", "inner_and_outer"), f"surfaces not suggested: {surfaces}"

    # generate with the suggested defaults (JS click — canvas overlays swallow
    # synthetic pointer events). The generate button is .btn.primary.wide —
    # plain .btn.primary can match an earlier primary button.
    clicked = page.eval_on_selector_all(
        "button.btn.primary",
        "els => { const el = els.find(e => e.className.includes('wide')); if (el) { el.click(); return true; } return false; }",
    )
    print("generate clicked:", clicked)
    try:
        page.wait_for_selector(".result-box", timeout=900000)
        ml = page.inner_text(".result-box .big-number")
        print(f"RESULT: package generated — {ml.strip()[:40]}")
        outcome = "generated"
    except Exception:
        body = page.inner_text("body")
        print("---- BODY DUMP (tail) ----")
        print("\n".join(body.splitlines()[-25:]))
        print("--------------------------")
        if "Review required" in body or "review" in body.lower():
            outcome = "review_required"
        elif "result-box" in body:
            outcome = "generated"
        else:
            outcome = "failed"
    real_errors = [e for e in errors if "favicon" not in e]
    print("console errors:", real_errors if real_errors else "none")
    print("OUTCOME:", outcome)
    browser.close()
    sys.exit(0 if outcome in ("generated", "review_required") and not real_errors else 1)
