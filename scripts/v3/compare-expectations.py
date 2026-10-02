"""Compare a full-corpus summary.json against the handoff expectation table.

Expectation policy (handoff 2026-09-30 + user rulings):
- flat reliefs (front_only suggestion)  -> open_face_relief package, all audits valid
- single-solid figures                  -> full_3d_jacket package, all audits valid
- multi-shell: genuine overlap          -> fused jacket/tray, all audits valid
- multi-shell: touching-only or disjoint-> truthful review_required (giraffe policy)
- non-manifold input                    -> repaired (warning) or truthful rejection
- unsupported formats (.step/.3mf)      -> intake diagnostic
Every case must be one of: generated(all valid) | review_required | rejected
with a SPECIFIC message. crash / generated_invalid_audit / generic message = defect.
"""
import json
import sys
from pathlib import Path

run = Path(sys.argv[1] if len(sys.argv) > 1 else "OUTPUT/v3/full-corpus-20260930")
recs = json.loads((run / "summary.json").read_text(encoding="utf-8"))

def expect(r):
    s = r.get("suggested", {})
    if r["status"] == "intake_failed":
        return "intake diagnostic", True
    shells = s.get("positiveShells", 0)
    overlap = s.get("overlapMm3", 0)
    if r["status"] == "generated":
        ok = r.get("allAuditsValid") is True and r.get("pinchedEdges", 1) == 0
        fam = "open_face_relief" if s.get("surfaces") == "front_only" else "full_3d_jacket"
        fam_ok = r.get("family") == fam
        return f"valid {fam} package", ok and fam_ok
    if r["status"] == "review_required":
        if shells > 1:
            return "truthful multi-body review", True
        return "review (unexpected for single solid)", False
    if r["status"] == "rejected":
        msg = r.get("message", "")
        specific = any(k in msg for k in ("(", "—", ":")) and len(msg) > 40
        return "truthful rejection with named obstacle", specific
    return f"DEFECT: {r['status']}", False

print(f"{'case':36} {'status':20} {'expectation':38} verdict")
defects = []
for r in recs:
    label, ok = expect(r)
    print(f"{r['caseId'][:35]:36} {r['status']:20} {label:38} {'OK' if ok else 'DEFECT'}")
    if not ok:
        defects.append((r["caseId"], r["status"], (r.get("message") or "")[:120]))

print()
n = len(recs)
print(f"{n - len(defects)}/{n} cases meet the standard")
if defects:
    print("defects:")
    for cid, st, msg in defects:
        print(f"  - {cid} [{st}] {msg}")
