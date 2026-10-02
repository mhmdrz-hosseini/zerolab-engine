import { useEffect } from 'react';
import type { LayerDef } from './ui/Viewer';
import { AnalysisPanel } from './ui/AnalysisPanel';
import { GeneratePanel } from './ui/GeneratePanel';
import { ImportPanel } from './ui/ImportPanel';
import { Viewer } from './ui/Viewer';
import { useStore } from './state/store';
import { applyDocumentLang, te, useT } from './i18n';
import { AXES, type MeshArrays } from './engine/types';

/** bbox center of a mesh — used to center the display group on the mesh set
 *  actually shown (a scaled result is NOT centered by the as-ingested bbox). */
function bboxCenterOf(m: MeshArrays): [number, number, number] {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.vertProperties.length / 3; i++) {
    for (let k = 0; k < 3; k++) {
      const x = m.vertProperties[i * 3 + k];
      if (x < min[k]) min[k] = x;
      if (x > max[k]) max[k] = x;
    }
  }
  return [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
}

export default function App() {
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);
  const phase = useStore((s) => s.phase);
  const progress = useStore((s) => s.progress);
  const error = useStore((s) => s.error);
  const failure = useStore((s) => s.failure);
  const report = useStore((s) => s.report);
  const preview = useStore((s) => s.preview);
  const result = useStore((s) => s.result);
  const layers = useStore((s) => s.layers);
  const explode = useStore((s) => s.explode);
  const setExplode = useStore((s) => s.setExplode);
  const realView = useStore((s) => s.realView);
  const setRealView = useStore((s) => s.setRealView);
  const t = useT();

  useEffect(() => {
    applyDocumentLang(lang);
  }, [lang]);

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
  const busy = phase === 'busy';
  // during a (re)generation the previous mold preview is stale — hide it so
  // the old size/orientation is never mistaken for the new result
  const showResult = !!result && !busy;
  const frameDim = showResult ? result!.outerDim : dim;
  const radius = Math.max(...frameDim) * 1.2;
  // upright framing: grid sits at the plate bottom (base − plateT in vert
  // coords; after the frame rotation that plane is world y = −plateT)
  const gridY = showResult && result!.frame
    ? -result!.frame.plateT - 0.5
    : -(dim[1] / 2) - 4;
  // display center: when a result is shown, center on the RESULT's own bbox
  // (a scaled master is not centered by the as-ingested bbox — the viewport
  // went empty after a 5 cm regen because every layer was offset by the
  // 15 cm-scale center)
  const displayCenter: [number, number, number] =
    showResult && result?.parts.jacketOuter ? bboxCenterOf(result.parts.jacketOuter) : center;

  const layerDefs: LayerDef[] = [];
  // after a size regen the raw analysis preview is at the AS-INGESTED scale —
  // show the result's scaled master instead, so the viewport never mixes a
  // 15 cm preview with a 5 cm mold (failure overlay still needs the raw
  // preview: trap flags are indexed on it)
  const masterMesh = failure ? preview : (result?.parts.master ?? preview);
  if (masterMesh && layers.master) layerDefs.push({ id: 'master', mesh: masterMesh, color: '#9fb6c6', opacity: failure ? 0.92 : 0.5, order: 2, trap: failure?.trapFlags });
  if (showResult && layers.skin) layerDefs.push({ id: 'siliconeSkin', mesh: result!.parts.siliconeSkin, color: '#5ec9a8', opacity: 0.45, order: 3 });
  if (showResult && layers.jacketA) layerDefs.push({ id: 'jacketA', mesh: result!.parts.jacketA, color: '#7fa8d6', opacity: 0.4, order: 4 });
  if (showResult && layers.jacketB && result!.panels !== 1) layerDefs.push({ id: 'jacketB', mesh: result!.parts.jacketB, color: '#d686a2', opacity: 0.4, order: 4 });
  if (showResult && layers.jacketB1) layerDefs.push({ id: 'jacketB1', mesh: result!.parts.jacketB1!, color: '#7fcbb0', opacity: 0.4, order: 4 });
  if (showResult && layers.jacketB2) layerDefs.push({ id: 'jacketB2', mesh: result!.parts.jacketB2!, color: '#d6b47f', opacity: 0.4, order: 4 });
  if (showResult && layers.plate) layerDefs.push({ id: 'basePlate', mesh: result!.parts.basePlate, color: '#c9b391', opacity: 0.9, order: 1 });
  if (showResult && layers.outer && !realView) layerDefs.push({ id: 'jacketOuter', mesh: result!.parts.jacketOuter, color: '#a9b6c4', opacity: 0.14, order: 0 });

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">MATRIX MOLD</span>
        <span className="subtitle">{t('app.subtitle')}</span>
        <span className={`status ${phase}`}>
          {phase === 'busy'
            ? `·· ${progress ? te(lang, progress.stage) : t('status.working')}`
            : phase === 'ready'
              ? t('status.ready')
              : phase === 'error'
                ? t('status.error')
                : t('status.idle')}
        </span>
        <button
          className="chip lang-switch"
          onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')}
          title={lang === 'fa' ? 'Switch to English' : 'تغییر به فارسی'}
        >
          {t('lang.switch')}
        </button>
      </header>
      <div className="app-body">
        <aside className="sidebar">
        <ImportPanel />
        {report && <AnalysisPanel report={report} />}
        <GeneratePanel key={report?.fileName ?? 'no-file'} />
        {phase === 'busy' && progress && (
          <section className="panel">
            <div className="progress-label">{te(lang, progress.stage)}</div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.round(progress.pct * 100)}%` }} /></div>
          </section>
        )}
        {phase === 'error' && error && (
          <section className="panel error-panel">
            <div className="panel-title">{t('panel.error')}</div>
            <div className="warning">{te(lang, error)}</div>
          </section>
        )}
        {failure && (
          <section className="panel error-panel">
            <div className="panel-title">{failure.outcome === 'review_required' ? (lang === 'fa' ? 'نیاز به بررسی' : 'Review required') : t('panel.failure')}</div>
            <div className="warning">{te(lang, failure.message)}</div>
            {failure.outcome === 'rejected' && <div className="hint dim">{t('failure.hint', { axis: failure.axis })}</div>}
          </section>
        )}
      </aside>
        <main className="stage">
        {layerDefs.length > 0 ? (
          <>
            <Viewer
              layers={layerDefs}
              center={displayCenter}
              radius={radius}
              gridY={gridY}
              axis={result?.axis}
              explode={explode}
              explodeDist={result ? 0.45 * result.outerDim[AXES.indexOf(result.axis)] : 0}
              real={realView}
              frame={result?.frame}
            />
            {showResult && (
              <div className="stage-bar" dir="ltr">
                <label>{t('view.explode')}</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(explode * 100)}
                  style={{ ['--slider-fill' as never]: `${Math.round(explode * 100)}%` }}
                  onChange={(e) => {
                    const v = Number(e.target.value) / 100;
                    if (v > 0 && explode === 0) {
                      // first pull: reveal the whole assembly so the separation reads
                      useStore.setState({
                        layers: {
                          master: true, skin: true, outer: false,
                          jacketA: true, jacketB: true,
                          jacketB1: !!result.parts.jacketB1, jacketB2: !!result.parts.jacketB2,
                          plate: true,
                        },
                      });
                    }
                    setExplode(v);
                  }}
                />
                <div className="seg">
                  <button className={!realView ? 'on' : ''} onClick={() => setRealView(false)}>{t('view.schematic')}</button>
                  <button className={realView ? 'on' : ''} onClick={() => setRealView(true)}>{t('view.real')}</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="empty">
            <div className="empty-title">{t('empty.title')}</div>
            <div className="hint">{t('empty.hint')}</div>
          </div>
        )}
      </main>
      </div>
    </div>
  );
}
