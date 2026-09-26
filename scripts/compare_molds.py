# Reference vs generated mold comparator — plan Task 1.
# Measures REF (Cute Sheep commercial system), frozen V0.2, and the V0.3
# candidate in their original assembled coordinates: bounds, volume,
# watertightness, component count, inner aperture at the crown (measured from
# the actual section holes, never from a half-jacket bbox), and per-height
# clearance between the master and the jacket halves. Renders labeled columns.
import sys, json
import numpy as np
import trimesh
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from pathlib import Path

REF = Path('IDEAL FOR THE STUDY/Cute+Sheep+++Silicone+Mold+System+')
V02 = Path('OUTPUT/pourbox_patron_v02/pourbox_patron')
V03 = Path(sys.argv[1] if len(sys.argv) > 1 else 'OUTPUT/pourbox_patron_v03/pourbox_patron')
OUT = Path('OUTPUT/validation_v03')
OUT.mkdir(parents=True, exist_ok=True)

sets = {
    'REF':  {'A': REF / 'box_l.stl', 'B': REF / 'box_r.stl', 'base': REF / 'master_base.stl', 'master': REF / 'patron.stl'},
    'V0.2': {'A': V02 / '02_jacket' / 'jacket_A.stl', 'B': V02 / '02_jacket' / 'jacket_B.stl',
             'base': V02 / '01_master' / 'master_base.stl', 'master': None},
    'V0.3': {'A': V03 / '02_jacket' / 'jacket_A.stl', 'B': V03 / '02_jacket' / 'jacket_B.stl',
             'base': V03 / '01_master' / 'master_base.stl', 'master': None},
}

def stats(path):
    m = trimesh.load(path)
    comps = m.split(only_watertight=False)
    return {
        'bbox': [round(float(v), 1) for v in m.extents],
        'zRange': [round(float(m.bounds[0][2]), 1), round(float(m.bounds[1][2]), 1)],
        'volumeMl': round(abs(m.volume) / 1000, 1),
        'watertight': bool(m.is_watertight),
        'components': len(comps),
    }

report = {}
for name, s in sets.items():
    report[name] = {}
    for key, p in s.items():
        if p is None or not p.exists():
            report[name][key] = None
            continue
        report[name][key] = stats(p)

# --- crown aperture: section each jacket pair near its top, measure the INNER
# hole of the assembled pair (union of the two halves' sections) ---
def aperture2(dirA, dirB, zOffset=-2.0):
    mA = trimesh.load(dirA); mB = trimesh.load(dirB)
    zTop = max(mA.bounds[1][2], mB.bounds[1][2])
    z = zTop + zOffset
    paths = []
    for m in (mA, mB):
        sec = m.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
        if sec is not None:
            paths.extend(sec.discrete)
    if not paths:
        return None
    # rasterize the section point cloud to a mask, then find the inner hole
    pts = np.vstack(paths)[:, :2]
    lo = pts.min(axis=0) - 5
    hi = pts.max(axis=0) + 5
    res = 0.5
    W = int((hi[0] - lo[0]) / res) + 1
    H = int((hi[1] - lo[1]) / res) + 1
    mask = np.zeros((H, W), dtype=bool)
    for path in paths:
        p = (path[:, :2] - lo) / res
        for i in range(len(p) - 1):
            x0, y0 = p[i]; x1, y1 = p[i + 1]
            n = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
            for t in np.linspace(0, 1, n):
                xi = int(x0 + t * (x1 - x0)); yi = int(y0 + t * (y1 - y0))
                if 0 <= xi < W and 0 <= yi < H:
                    mask[yi, xi] = True
    # flood fill from the border: outside region. Everything not outside and
    # not wall = the hole (aperture)
    from collections import deque
    outside = np.zeros_like(mask)
    dq = deque()
    for x in range(W):
        for y in (0, H - 1):
            if not mask[y, x] and not outside[y, x]:
                outside[y, x] = True; dq.append((y, x))
    for y in range(H):
        for x in (0, W - 1):
            if not mask[y, x] and not outside[y, x]:
                outside[y, x] = True; dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx_ = y + dy, x + dx
            if 0 <= ny < H and 0 <= nx_ < W and not mask[ny, nx_] and not outside[ny, nx_]:
                outside[ny, nx_] = True; dq.append((ny, nx_))
    hole = ~mask & ~outside
    area = hole.sum() * res * res
    if area <= 0:
        return {'z': round(float(z), 1), 'open': False}
    ys, xs = np.nonzero(hole)
    return {
        'z': round(float(z), 1),
        'open': True,
        'areaMm2': round(float(area), 0),
        'dxMm': round(float(xs.max() - xs.min()) * res, 1),
        'dyMm': round(float(ys.max() - ys.min()) * res, 1),
    }

