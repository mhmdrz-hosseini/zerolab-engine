import { useEffect, useRef, useState } from 'react';
import type { CastingIntent, GenerateParams, GenerateResult } from '../engine/types';
import { functionalFloors } from '../engine/types';
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
  const [inputRole, setInputRole] = useState<CastingIntent['inputRole']>('unknown');
  const [requiredSurfaces, setRequiredSurfaces] = useState<CastingIntent['requiredSurfaces']>('unspecified');
  const [requestedFamily, setRequestedFamily] = useState<NonNullable<CastingIntent['requestedFamily']>>('auto');
  const [backingSide, setBackingSide] = useState('auto');
  const [multiBodyHandling, setMultiBodyHandling] = useState<NonNullable<CastingIntent['multiBodyHandling']>>('auto_review');
  const suggestion = useStore((s) => s.suggestion);
  const appliedRef = useRef(false);
  // UX: the algorithm proposes the best-fit intent for the ingested master the
  // moment analysis lands; the selectors pre-fill with it and the user can
  // change anything. Only untouched (still-default) fields are filled, so a
  // choice the user already made is never overwritten.
  useEffect(() => {
    if (!suggestion || appliedRef.current) return;
    appliedRef.current = true;
    setInputRole((v) => (v === 'unknown' ? 'positive_master' : v));
    setRequiredSurfaces((v) => (v === 'unspecified' ? suggestion.surfaces : v));
    setRequestedFamily((v) => (v === 'auto' ? suggestion.family : v));
    const n = suggestion.backingNormalSource;
    const side = Math.abs(n[0]) > 0.5 ? (n[0] < 0 ? '-X' : '+X')
      : Math.abs(n[1]) > 0.5 ? (n[1] < 0 ? '-Y' : '+Y')
      : n[2] < 0 ? '-Z' : '+Z';
    setBackingSide((v) => (v === 'auto' ? side : v));
    setMultiBodyHandling((v) => (v === 'auto_review' ? suggestion.multiBodyHandling : v));
  }, [suggestion]);
  const suggestedHere = !!suggestion && inputRole !== 'unknown' && requiredSurfaces !== 'unspecified';

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
  // functional manufacturing minimums (reliability brief §1) — applied AFTER
  // master scaling: scaling may shrink the frame, never below these. Complex
  // shapes (>10% trapped rays) tear a thin silicone skin on pull; FDM cannot
  // print a jacket body below 3 mm (resin keeps its 2 mm capability).
  const trappedPct = report.axes[0]?.trappedPct ?? 0;
  const floors = functionalFloors(trappedPct, f.id);
  const minGap = floors.gap;
  const minWall = floors.wall;
  // scale-aware frame params for a given solved scale — computed per call so a
  // size commit never mixes the new masterScale with the old render's gap/wall
  // (stale closure sent gap 8 at a 5 cm master; the clearance gate rightly
  // blocked the export)
  const paramsFor = (kk: number): GenerateParams => {
    const sK = scaleFor(maxMasterDim * kk);
    const gapK = halfMm(Math.max(minGap, p.gap * sK));
    const wallK = Math.max(minWall, halfMm((f.id === 'resin' ? 2 : w.wall) * sK));
    return {
      gap: gapK,
      wall: wallK,
      clearance: f.clearance,
      gapWindow: envelope === 'tight' ? Math.max(1.5, gapK / 2) : undefined,
      ribs,
      material,
      fit: f.id,
    };
  };
  const effMasterMm = maxMasterDim * k;
  const s = scaleFor(effMasterMm);
  const effGap = halfMm(Math.max(minGap, p.gap * s));
  const effWall = Math.max(minWall, halfMm((f.id === 'resin' ? 2 : w.wall) * s));
  const K = frameConstants(effMasterMm);

  const params: GenerateParams = paramsFor(k);
  const busy = phase === 'busy';
  const signedNormals: Record<string, [number, number, number]> = {
    '-X': [-1, 0, 0], '+X': [1, 0, 0], '-Y': [0, -1, 0], '+Y': [0, 1, 0], '-Z': [0, 0, -1], '+Z': [0, 0, 1],
  };
  const generateWithIntent = (nextParams: GenerateParams) => generate(nextParams, {
    inputRole, requiredSurfaces, requestedFamily, multiBodyHandling,
    ...(backingSide === 'auto' ? {} : { backingNormalSource: signedNormals[backingSide] }),
  });

  const commitSize = (cmValue: number) => {
    if (busy) return;
    // pin the current split axis: resizing must not rotate the mold
    const kk = solveK(cmValue * 10);
    generateWithIntent({
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
      {suggestedHere ? (
        <div className="hint dim">
          {lang === 'fa'
            ? 'تنظیمات پیشنهادی بر پایه هندسه مدل پر شده — در صورت نیاز تغییر دهید. '
            : 'Suggested settings filled from the model\u2019s geometry — change anything if your intent differs. '}
          <EngineText text={suggestion!.reason} />
        </div>
      ) : (
        <div className="hint dim">{lang === 'fa' ? 'ابتدا نقش فایل و سطوح مورد نیاز قطعه را تأیید کنید.' : 'Confirm what the file represents and which casting surfaces must be reproduced.'}</div>
      )}
      <label className="size-row">
        <span className="size-label">{lang === 'fa' ? 'نقش فایل' : 'Input role'}</span>
        <select value={inputRole} disabled={busy} onChange={e => setInputRole(e.target.value as CastingIntent['inputRole'])}>
          <option value="unknown">{lang === 'fa' ? 'نیاز به انتخاب' : 'Choose role'}</option>
          <option value="positive_master">{lang === 'fa' ? 'مدل مثبت قطعه' : 'Positive master'}</option>
          <option value="prebuilt_negative_mold">{lang === 'fa' ? 'قالب منفی آماده' : 'Existing negative mold'}</option>
          <option value="tooling">{lang === 'fa' ? 'ابزار یا جیگ' : 'Tooling or jig'}</option>
        </select>
      </label>
      <label className="size-row">
        <span className="size-label">{lang === 'fa' ? 'سطوح ریخته‌گری' : 'Casting surfaces'}</span>
        <select value={requiredSurfaces} disabled={busy} onChange={e => setRequiredSurfaces(e.target.value as CastingIntent['requiredSurfaces'])}>
          <option value="unspecified">{lang === 'fa' ? 'نیاز به انتخاب' : 'Choose surfaces'}</option>
          <option value="front_only">{lang === 'fa' ? 'فقط نمای جلو؛ پشت باز مجاز' : 'Front only; open back allowed'}</option>
          <option value="all_sides">{lang === 'fa' ? 'همه طرف قطعه' : 'All sides'}</option>
          <option value="inner_and_outer">{lang === 'fa' ? 'داخل و خارج ظرف' : 'Inside and outside vessel'}</option>
        </select>
      </label>
      <label className="size-row">
        <span className="size-label">{lang === 'fa' ? 'روش قالب' : 'Mold family'}</span>
        <select value={requestedFamily} disabled={busy} onChange={e => setRequestedFamily(e.target.value as NonNullable<CastingIntent['requestedFamily']>)}>
          <option value="auto">{lang === 'fa' ? 'انتخاب بر پایه هندسه و هدف' : 'Select from geometry and intent'}</option>
          <option value="open_face_relief">{lang === 'fa' ? 'سینی برجسته باز' : 'Open-face relief tray'}</option>
          <option value="full_3d_jacket">{lang === 'fa' ? 'قالب سه‌بعدی چندبخشی' : 'Full 3D split jacket'}</option>
          <option value="vessel_core">{lang === 'fa' ? 'قالب ظرف با هسته' : 'Vessel with core — review'}</option>
        </select>
      </label>
      <label className="size-row">
        <span className="size-label">{lang === 'fa' ? 'سمت پایه' : 'Backing side'}</span>
        <select value={backingSide} disabled={busy} onChange={e => setBackingSide(e.target.value)}>
          <option value="auto">{lang === 'fa' ? 'تشخیص خودکار؛ اگر مبهم بود توقف' : 'Auto; review if ambiguous'}</option>
          {Object.keys(signedNormals).map(side => <option key={side} value={side}>{side}</option>)}
        </select>
      </label>
      <label className="size-row">
        <span className="size-label">{lang === 'fa' ? 'چند قطعه' : 'Multiple solids'}</span>
        <select value={multiBodyHandling} disabled={busy} onChange={e => setMultiBodyHandling(e.target.value as NonNullable<CastingIntent['multiBodyHandling']>)}>
          <option value="auto_review">{lang === 'fa' ? 'توقف و بررسی' : 'Stop for review'}</option>
          <option value="fuse_overlapping">{lang === 'fa' ? 'اتصال پوسته‌های هم‌پوشان' : 'Fuse overlapping shells into one cast'}</option>
          <option value="separate_casts">{lang === 'fa' ? 'قطعات ریخته‌گری جداگانه' : 'Separate cast pieces — review'}</option>
        </select>
      </label>

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
      {effMasterMm >= 150 && wall === 'light' && !ribs && (
        <div className="hint dim" style={{ color: 'var(--warn)', margin: '2px 0 0' }}>{t('gen.ribs.recommended')}</div>
      )}
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
        onClick={() => generateWithIntent({ ...params, masterScale: k, ...(result && result.method?.family === requestedFamily ? { splitAxis: result.axis } : {}) })}
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
            {result.panels === 1
              ? (lang === 'fa' ? 'سینی برجسته با بالای باز؛ دیواره و پایه در قاب چاپ قرار دارند.' : 'Open-face relief tray; wall and base lie in the print frame.')
              : t('gen.split', { axis: result.axis })}{result.panels === 3 ? t('gen.threePiece') : ''}
            {result.panels === 1 ? '' : result.panels === 3
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
          {envelope === 'full' && result.clearanceBand && result.clearanceBand.p50 > result.clearanceBand.requestedGap * 1.4 && (
            <div className="hint dim" style={{ color: 'var(--warn)' }}>{t('gen.efficiency.low')}</div>
          )}
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
            const rigidPass = result.releaseResult?.rigid.every(x => x.pass) ?? false;
            return (
              <div className={`gate ${rigidPass ? 'pass' : 'fail'}`}>
                <span className="gate-mark">{rigidPass ? '✓' : '✗'}</span>
                <span className="gate-name">{lang === 'fa' ? 'رهاسازی بخش‌های سخت' : 'Rigid-part release'}</span>
                <span className="gate-detail">
                  {result.releaseResult?.rigid.map(x => `${x.part}: ${x.pass ? 'pass' : 'fail'}`).join(' · ') ?? 'unverified'}
                </span>
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
            ) : result.panels === 2 ? (
              <button className={`chip${layers.jacketB ? ' on' : ''}`} onClick={() => toggleLayer('jacketB')}>{t('layer.jacketB')}</button>
            ) : null}
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
