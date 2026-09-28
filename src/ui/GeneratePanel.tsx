import { useState } from 'react';
import type { GenerateParams, GenerateResult } from '../engine/types';
import { frameConstants } from '../engine/split';
import { useStore } from '../state/store';
import { te, useT } from '../i18n';
import { EngineText } from './AnalysisPanel';

const PRESETS = [
  { id: 'small', labelKey: 'preset.small', gap: 6, wall: 5 },
  { id: 'standard', labelKey: 'preset.standard', gap: 8, wall: 5 },
  { id: 'rugged', labelKey: 'preset.rugged', gap: 10, wall: 5 },
] as const;
type PresetId = (typeof PRESETS)[number]['id'];

// Joint-fit ladder (printability audit §12): 0.25 mm is only safe on a
// calibrated machine — a 160 mm tongue accumulates dimensional error.
const FITS = [
  { id: 'resin', labelKey: 'fit.resin', wall: 2, clearance: 0.15, hintKey: 'fit.hint.resin' },
  { id: 'calibrated', labelKey: 'fit.calibrated', wall: 5, clearance: 0.25, hintKey: 'fit.hint.calibrated' },
  { id: 'standard', labelKey: 'fit.standard', wall: 5, clearance: 0.35, hintKey: 'fit.hint.standard' },
  { id: 'loose', labelKey: 'fit.loose', wall: 5, clearance: 0.45, hintKey: 'fit.hint.loose' },
] as const;
type FitId = (typeof FITS)[number]['id'];

// Envelope hug mode (P3): the pull-clearance window fattens the cavity so the
// jacket slides off rigidly; half-gap measured extraction-safe on the corpus
// with ~5–10% silicone savings and a tighter median hug.
const ENVELOPES = [
  { id: 'full', labelKey: 'env.full', noteKey: 'env.note.full' },
  { id: 'tight', labelKey: 'env.tight', noteKey: 'env.note.tight' },
] as const;
// Jacket wall (audit §1/§3): the seam rails and seating rim are reinforced by
// construction; the wall chip sizes the body shell. 5 mm remains the default
// until the physical coupon trial (core invariant 12).
const WALLS = [
  { id: 'light', labelKey: 'wall.light', wall: 4, noteKey: 'wall.note.light' },
  { id: 'standard', labelKey: 'wall.standard', wall: 5, noteKey: 'wall.note.standard' },
  { id: 'heavy', labelKey: 'wall.heavy', wall: 6.5, noteKey: 'wall.note.heavy' },
] as const;
type WallId = (typeof WALLS)[number]['id'];
type EnvelopeId = (typeof ENVELOPES)[number]['id'];

// mold size semantics (cm): the MASTER's largest dimension — "5 cm means the
// model master is 5 cm each side at most". The mold frame (plate, gap, wall,
// freeboard) scales around it; the outer mold size is a consequence, shown in
// the dims hint.
// smallest achievable master: 20 mm intake floor; cap: 280 mm SDF budget / 20 cm printer bed
const SIZE_MIN_CM = 2;
const SIZE_MAX_CM = 20;
const SIZE_PRESETS = [
  { id: 'cupcake', cm: 3, labelKey: 'size.preset.cupcake' },
  { id: 'small', cm: 5, labelKey: 'size.preset.small' },
  { id: 'medium', cm: 8, labelKey: 'size.preset.medium' },
  { id: 'large', cm: 12, labelKey: 'size.preset.large' },
  { id: 'max', cm: 16, labelKey: 'size.preset.max' },
] as const;

// printed parts are PLA (g/cm³); the master is printed in PLA too
const PRINT_DENSITY = 1.24;
// gap/wall scale with the master relative to the 150 mm reference, floored at
// kernel/printer minimums — a 5 cm master must not carry a full-size 8 mm gap
const REF_MASTER_MM = 150;
const scaleFor = (masterMm: number): number => Math.max(0.15, Math.min(1, masterMm / REF_MASTER_MM));
const halfMm = (x: number): number => Math.round(x * 2) / 2;

