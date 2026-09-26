import { useEffect } from 'react';
import type { LayerDef } from './ui/Viewer';
import { AnalysisPanel } from './ui/AnalysisPanel';
import { GeneratePanel } from './ui/GeneratePanel';
import { ImportPanel } from './ui/ImportPanel';
import { Viewer } from './ui/Viewer';
import { useStore } from './state/store';

export default function App() {
  const phase = useStore((s) => s.phase);
  const progress = useStore((s) => s.progress);
  const error = useStore((s) => s.error);
  const failure = useStore((s) => s.failure);
  const report = useStore((s) => s.report);
  const preview = useStore((s) => s.preview);
  const result = useStore((s) => s.result);
  const layers = useStore((s) => s.layers);

  // Embed contract (standalone-first): the parent platform drives this module
  // through an iframe via postMessage. See README → "Embedding".
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; bytes?: unknown; name?: string; params?: never } | null;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'matrix-mold:ping' && e.source) {
        (e.source as Window).postMessage({ type: 'matrix-mold:ready' }, '*');
      } else if (d.type === 'matrix-mold:ingest' && d.bytes instanceof ArrayBuffer) {
        useStore.getState().ingestBytes(d.bytes, d.name ?? 'embedded.mesh');
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const dim = report?.bbox.dim ?? [150, 150, 150];
  const center = report
    ? ([
        report.bbox.min[0] + dim[0] / 2,
        report.bbox.min[1] + dim[1] / 2,
        report.bbox.min[2] + dim[2] / 2,
      ] as [number, number, number])
    : ([0, 0, 0] as [number, number, number]);
  const frameDim = result?.outerDim ?? dim;
  const radius = Math.max(...frameDim) * 1.2;
  const gridY = -(dim[1] / 2) - 4;

  const layerDefs: LayerDef[] = [];
  if (preview && layers.master) layerDefs.push({ mesh: preview, color: '#9db4c0', opacity: failure ? 0.9 : 0.5, order: 2, trap: failure?.trapFlags });
  if (result && layers.skin) layerDefs.push({ mesh: result.parts.siliconeSkin, color: '#4fc3a1', opacity: 0.45, order: 3 });
  if (result && layers.jacketA) layerDefs.push({ mesh: result.parts.jacketA, color: '#7d9dc4', opacity: 0.4, order: 4 });
  if (result && layers.jacketB) layerDefs.push({ mesh: result.parts.jacketB, color: '#c47d9d', opacity: 0.4, order: 4 });
  if (result && layers.jacketB1) layerDefs.push({ mesh: result.parts.jacketB1, color: '#7dc4a8', opacity: 0.4, order: 4 });
  if (result && layers.jacketB2) layerDefs.push({ mesh: result.parts.jacketB2, color: '#c4b07d', opacity: 0.4, order: 4 });
  if (result && layers.plate) layerDefs.push({ mesh: result.parts.basePlate, color: '#b3a184', opacity: 0.85, order: 1 });
  if (result && layers.outer) layerDefs.push({ mesh: result.parts.jacketOuter, color: '#8a97a5', opacity: 0.12, order: 0 });

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">MATRIX MOLD</span>
        <span className="subtitle">Silicone pour box generator · V0.1-M2</span>
        <span className={`status ${phase}`}>{phase === 'busy' ? `·· ${progress?.stage ?? 'working'}` : phase === 'ready' ? 'ready' : phase === 'error' ? 'error' : 'idle'}</span>
      </header>
      <aside className="sidebar">
        <ImportPanel />
        {report && <AnalysisPanel report={report} />}
        <GeneratePanel />
        {phase === 'busy' && progress && (
          <section className="panel">
            <div className="progress-label">{progress.stage}</div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.round(progress.pct * 100)}%` }} /></div>
          </section>
        )}
        {phase === 'error' && error && (
          <section className="panel error-panel">
            <div className="panel-title">Error</div>
            <div className="warning">{error}</div>
          </section>
        )}
        {failure && (
          <section className="panel error-panel">
            <div className="panel-title">Moldability failure</div>
            <div className="warning">{failure.message}</div>
            <div className="hint dim">
              Red regions on the model trap the jacket on every candidate split axis (±{failure.axis} was the best attempt).
              Multi-piece jackets and local cores — the fix for shapes like this — land in V0.2.
            </div>
          </section>
        )}
      </aside>
      <main className="stage">
        {layerDefs.length > 0 ? (
          <Viewer layers={layerDefs} center={center} radius={radius} gridY={gridY} />
        ) : (
          <div className="empty">
            <div className="empty-title">No master loaded</div>
            <div className="hint">Import a binary STL — analysis (watertight check, decimation, straight-pull ranking) runs automatically.</div>
          </div>
        )}
      </main>
    </div>
  );
}
