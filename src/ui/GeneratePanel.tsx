import { useState } from 'react';
import type { GenerateParams } from '../engine/types';
import { useStore } from '../state/store';

const PRESETS = [
  { id: 'small', label: 'Small detail', gap: 6, wall: 5 },
  { id: 'standard', label: 'Standard candle', gap: 8, wall: 5 },
  { id: 'rugged', label: 'Rugged', gap: 10, wall: 5 },
] as const;
type PresetId = (typeof PRESETS)[number]['id'];

// Joint-fit ladder (printability audit §12): 0.25 mm is only safe on a
// calibrated machine — a 160 mm tongue accumulates dimensional error.
const FITS = [
  { id: 'resin', label: 'Resin', wall: 2, clearance: 0.15, hint: '0.15 mm joint clearance' },
  { id: 'calibrated', label: 'Calibrated FDM', wall: 5, clearance: 0.25, hint: '0.25 mm joint clearance' },
  { id: 'standard', label: 'Standard FDM', wall: 5, clearance: 0.35, hint: '0.35 mm joint clearance' },
  { id: 'loose', label: 'Loose FDM', wall: 5, clearance: 0.45, hint: '0.45 mm joint clearance' },
] as const;
type FitId = (typeof FITS)[number]['id'];

export function GeneratePanel() {
  const report = useStore((s) => s.report);
  const result = useStore((s) => s.result);
  const layers = useStore((s) => s.layers);
  const generate = useStore((s) => s.generate);
  const exportPkg = useStore((s) => s.exportPkg);
  const exportUrl = useStore((s) => s.exportUrl);
  const exportName = useStore((s) => s.exportName);
  const toggleLayer = useStore((s) => s.toggleLayer);
  const phase = useStore((s) => s.phase);
  const [preset, setPreset] = useState<PresetId>('standard');
  const [fit, setFit] = useState<FitId>('standard');

  if (!report) return null;
  const p = PRESETS.find((x) => x.id === preset)!;
  const f = FITS.find((x) => x.id === fit)!;
  const params: GenerateParams = {
    gap: p.gap,
    wall: f.wall,
    clearance: f.clearance,
  };
  const busy = phase === 'busy';

  return (
    <section className="panel">
      <div className="panel-title">3 · Generate pour box</div>
      <div className="chips">
        {PRESETS.map((x) => (
          <button key={x.id} className={`chip${preset === x.id ? ' on' : ''}`} onClick={() => setPreset(x.id)} disabled={busy}>
            {x.label} · {x.gap}mm
          </button>
        ))}
      </div>
      <div className="chips">
        {FITS.map((x) => (
          <button key={x.id} className={`chip${fit === x.id ? ' on' : ''}`} onClick={() => setFit(x.id)} disabled={busy} title={x.hint}>
            {x.label}
          </button>
        ))}
      </div>
      <button className="btn primary wide" onClick={() => generate(params)} disabled={busy}>
        {result ? 'Regenerate' : 'Generate silicone skin'}
      </button>

      {result && (
        <div className="result-box">
          <div className="big-number">
            {result.siliconeMl.toFixed(0)} <span className="unit">mL silicone</span>
          </div>
          <div className="hint dim">
            Split ±{result.axis} · extraction A clears {result.extraction.A}mm, B {result.extraction.B}mm
            <br />Generated in {(result.elapsedMs / 1000).toFixed(1)}s · jacket outer {result.outerDim.map((d) => d.toFixed(0)).join(' × ')} mm
          </div>
          <div className="chips tight">
            <button className={`chip${layers.master ? ' on' : ''}`} onClick={() => toggleLayer('master')}>Master</button>
            <button className={`chip${layers.skin ? ' on' : ''}`} onClick={() => toggleLayer('skin')}>Silicone</button>
            <button className={`chip${layers.jacketA ? ' on' : ''}`} onClick={() => toggleLayer('jacketA')}>Jacket A</button>
            <button className={`chip${layers.jacketB ? ' on' : ''}`} onClick={() => toggleLayer('jacketB')}>Jacket B</button>
            <button className={`chip${layers.plate ? ' on' : ''}`} onClick={() => toggleLayer('plate')}>Base plate</button>
            <button className={`chip${layers.outer ? ' on' : ''}`} onClick={() => toggleLayer('outer')}>Outer ghost</button>
          </div>
          {result.warnings.map((w) => (
            <div key={w} className="warning">⚠ {w}</div>
          ))}
          <div className="gates">
            {result.checks.map((c) => (
              <div key={c.name} className={`gate ${c.pass ? 'pass' : c.hard ? 'fail' : 'soft'}`}>
                <span className="gate-mark">{c.pass ? '✓' : c.hard ? '✗' : '·'}</span>
                <span className="gate-name">{c.name}</span>
                <span className="gate-detail">{c.detail}</span>
              </div>
            ))}
          </div>
          {result.gatesPass ? (
            exportUrl ? (
              <a className="btn primary wide" href={exportUrl} download={exportName ?? 'pourbox.zip'}>Download {exportName ?? 'package'}</a>
            ) : (
              <button className="btn primary wide" onClick={exportPkg} disabled={busy}>Build print package (zip)</button>
            )
          ) : (
            <button className="btn primary wide" disabled>Export blocked — hard gate failed</button>
          )}
          <div className="hint dim">Hardware: 4× M3×12 + hex nuts. Package: STL set, project.json, assembly sheet.</div>
        </div>
      )}
    </section>
  );
}