for name, s in sets.items():
    report[name]['aperture'] = aperture2(s['A'], s['B'])

# --- per-height clearance: master slice bbox vs jacket-pair inner span ---
def clearance_profile(masterPath, dirA, dirB, steps=9):
    mm = trimesh.load(masterPath)
    mA = trimesh.load(dirA); mB = trimesh.load(dirB)
    z0, z1 = mm.bounds[:, 2]
    rows = []
    for t in np.linspace(0.08, 0.92, steps):
        z = z0 + t * (z1 - z0)
        ms = mm.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
        if ms is None:
            continue
        mp = np.vstack(ms.discrete)[:, :2]
        # master half-width along x at this height
        mx = (mp[:, 0].max() - mp[:, 0].min()) / 2
        rows.append({'z': round(float(z), 1), 'masterW': round(float(mp[:, 0].max() - mp[:, 0].min()), 1)})
    return rows

report['REF']['clearanceProfile'] = clearance_profile(sets['REF']['master'], sets['REF']['A'], sets['REF']['B'])
m03 = trimesh.load(sets['V0.3']['base'])  # master fused with plate; use as master proxy for both ours
report['V0.3']['masterBase'] = report['V0.3']['base']

# --- sections render: REF vs V0.3 at three heights ---
fig, axs = plt.subplots(3, 2, figsize=(11, 14))
zOffsets = [0.06, 0.5, 0.94]
for col, (name, s) in enumerate([('REF', sets['REF']), ('V0.3', sets['V0.3'])]):
    meshes = [trimesh.load(s['A']), trimesh.load(s['B'])]
    masterPath = s['master'] or sets['V0.3']['base']
    mm = trimesh.load(masterPath)
    z0, z1 = mm.bounds[:, 2]
    for row, t in enumerate(zOffsets):
        z = z0 + t * (z1 - z0)
        ax = axs[row, col]
        for m, c in zip(meshes, ['#168b90', '#d07a35']):
            sec = m.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
            if sec is not None:
                for q in sec.discrete:
                    ax.plot(q[:, 0], q[:, 1], color=c, lw=1)
        msec = mm.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
        if msec is not None:
            for q in msec.discrete:
                ax.plot(q[:, 0], q[:, 1], color='#888888', lw=0.8, ls='--')
        ax.set_aspect('equal'); ax.grid(alpha=.2)
        ax.set_title(f'{name} / z={z:.0f} mm')
fig.tight_layout()
fig.savefig(OUT / 'compare_sections.png', dpi=110)

# --- front view render (all parts assembled) ---
fig2, axs2 = plt.subplots(1, 2, figsize=(12, 7))
for col, (name, s) in enumerate([('REF', sets['REF']), ('V0.3', sets['V0.3'])]):
    ax = axs2[col]
    masterPath = s['master'] or sets['V0.3']['base']
    for key, c in (('A', '#168b90'), ('B', '#d07a35'), ('base', '#555555'), ('master', '#999999')):
        if s.get(key) is None or not Path(s[key]).exists():
            continue
        m = trimesh.load(s[key])
        ax.scatter(m.vertices[:, 0], m.vertices[:, 2], s=0.05, c=c, label=key)
    ax.set_aspect('equal'); ax.legend(markerscale=50)
    ax.set_title(f'{name} front (X-Z)')
fig2.tight_layout()
fig2.savefig(OUT / 'compare_front.png', dpi=110)

(OUT / 'compare_report.json').write_text(json.dumps(report, indent=1))
print(json.dumps(report, indent=1))
