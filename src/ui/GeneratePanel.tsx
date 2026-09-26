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

// Envelope hug mode (P3): the pull-clearance window fattens the cavity so the
// jacket slides off rigidly; half-gap measured extraction-safe on the corpus
// with ~5–10% silicone savings and a tighter median hug.
const ENVELOPES = [
  { id: 'full', label: 'Full clearance', note: 'V0.3 window — maximum release margin' },
  { id: 'tight', label: 'Tight hug', note: '½-gap window — less silicone, test-print first' },
] as const;
// Jacket wall (audit §1/§3): the seam rails and seating rim are reinforced by
// construction; the wall chip sizes the body shell. 5 mm remains the default
// until the physical coupon trial (core invariant 12).
const WALLS = [
  { id: 'light', label: 'Light · 4 mm', wall: 4, note: 'audit-recommended body wall with reinforced rails' },
  { id: 'standard', label: 'Standard · 5 mm', wall: 5, note: 'V0.3 default — maximum margin' },
  { id: 'heavy', label: 'Heavy · 6.5 mm', wall: 6.5, note: 'production / rough handling' },
] as const;
type WallId = (typeof WALLS)[number]['id'];
type EnvelopeId = (typeof ENVELOPES)[number]['id'];

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
  const [envelope, setEnvelope] = useState<EnvelopeId>('full');
  const [wall, setWall] = useState<WallId>('standard');
  const [ribs, setRibs] = useState(false);
  const [material, setMaterial] = useState<'silicone' | 'hotWax'>('silicone');

  if (!report) return null;
  const p = PRESETS.find((x) => x.id === preset)!;
  const f = FITS.find((x) => x.id === fit)!;
  const w = WALLS.find((x) => x.id === wall)!;
  const params: GenerateParams = {
    gap: p.gap,
    wall: f.id === 'resin' ? 2 : w.wall,
    clearance: f.clearance,
    gapWindow: envelope === 'tight' ? Math.max(1.5, p.gap / 2) : undefined,
    ribs,
    material,
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
      <div className="chips">
        {WALLS.map((x) => (
          <button key={x.id} className={`chip${wall === x.id ? ' on' : ''}`} onClick={() => setWall(x.id)} disabled={busy} title={x.note}>
            {x.label}
          </button>
        ))}
        <button className={`chip${ribs ? ' on' : ''}`} onClick={() => setRibs(!ribs)} disabled={busy} title="four external 8 mm stiffening fins on the jacket body">
          Ribs
        </button>
      </div>
      <div className="chips">
        {ENVELOPES.map((x) => (
          <button key={x.id} className={`chip${envelope === x.id ? ' on' : ''}`} onClick={() => setEnvelope(x.id)} disabled={busy} title={x.note}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="chips">
        <button className={`chip${material === 'silicone' ? ' on' : ''}`} onClick={() => setMaterial('silicone')} disabled={busy} title="room-temperature RTV pour — PLA is fine">
          Silicone (PLA ok)
        </button>
        <button className={`chip${material === 'hotWax' ? ' on' : ''}`} onClick={() => setMaterial('hotWax')} disabled={busy} title="jacket stays on while pouring hot wax — print jackets in PETG/ASA">
          Hot wax (PETG)
        </button>
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
            Split ±{result.axis}{result.panels === 3 ? ' · 3-piece (heavy half sub-split ±depth)' : ''}
            {result.panels === 3
              ? ` · extraction A ${result.extraction.A}mm, B1 ${result.extraction.B1 ?? '—'}mm, B2 ${result.extraction.B2 ?? '—'}mm`
              : ` · extraction A clears ${result.extraction.A}mm, B ${result.extraction.B}mm`}
            <br />Generated in {(result.elapsedMs / 1000).toFixed(1)}s · jacket outer {result.outerDim.map((d) => d.toFixed(0)).join(' × ')} mm
          </div>
          {result.clearanceBand && (() => {
            const b = result.clearanceBand;
            const excess = b.p50 > b.requestedGap + 0.25
              ? Math.round(result.siliconeMl * (1 - b.requestedGap / b.p50))
              : 0;
            return (
              <div className="hint dim">
                Silicone efficiency: requested {b.requestedGap.toFixed(0)} mm · median hug {b.p50.toFixed(1)} mm
                (min {b.min} · p90 {b.p90})
                {excess > 0 ? ` · excess ≈ ${excess} mL${envelope === 'full' ? ' — Tight hug recovers part of it' : ''}` : ' · on target'}
              </div>
            );
          })()}
          {(() => {
            const trapped = report?.axes.find((a) => a.axis === result.axis)?.trappedPct ?? 0;
            const v = trapped <= 5 ? { label: 'HIGH', cls: 'pass' } : trapped <= 12 ? { label: 'MEDIUM', cls: 'soft' } : { label: 'LOW', cls: 'fail' };
            return (
              <div className={`gate ${v.cls}`}>
                <span className="gate-mark">{trapped <= 5 ? '✓' : '⚠'}</span>
                <span className="gate-name">2-piece release confidence: {v.label}</span>
                <span className="gate-detail">{trapped.toFixed(1)}% trapped geometry along ±{result.axis}{result.panels === 3 ? ' — 3-piece build active' : trapped > 5 ? ' — test-print before committing' : ''}</span>
                {trapped > 5 && result.panels !== 3 && (
                  <button className="chip" onClick={() => generate({ ...params, panels: 3 })} disabled={busy} title="sub-splits the trap-heavy half along ±depth so fold channels open sideways">
                    Generate 3-piece jacket
                  </button>
                )}
              </div>
            );
          })()}
          <div className="chips tight">
            <button className={`chip${layers.master ? ' on' : ''}`} onClick={() => toggleLayer('master')}>Master</button>
            <button className={`chip${layers.skin ? ' on' : ''}`} onClick={() => toggleLayer('skin')}>Silicone</button>
            <button className={`chip${layers.jacketA ? ' on' : ''}`} onClick={() => toggleLayer('jacketA')}>Jacket A</button>
            {result.panels === 3 ? (
              <>
                <button className={`chip${layers.jacketB1 ? ' on' : ''}`} onClick={() => toggleLayer('jacketB1')}>Jacket B1</button>
                <button className={`chip${layers.jacketB2 ? ' on' : ''}`} onClick={() => toggleLayer('jacketB2')}>Jacket B2</button>
              </>
            ) : (
              <button className={`chip${layers.jacketB ? ' on' : ''}`} onClick={() => toggleLayer('jacketB')}>Jacket B</button>
            )}
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
