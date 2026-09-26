import type { AnalysisReport } from '../engine/types';

function Badge({ ok, children }: { ok: boolean; children: string }) {
  return <span className={`badge ${ok ? 'good' : 'warn'}`}>{children}</span>;
}

function fmt(n: number, d = 1): string {
  return n.toFixed(d);
}

export function AnalysisPanel({ report }: { report: AnalysisReport }) {
  const best = report.axes[0];
  return (
    <section className="panel">
      <div className="panel-title">2 · Moldability analysis</div>
      <div className="badges">
        <Badge ok={report.watertight}>{report.watertight ? 'Watertight' : 'Not watertight'}</Badge>
        <span className="badge dim">{Math.round(report.triCount / 1000)}k tris → {Math.round(report.analysisTris / 1000)}k analysis</span>
        <span className="badge dim">{fmt(report.volumeMl, 0)} mL master</span>
      </div>
      <table className="axes">
        <thead>
          <tr><th>Pull axis</th><th>Trapped rays</th><th>Max layers</th></tr>
        </thead>
        <tbody>
          {report.axes.map((ax, i) => (
            <tr key={ax.axis} className={i === 0 ? 'best' : ''}>
              <td>±{ax.axis}{i === 0 ? '  ★' : ''}</td>
              <td>{fmt(ax.trappedPct)}%</td>
              <td>{ax.maxCrossings}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="verdict">
        Proposed split: <b>2-piece planar, pull ±{best.axis}</b>
        {best.trappedPct < 1 ? ' — straight pull clean.' : ` — ${fmt(best.trappedPct)}% trapped rays, extraction sim will verify.`}
      </div>
      {report.warnings.map((w) => (
        <div key={w} className="warning">⚠ {w}</div>
      ))}
      <button className="btn primary wide" disabled title="Generate lands in M2 (SDF offset engine)">
        Generate pour box — M2
      </button>
      <div className="bbox mono">
        {fmt(report.bbox.dim[0])} × {fmt(report.bbox.dim[1])} × {fmt(report.bbox.dim[2])} mm
      </div>
    </section>
  );
}