// predicted mold outer dims (mm) for the dims hint: exact above the frame
// floors by linear scaling of the last generation; a coarse frame estimate
// before the first generation
const predictOuter = (
  result: GenerateResult | null, masterDim: [number, number, number],
  k: number, k0: number, plateMargin: number, plateT: number, freeboard: number, wall: number,
): [number, number, number] => {
  const frameEst = 2 * plateMargin + 2 * wall * 1.45 + plateT + freeboard;
  return result
    ? result.outerDim.map((o, i) => Math.max(1, masterDim[i] * k + (o - masterDim[i] * k0) * (k / Math.max(k0, 1e-9)))) as [number, number, number]
    : masterDim.map((d) => d * k + frameEst) as [number, number, number];
};

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
  const lang = useStore((s) => s.lang);
  const t = useT();
  const [preset, setPreset] = useState<PresetId>('standard');
  const [fit, setFit] = useState<FitId>('standard');
  const [envelope, setEnvelope] = useState<EnvelopeId>('full');
  const [wall, setWall] = useState<WallId>('standard');
  const [ribs, setRibs] = useState(false);
  const [material, setMaterial] = useState<'silicone' | 'hotWax'>('silicone');
  const [targetCm, setTargetCm] = useState<number | null>(null); // null = track actual

  if (!report) return null;
  const p = PRESETS.find((x) => x.id === preset)!;
  const f = FITS.find((x) => x.id === fit)!;
  const w = WALLS.find((x) => x.id === wall)!;

  // ---- size solving (master semantics) ----
  // target cm = the master's largest dimension; k maps as-ingested → target.
  const masterDim = report.bbox.dim;
  const maxMasterDim = Math.max(...masterDim);
  const k0 = result?.params.masterScale ?? 1;
  const actualCm = (maxMasterDim * k0) / 10;
  const cm = targetCm ?? Math.round(actualCm * 10) / 10;
  const solveK = (targetMm: number): number => {
    // keep the scaled master inside the pipeline's validated ingest window
    // (20–280 mm — same bounds the intake normalization enforces)
    return Math.min(280 / maxMasterDim, Math.max(20 / maxMasterDim, targetMm / maxMasterDim));
  };
  const k = solveK(cm * 10);
  // scale-aware frame params for a given solved scale — computed per call so a
  // size commit never mixes the new masterScale with the old render's gap/wall
  // (stale closure sent gap 8 at a 5 cm master; the clearance gate rightly
  // blocked the export)
  const paramsFor = (kk: number): GenerateParams => {
    const sK = scaleFor(maxMasterDim * kk);
    const gapK = halfMm(Math.max(2, p.gap * sK));
    const wallK = Math.max(2, halfMm((f.id === 'resin' ? 2 : w.wall) * sK));
    return {
      gap: gapK,
      wall: wallK,
      clearance: f.clearance,
      gapWindow: envelope === 'tight' ? Math.max(1.5, gapK / 2) : undefined,
      ribs,
      material,
    };
  };
  const effMasterMm = maxMasterDim * k;
  const s = scaleFor(effMasterMm);
  const effGap = halfMm(Math.max(2, p.gap * s));
  const effWall = Math.max(2, halfMm((f.id === 'resin' ? 2 : w.wall) * s));
  const K = frameConstants(effMasterMm);

  const params: GenerateParams = paramsFor(k);
  const busy = phase === 'busy';

  const commitSize = (cmValue: number) => {
    if (busy) return;
    // pin the current split axis: resizing must not rotate the mold
    const kk = solveK(cmValue * 10);
    generate({
      ...paramsFor(kk),
      masterScale: kk,
      ...(result ? { splitAxis: result.axis } : {}),
    });
  };

  // ---- live material estimates (exact once k === k0, i.e. after regen) ----
  const ratio = k / k0;
  const siliconeMl = result ? result.siliconeMl * ratio ** 3 : null;
  const moldG = result?.partVolumesCm3
    ? Object.values(result.partVolumesCm3).reduce((a, b) => a + b, 0) * ratio ** 3 * PRINT_DENSITY
    : null;
  const masterG = report.volumeMl * k ** 3 * PRINT_DENSITY;
  const predOuter = predictOuter(result, masterDim, k, k0, K.plateMargin, K.plateT, K.freeboard, effWall);
  const smallHint = effMasterMm < 60;
  const pending = targetCm !== null && (busy || Math.abs(k - k0) > 1e-4);

  return (
    <section className="panel">
      <div className="panel-title">{t('gen.title')}</div>

      <div className="size-row">
        <span className="size-label">{t('size.sliderLabel')}</span>
        <input
          className="size-num"
          type="number" dir="ltr" min={SIZE_MIN_CM} max={SIZE_MAX_CM} step={0.5}
          value={cm}
          disabled={busy}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v >= SIZE_MIN_CM && v <= 20) setTargetCm(v);
          }}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (v >= SIZE_MIN_CM && v <= 20) commitSize(v);
          }}
        />
        <span className="size-unit">{t('size.cm')}</span>
      </div>
      <input
        type="range" min={SIZE_MIN_CM} max={SIZE_MAX_CM} step={0.5}
        value={cm}
        disabled={busy}
        style={{ ['--slider-fill' as never]: `${((cm - SIZE_MIN_CM) / (20 - SIZE_MIN_CM)) * 100}%` }}
        onChange={(e) => setTargetCm(Number(e.target.value))}
        onPointerUp={() => commitSize(cm)}
        onBlur={() => targetCm !== null && commitSize(cm)}
      />
      <div className="chips" style={{ marginTop: 0 }}>
        {SIZE_PRESETS.map((x) => (
          <button
            key={x.id}
            className={`chip${Math.abs(cm - x.cm) < 0.01 ? ' on' : ''}`}
            onClick={() => { setTargetCm(x.cm); commitSize(x.cm); }}
            disabled={busy}
          >
            {t(x.labelKey)} · {x.cm}
          </button>
        ))}
      </div>

      <div className="size-stats" title={t('size.densityNote')}>
        <div className="size-stat">
          <b>{siliconeMl != null ? siliconeMl.toFixed(0) : '—'}</b>
          <span>mL · {t('size.silicone')}</span>
        </div>
        <div className="size-stat">
          <b>{moldG != null ? moldG.toFixed(0) : '—'}</b>
          <span>g · {t('size.moldWeight')}</span>
        </div>
        <div className="size-stat">
          <b>{masterG.toFixed(0)}</b>
          <span>g · {t('size.masterWeight')}</span>
        </div>
      </div>
      <div className="hint dim" style={{ margin: '4px 0 0' }}>
        {t('size.dims', { d: predOuter.map((x) => x.toFixed(0)).join(' × ') })}
        {pending ? ` · ${t('size.estimateNote')}` : ''}
      </div>
      {smallHint && <div className="hint dim" style={{ color: 'var(--warn)', margin: '4px 0 0' }}>{t('size.smallHint', { g: effGap })}</div>}
      <div className="hint dim" style={{ margin: '2px 0 0', fontSize: 10.5 }}>{t('size.range')}</div>

      <div className="chips">
        {PRESETS.map((x) => (
          <button key={x.id} className={`chip${preset === x.id ? ' on' : ''}`} onClick={() => setPreset(x.id)} disabled={busy}>
            {t(x.labelKey)} · {x.gap}mm
          </button>
        ))}
      </div>
      <div className="chips">
        {FITS.map((x) => (
          <button key={x.id} className={`chip${fit === x.id ? ' on' : ''}`} onClick={() => setFit(x.id)} disabled={busy} title={t(x.hintKey)}>
            {t(x.labelKey)}
          </button>
        ))}
      </div>
      <div className="chips">
        {WALLS.map((x) => (
          <button key={x.id} className={`chip${wall === x.id ? ' on' : ''}`} onClick={() => setWall(x.id)} disabled={busy} title={t(x.noteKey)}>
            {t(x.labelKey)}
          </button>
        ))}
        <button className={`chip${ribs ? ' on' : ''}`} onClick={() => setRibs(!ribs)} disabled={busy} title={t('gen.ribsTitle')}>
          {t('gen.ribs')}
        </button>
      </div>
      <div className="chips">
        {ENVELOPES.map((x) => (
          <button key={x.id} className={`chip${envelope === x.id ? ' on' : ''}`} onClick={() => setEnvelope(x.id)} disabled={busy} title={t(x.noteKey)}>
            {t(x.labelKey)}
          </button>
        ))}
      </div>
      <div className="chips">
        <button className={`chip${material === 'silicone' ? ' on' : ''}`} onClick={() => setMaterial('silicone')} disabled={busy} title={t('gen.matTitle.silicone')}>
          {t('gen.mat.silicone')}
        </button>
        <button className={`chip${material === 'hotWax' ? ' on' : ''}`} onClick={() => setMaterial('hotWax')} disabled={busy} title={t('gen.matTitle.hotWax')}>
          {t('gen.mat.hotWax')}
        </button>
      </div>
      <button
        className="btn primary wide"
        onClick={() => generate({ ...params, masterScale: k, ...(result ? { splitAxis: result.axis } : {}) })}
        disabled={busy}
      >
        {result ? t('gen.regenerate') : t('gen.generate')}
      </button>

      {result && (
        <div className="result-box">
          <div className="big-number">
            {result.siliconeMl.toFixed(0)} <span className="unit">{t('gen.mlSilicone')}</span>
          </div>
          <div className="hint dim">
            {t('gen.split', { axis: result.axis })}{result.panels === 3 ? t('gen.threePiece') : ''}
            {result.panels === 3
              ? t('gen.extract3', { a: result.extraction.A, b1: result.extraction.B1 ?? '—', b2: result.extraction.B2 ?? '—' })
              : t('gen.extract2', { a: result.extraction.A, b: result.extraction.B })}
            <br />{t('gen.elapsed', { s: (result.elapsedMs / 1000).toFixed(1), d: result.outerDim.map((d) => d.toFixed(0)).join(' × ') })}
          </div>
          {result.clearanceBand && (() => {
            const b = result.clearanceBand;
            const excess = b.p50 > b.requestedGap + 0.25
              ? Math.round(result.siliconeMl * (1 - b.requestedGap / b.p50))
              : 0;
            return (
              <div className="hint dim">
                {t('gen.efficiency', { g: b.requestedGap.toFixed(0), p50: b.p50.toFixed(1), min: b.min, p90: b.p90 })}
                {excess > 0
                  ? t(envelope === 'full' ? 'gen.efficiency.excessTight' : 'gen.efficiency.excess', { e: excess })
                  : t('gen.efficiency.onTarget')}
              </div>
            );
          })()}
          {(() => {
            const pr = result.printability;
            if (!pr) return null;
            const jackets = Object.entries(pr).filter(([k2]) => k2.startsWith('jacket'));
            return (
              <div className="hint dim">
                {t('gen.support', { list: jackets.map(([k2, r]) => `${k2 === 'jacket_B' ? 'B' : k2.replace('jacket_', '')} ${r.overhangAreaMm2}mm²`).join(' · ') })}
              </div>
            );
          })()}
          {(() => {
            const trapped = report?.axes.find((a) => a.axis === result.axis)?.trappedPct ?? 0;
            const v = trapped <= 5 ? { label: 'HIGH', cls: 'pass' } : trapped <= 12 ? { label: 'MEDIUM', cls: 'soft' } : { label: 'LOW', cls: 'fail' };
            return (
              <div className={`gate ${v.cls}`}>
                <span className="gate-mark">{trapped <= 5 ? '✓' : '⚠'}</span>
                <span className="gate-name">{t('gen.release', { level: v.label })}</span>
                <span className="gate-detail">
                  {t(
                    result.panels === 3 ? 'gen.release.detail3' : trapped > 5 ? 'gen.release.detailTest' : 'gen.release.detail',
                    { p: trapped.toFixed(1), axis: result.axis },
                  )}
                </span>
                {trapped > 5 && result.panels !== 3 && (
                  <button className="chip" onClick={() => generate({ ...params, masterScale: k, panels: 3 })} disabled={busy} title={t('gen.threePieceBtnTitle')}>
                    {t('gen.threePieceBtn')}
                  </button>
                )}
              </div>
            );
          })()}
          <div className="chips tight">
            <button className={`chip${layers.master ? ' on' : ''}`} onClick={() => toggleLayer('master')}>{t('layer.master')}</button>
            <button className={`chip${layers.skin ? ' on' : ''}`} onClick={() => toggleLayer('skin')}>{t('layer.skin')}</button>
            <button className={`chip${layers.jacketA ? ' on' : ''}`} onClick={() => toggleLayer('jacketA')}>{t('layer.jacketA')}</button>
            {result.panels === 3 ? (
              <>
                <button className={`chip${layers.jacketB1 ? ' on' : ''}`} onClick={() => toggleLayer('jacketB1')}>{t('layer.jacketB1')}</button>
                <button className={`chip${layers.jacketB2 ? ' on' : ''}`} onClick={() => toggleLayer('jacketB2')}>{t('layer.jacketB2')}</button>
              </>
            ) : (
              <button className={`chip${layers.jacketB ? ' on' : ''}`} onClick={() => toggleLayer('jacketB')}>{t('layer.jacketB')}</button>
            )}
            <button className={`chip${layers.plate ? ' on' : ''}`} onClick={() => toggleLayer('plate')}>{t('layer.plate')}</button>
            <button className={`chip${layers.outer ? ' on' : ''}`} onClick={() => toggleLayer('outer')}>{t('layer.outer')}</button>
          </div>
          {result.warnings.map((w) => (
            <EngineText key={w} className="warning" text={w} prefix="⚠ " />
          ))}
          <div className="gates">
            {result.checks.map((c) => (
              <div key={c.name} className={`gate ${c.pass ? 'pass' : c.hard ? 'fail' : 'soft'}`}>
                <span className="gate-mark">{c.pass ? '✓' : c.hard ? '✗' : '·'}</span>
                <span className="gate-name">{te(lang, c.name)}</span>
                <span className="gate-detail">{te(lang, c.detail)}</span>
              </div>
            ))}
          </div>
          {result.gatesPass ? (
            exportUrl ? (
              <a className="btn primary wide" href={exportUrl} download={exportName ?? 'pourbox.zip'}>{t('gen.download', { name: exportName ?? 'pourbox.zip' })}</a>
            ) : (
              <button className="btn primary wide" onClick={exportPkg} disabled={busy}>{t('gen.exportBtn')}</button>
            )
          ) : (
            <button className="btn primary wide" disabled>{t('gen.exportBlocked')}</button>
          )}
          <div className="hint dim">
            {t('gen.hardware')} {t('gen.fastening.default')}. {t('gen.package')}
          </div>
        </div>
      )}
    </section>
  );
}
