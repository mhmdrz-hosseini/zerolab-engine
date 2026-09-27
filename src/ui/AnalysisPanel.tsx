import type { AnalysisReport } from '../engine/types';
import { te, useT } from '../i18n';
import { useStore } from '../state/store';

function Badge({ ok, children }: { ok: boolean; children: string }) {
  return <span className={`badge ${ok ? 'good' : 'warn'}`}>{children}</span>;
}

function fmt(n: number, d = 1): string {
  return n.toFixed(d);
}

export function AnalysisPanel({ report }: { report: AnalysisReport }) {
  const t = useT();
  const best = report.axes[0];
  return (
    <section className="panel">
      <div className="panel-title">{t('analysis.title')}</div>
      <div className="badges">
        <Badge ok={report.watertight}>{report.watertight ? t('analysis.watertight') : t('analysis.notWatertight')}</Badge>
        <span className="badge dim">{t('analysis.tris', { n: Math.round(report.triCount / 1000), m: Math.round(report.analysisTris / 1000) })}</span>
        <span className="badge dim">{t('analysis.volume', { v: fmt(report.volumeMl, 0) })}</span>
      </div>
      <table className="axes">
        <thead>
          <tr><th>{t('analysis.th.axis')}</th><th>{t('analysis.th.trapped')}</th><th>{t('analysis.th.layers')}</th></tr>
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
        {t('analysis.verdict', { axis: best.axis })}
        {best.trappedPct < 1 ? t('analysis.verdict.clean') : t('analysis.verdict.trapped', { p: fmt(best.trappedPct) })}
      </div>
      {report.warnings.map((w) => (
        <EngineText key={w} className="warning" text={w} prefix="⚠ " />
      ))}
      <button className="btn primary wide" disabled title={t('analysis.generateBtnTitle')}>
        {t('analysis.generateBtn')}
      </button>
      <div className="bbox mono">
        {fmt(report.bbox.dim[0])} × {fmt(report.bbox.dim[1])} × {fmt(report.bbox.dim[2])} mm
      </div>
    </section>
  );
}

/** Renders an engine-emitted string through the fa/en pattern table. */
export function EngineText({ text, className, prefix }: { text: string; className?: string; prefix?: string }) {
  const lang = useStore((s) => s.lang);
  return <div className={className}>{prefix}{te(lang, text)}</div>;
}
