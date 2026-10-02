"""Independent read-back audit for V3 attempt directories.

Usage: python scripts/v3/independent_audit.py --run OUTPUT/v3/<run-id>
This intentionally never promotes a case to digital_verified: protected-feature
fidelity, seal/clip geometry and measured renders need separate evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import trimesh


def check(name: str, passed: bool | None, measured, limit=None, unit=None) -> dict:
    return {"name": name, "pass": None if passed is None else bool(passed), "measured": measured, "limit": limit, "unit": unit,
            "method": "independent Python trimesh/manifold3d reimport"}


def overlap_mm3(left: trimesh.Trimesh, right: trimesh.Trimesh) -> float:
    hit = trimesh.boolean.intersection([left, right], engine="manifold")
    return max(0.0, float(hit.volume)) if hit is not None else 0.0


def audit_attempt(attempt: Path, profile: dict, case: dict, input_root: Path) -> dict:
    record = json.loads((attempt / "attempt.json").read_text(encoding="utf-8-sig"))
    projects = list(attempt.rglob("project.json"))
    if len(projects) != 1:
        return {"caseId": record["caseId"], "status": "no_unique_project", "checks": []}
    project = json.loads(projects[0].read_text(encoding="utf-8"))
    package = projects[0].parent
    parts: dict[str, trimesh.Trimesh] = {}
    checks = []
    for entry in project["parts"]:
        rel = entry["file"]
        path = package / rel
        mesh = trimesh.load_mesh(path, file_type="stl", process=True)
        parts[rel] = mesh
        checks += [
            check(f"{rel}:watertight", bool(mesh.is_watertight), bool(mesh.is_watertight), True),
            check(f"{rel}:winding", bool(mesh.is_winding_consistent), bool(mesh.is_winding_consistent), True),
            check(f"{rel}:positive_volume", bool(mesh.volume > 0), round(float(mesh.volume), 4), ">0", "mm3"),
        ]
        vendor = project["finalFileAudit"].get(rel, {})
        vendor_cm3 = vendor.get("netVolumeCm3")
        if vendor_cm3:
            deviation = abs(mesh.volume / 1000 - vendor_cm3) / vendor_cm3
            checks.append(check(f"{rel}:volume_vs_embedded_audit", deviation <= 0.01,
                                round(deviation, 7), 0.01, "relative"))
        if not rel.startswith("03_preview/"):
            extents = mesh.extents.tolist()
            fit = all(value <= limit + 0.01 for value, limit in zip(extents, profile["buildVolumeMm"]))
            checks.append(check(f"{rel}:build_envelope", fit, [round(x, 3) for x in extents],
                                profile["buildVolumeMm"], "mm"))
        expected_hash = next((x["sha256"] for x in record["artifacts"]
                              if Path(x["path"]).name == path.name), None)
        actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        checks.append(check(f"{rel}:hash", expected_hash == actual_hash,
                            actual_hash, expected_hash))

    silicone = parts["03_preview/silicone_skin.stl"]
    claimed_ml = float(project["siliconeMl"])
    volume_error = abs(silicone.volume / 1000 - claimed_ml) / claimed_ml
    checks.append(check("silicone_volume_claim", volume_error <= 0.02, round(volume_error, 7), 0.02, "relative"))
    rigid_paths = [p for p in parts if not p.startswith("03_preview/")]
    for index, left_path in enumerate(rigid_paths):
        for right_path in rigid_paths[index + 1:]:
            try:
                value = overlap_mm3(parts[left_path], parts[right_path])
                checks.append(check(f"assembly_overlap:{left_path}:{right_path}", value <= 0.001,
                                    round(value, 7), 0.001, "mm3"))
            except Exception as exc:
                checks.append(check(f"assembly_overlap:{left_path}:{right_path}", None,
                                    str(exc), 0.001, "mm3"))
    for rigid_path in rigid_paths:
        try:
            value = overlap_mm3(parts[rigid_path], silicone)
            rigid = parts[rigid_path]
            maximum_coordinate = max(float(np.max(np.abs(rigid.bounds))), float(np.max(np.abs(silicone.bounds))))
            float32_ulp_mm = float(np.spacing(np.float32(maximum_coordinate)))
            # STL coordinates are float32. Two independently serialized contact
            # surfaces can each move by at most one ULP per coordinate; area ×
            # that displacement is a conservative numeric volume-error bound.
            # This is reported per pair, not silently folded into a pass flag.
            numerical_bound_mm3 = max(0.001, 2 * float32_ulp_mm * min(rigid.area, silicone.area))
            checks.append(check(f"silicone_tool_overlap:{rigid_path}", value <= numerical_bound_mm3,
                                round(value, 7), round(numerical_bound_mm3, 7), "mm3 float32 quantization bound"))
        except Exception as exc:
            checks.append(check(f"silicone_tool_overlap:{rigid_path}", None,
                                str(exc), 0.001, "mm3"))

    transforms = project.get("transforms", {})
    forward = transforms.get("sourceToMold")
    backward = transforms.get("moldToSource")
    if forward and backward:
        f = np.asarray(forward).reshape(4, 4).T
        b = np.asarray(backward).reshape(4, 4).T
        round_trip = float(np.max(np.abs(b @ f - np.eye(4))))
        checks.append(check("transform_inverse", round_trip <= 0.01,
                            round(round_trip, 9), 0.01, "mm matrix residual"))
    else:
        checks.append(check("transform_inverse", False, "missing signed matrices", 0.01))

    if forward:
        with (input_root / case["sourceFile"]).open("rb") as source_stream:
            source = trimesh.load_mesh(source_stream, file_type="stl", process=True)
        source.apply_scale(case["sizeMm"] / max(source.extents))
        shells = source.split(only_watertight=True)
        if len(shells) > 1:
            source = trimesh.boolean.union(shells, engine="manifold")
        source.apply_transform(np.asarray(forward).reshape(4, 4).T)
        points = source.vertices[source.vertices[:, 2] > 0.5]
        target = parts["01_master/master_base.stl"]
        max_distance = 0.0
        for start in range(0, len(points), 2048):
            distances = trimesh.proximity.closest_point(target, points[start:start + 2048])[1]
            max_distance = max(max_distance, float(np.max(distances, initial=0)))
        checks.append(check("source_to_printed_master_surface", max_distance <= 0.05,
                            round(max_distance, 6), 0.05, "mm; every source exterior vertex above the approved backing attachment"))
    printability = project.get("printability", {})
    for name, forecast in printability.items():
        area = forecast["bedAreaMm2"]
        checks.append(check(f"{name}:bed_contact", area > 0, area, ">0", "mm2"))

    failures = [x["name"] for x in checks if x["pass"] is False]
    unverified = [x["name"] for x in checks if x["pass"] is None]
    return {
        "caseId": record["caseId"], "attempt": str(attempt),
        "status": "geometry_audited_pending_fidelity_visual" if not failures and not unverified else "independent_audit_failed",
        "checks": checks, "failures": failures, "unverified": unverified,
        "stillRequired": ["protected_feature_fidelity", "hole_topology", "seal_and_clip_geometry",
                          "measured_visual_review", "slicer_and_physical_qualification"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", type=Path, required=True)
    args = parser.parse_args()
    run = args.run.resolve()
    contract = json.loads((Path(__file__).resolve().parents[2] / "docs/validation/v3/acceptance.json").read_text(encoding="utf-8"))
    case_map = {case["id"]: case for case in contract["requiredSuccessCases"]}
    results = []
    for record_path in sorted(run.glob("*/attempt-*/attempt.json")):
        record = json.loads(record_path.read_text(encoding="utf-8-sig"))
        result = audit_attempt(record_path.parent, contract["requiredProfile"],
                               case_map[record["caseId"]], Path(contract["inputRoot"]))
        (record_path.parent / "independent_audit.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        results.append({k: result[k] for k in ("caseId", "status", "failures", "unverified") if k in result})
        print(f"{result['caseId']}: {result['status']} ({len(result.get('failures', []))} failures)")
    (run / "independent_summary.json").write_text(json.dumps(results, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
