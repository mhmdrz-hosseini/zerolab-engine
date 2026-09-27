// Bilingual fa/en dictionary + engine-string translation layer.
// UI strings use dict keys; engine-emitted strings (gates, warnings, progress
// stages, failure messages) are pattern-translated at display time with an
// English fallback — the engine itself stays English so the exported
// project.json / assembly.md artifacts remain machine-readable.
import { useMemo } from 'react';
import { useStore } from './state/store';

export type Lang = 'fa' | 'en';

const en = {
  'app.subtitle': 'Silicone pour box generator',
  'status.idle': 'idle',
  'status.ready': 'ready',
  'status.error': 'error',
  'status.working': 'working',
  'lang.switch': 'FA',
  'panel.error': 'Error',
  'panel.failure': 'Moldability failure',
  'failure.hint':
    'Red regions on the model trap the jacket on every candidate split axis (±{axis} was the best attempt). For shapes like this, try the 3-piece jacket with a smaller silicone gap.',
  'empty.title': 'No master loaded',
  'empty.hint':
    'Import a binary STL — analysis (watertight check, decimation, straight-pull ranking) runs automatically.',
  'import.title': '1 · Import master',
  'import.dropHint': 'Drop your master file here — STL / OBJ / GLB — or',
  'import.choose': 'Choose STL file',
  'import.privacy':
    'Analysis runs automatically after import. Nothing is uploaded — all geometry stays on this machine.',
  'import.clear': 'Clear',
  'analysis.title': '2 · Moldability analysis',
  'analysis.watertight': 'Watertight',
  'analysis.notWatertight': 'Not watertight',
  'analysis.tris': '{n}k tris → {m}k analysis',
  'analysis.volume': '{v} mL master',
  'analysis.th.axis': 'Pull axis',
  'analysis.th.trapped': 'Trapped rays',
  'analysis.th.layers': 'Max layers',
  'analysis.verdict': 'Proposed split: 2-piece planar, pull ±{axis}',
  'analysis.verdict.clean': ' — straight pull clean.',
  'analysis.verdict.trapped': ' — {p}% trapped rays, extraction sim will verify.',
  'analysis.generateBtn': 'Generate pour box — M2',
  'analysis.generateBtnTitle': 'The real generate button lives in the panel below',
  'gen.title': '3 · Size & build',
  'preset.small': 'Small detail',
  'preset.standard': 'Standard candle',
  'preset.rugged': 'Rugged',
  'fit.resin': 'Resin',
  'fit.calibrated': 'Calibrated FDM',
  'fit.standard': 'Standard FDM',
  'fit.loose': 'Loose FDM',
  'fit.hint.resin': '0.15 mm joint clearance',
  'fit.hint.calibrated': '0.25 mm joint clearance',
  'fit.hint.standard': '0.35 mm joint clearance',
  'fit.hint.loose': '0.45 mm joint clearance',
  'env.full': 'Full clearance',
  'env.tight': 'Tight hug',
  'env.note.full': 'V0.3 window — maximum release margin',
  'env.note.tight': '½-gap window — less silicone, test-print first',
  'wall.light': 'Light · 4 mm',
  'wall.standard': 'Standard · 5 mm',
  'wall.heavy': 'Heavy · 6.5 mm',
  'wall.note.light': 'audit-recommended body wall with reinforced rails',
  'wall.note.standard': 'V0.3 default — maximum margin',
  'wall.note.heavy': 'production / rough handling',
  'gen.ribs': 'Ribs',
  'gen.ribsTitle': 'four external 8 mm stiffening fins on the jacket body',
  'gen.mat.silicone': 'Silicone (PLA ok)',
  'gen.mat.hotWax': 'Hot wax (PETG)',
  'gen.matTitle.silicone': 'room-temperature RTV pour — PLA is fine',
  'gen.matTitle.hotWax': 'jacket stays on while pouring hot wax — print jackets in PETG/ASA',
  'gen.hardware': 'Hardware:',
  'gen.hardwareTitle':
    'Printed hardware (experimental): ZeroClips print in PETG and spring onto the seam-rail stations; defaults stay binder until physical coupons pass',
  'hw.binder': 'Binder clips',
  'hw.printed': 'ZeroClips',
  'hw.hybrid': 'Hybrid',
  'hw.hint.binder': 'legacy fastening — 25–32 mm binder clips on the rail stations',
  'hw.hint.printed': 'printed PETG spring clips at every station (experimental)',
  'hw.hint.hybrid': 'ZeroClips at stations + binder clips as filler (experimental)',
  'gen.baseLock': 'BaseLock',
  'gen.baseLockTitle':
    'two-piece collar capturing the jacket rim to the base plate (experimental — fail-soft)',
  'gen.generate': 'Generate silicone skin',
  'gen.regenerate': 'Regenerate',
  'gen.mlSilicone': 'mL silicone',
  'gen.split': 'Split ±{axis}',
  'gen.threePiece': ' · 3-piece (heavy half sub-split ±depth)',
  'gen.extract3': ' · extraction A {a}mm, B1 {b1}mm, B2 {b2}mm',
  'gen.extract2': ' · extraction A clears {a}mm, B {b}mm',
  'gen.elapsed': 'Generated in {s}s · jacket outer {d} mm',
  'gen.efficiency':
    'Silicone efficiency: requested {g} mm · median hug {p50} mm (min {min} · p90 {p90})',
  'gen.efficiency.excessTight': ' · excess ≈ {e} mL — Tight hug recovers part of it',
  'gen.efficiency.excess': ' · excess ≈ {e} mL',
  'gen.efficiency.onTarget': ' · on target',
  'gen.support': 'Support forecast: {list} unsupported @45° — details in assembly.md',
  'gen.release': '2-piece release confidence: {level}',
  'gen.release.detail': '{p}% trapped geometry along ±{axis}',
  'gen.release.detail3': '{p}% trapped geometry along ±{axis} — 3-piece build active',
  'gen.release.detailTest': '{p}% trapped geometry along ±{axis} — test-print before committing',
  'gen.threePieceBtn': 'Generate 3-piece jacket',
  'gen.threePieceBtnTitle':
    'sub-splits the trap-heavy half along ±depth so fold channels open sideways',
  'layer.master': 'Master',
  'layer.skin': 'Silicone',
  'layer.jacketA': 'Jacket A',
  'layer.jacketB': 'Jacket B',
  'layer.jacketB1': 'Jacket B1',
  'layer.jacketB2': 'Jacket B2',
  'layer.plate': 'Base plate',
  'layer.outer': 'Outer ghost',
  'gen.exportBtn': 'Build print package (zip)',
  'gen.download': 'Download {name}',
  'gen.exportBlocked': 'Export blocked — hard gate failed',
  'gen.couponBtn': 'Build fit coupon (calibration print)',
  'gen.couponBtnTitle':
    'small standalone calibration print: joint clearances, clip fits A–D, BaseLock segment — separate from the mold zip',
  'gen.downloadStl': 'Download {name} (STL)',
  'gen.fastening': '{n} clamp stations · mode {mode}',
  'gen.fastening.warn': ' · ⚠ {w}',
  'gen.fastening.default': '6–10 binder clips (25–32 mm) on the seam rail',
  'gen.package': 'Package: STL set, project.json, assembly sheet.',
  'view.explode': 'Exploded view',
  'view.schematic': 'Schematic',
  'view.real': 'Real',
  'size.sliderLabel': 'Largest mold dimension',
  'size.cm': 'cm',
  'size.preset.cupcake': 'Cupcake',
  'size.preset.small': 'Small',
  'size.preset.medium': 'Medium',
  'size.preset.large': 'Large',
  'size.preset.max': 'Printer max',
  'size.silicone': 'Silicone pour',
  'size.moldWeight': 'Printed mold',
  'size.masterWeight': 'Casting resin (master copy)',
  'size.dims': 'Mold outer: {d} mm',
  'size.estimateNote': 'estimates while dragging — regenerate for exact values',
  'size.smallHint':
    'At this scale the {g} mm gap is large relative to the model — the “Small detail” preset (6 mm) wastes less silicone.',
  'size.densityNote': 'mass ≈ volume × 1.2 g/cm³ (printed resin/PLA) · casting resin ≈ 1.13 g/cm³',
  'size.range': '6.5–20 cm — cupcake floor (20 mm master minimum), 20 cm printer cap per dimension',
};

export type Key = keyof typeof en;

const fa: Record<Key, string> = {
  'app.subtitle': 'سازنده‌ی قالب سیلیکونی',
  'status.idle': 'آماده‌ی شروع',
  'status.ready': 'آماده',
  'status.error': 'خطا',
  'status.working': 'در حال کار',
  'lang.switch': 'EN',
  'panel.error': 'خطا',
  'panel.failure': 'قالب‌گیری ممکن نشد',
  'failure.hint':
    'ناحیه‌های قرمز روی مدل، جکت را روی همه‌ی محورهای جداسازی گیر می‌اندازند (±{axis} بهترین تلاش بود). برای چنین شکل‌هایی، جکت سه‌تکه با گپ سیلیکون کوچک‌تر را امتحان کنید.',
  'empty.title': 'هنوز مدلی بارگذاری نشده',
  'empty.hint':
    'یک فایل STL باینری وارد کنید — تحلیل (آب‌بندی، ساده‌سازی، رتبه‌بندی محور جداشدن) خودکار اجرا می‌شود.',
  'import.title': '۱ · وارد کردن مستر',
  'import.dropHint': 'فایل مستر را اینجا رها کنید — STL / OBJ / GLB — یا',
  'import.choose': 'انتخاب فایل',
  'import.privacy':
    'بعد از وارد کردن، تحلیل خودکار اجرا می‌شود. هیچ‌چیز آپلود نمی‌شود — همه‌ی هندسه روی همین سیستم می‌ماند.',
  'import.clear': 'پاک کردن',
  'analysis.title': '۲ · تحلیل قالب‌گیری',
  'analysis.watertight': 'آب‌بند',
  'analysis.notWatertight': 'آب‌بند نیست',
  'analysis.tris': '{n} هزار مثلث → {m} هزار تحلیل',
  'analysis.volume': '{v} میلی‌لیتر مستر',
  'analysis.th.axis': 'محور جداشدن',
  'analysis.th.trapped': 'پرتوهای گیرکرده',
  'analysis.th.layers': 'بیشترین لایه',
  'analysis.verdict': 'برش پیشنهادی: دوتکه‌ی مسطح، جداشدن ±{axis}',
  'analysis.verdict.clean': ' — جداشدن مستقیم بدون مانع.',
  'analysis.verdict.trapped': ' — {p}٪ پرتو گیرکرده؛ شبیه‌سازی جداسازی تأیید می‌کند.',
  'analysis.generateBtn': 'ساخت قالب — به‌زودی',
  'analysis.generateBtnTitle': 'دکمه‌ی اصلی ساخت در پنل پایین است',
  'gen.title': '۳ · اندازه و ساخت',
  'preset.small': 'جزئیات ریز',
  'preset.standard': 'شمع استاندارد',
  'preset.rugged': 'ضدضربه',
  'fit.resin': 'رزین',
  'fit.calibrated': 'FDM کالیبره',
  'fit.standard': 'FDM معمولی',
  'fit.loose': 'FDM لق',
  'fit.hint.resin': 'کلیرنس مفصل 0.15 میلی‌متر',
  'fit.hint.calibrated': 'کلیرنس مفصل 0.25 میلی‌متر',
  'fit.hint.standard': 'کلیرنس مفصل 0.35 میلی‌متر',
  'fit.hint.loose': 'کلیرنس مفصل 0.45 میلی‌متر',
  'env.full': 'کلیرنس کامل',
  'env.tight': 'چسبیده',
  'env.note.full': 'پنجره‌ی V0.3 — بیشترین حاشیه‌ی جداشدن',
  'env.note.tight': 'پنجره‌ی نصف گپ — سیلیکون کمتر؛ اول چاپ آزمایشی',
  'wall.light': 'سبک · 4 mm',
  'wall.standard': 'استاندارد · 5 mm',
  'wall.heavy': 'سنگین · 6.5 mm',
  'wall.note.light': 'دیواره‌ی توصیه‌شده با ریل‌های تقویتی',
  'wall.note.standard': 'پیش‌فرض — بیشترین حاشیه',
  'wall.note.heavy': 'تولید / دست‌کاری زیاد',
  'gen.ribs': 'ریب‌ها',
  'gen.ribsTitle': 'چهار بالک تقویتی 8 میلی‌متری روی بدنه‌ی جکت',
  'gen.mat.silicone': 'سیلیکون (PLA کافیه)',
  'gen.mat.hotWax': 'موم داغ (PETG)',
  'gen.matTitle.silicone': 'ریختن RTV دمای اتاق — PLA کافی است',
  'gen.matTitle.hotWax': 'جکت هنگام ریختن موم داغ سر جا می‌ماند — جکت را با PETG/ASA چاپ کنید',
  'gen.hardware': 'سخت‌افزار:',
  'gen.hardwareTitle':
    'سخت‌افزار چاپی (آزمایشی): زیروکلیپ‌ها با PETG چاپ می‌شوند و روی ایستگاه‌های ریل درز فنری می‌شوند؛ پیش‌فرض تا پاس شدن کوپن فیزیکی گیره می‌ماند',
  'hw.binder': 'گیره',
  'hw.printed': 'زیروکلیپ',
  'hw.hybrid': 'ترکیبی',
  'hw.hint.binder': 'روش رایج — گیره‌های 25–32 میلی‌متری روی ایستگاه‌های ریل',
  'hw.hint.printed': 'کلیپ فنری PETG چاپی روی هر ایستگاه (آزمایشی)',
  'hw.hint.hybrid': 'زیروکلیپ روی ایستگاه‌ها + گیره به‌عنوان مکمل (آزمایشی)',
  'gen.baseLock': 'بیس‌لاک',
  'gen.baseLockTitle': 'کولار دوتکه‌ای که لبه‌ی جکت را به پلیت قفل می‌کند (آزمایشی — در خطا بی‌خطر)',
  'gen.generate': 'ساخت پوسته‌ی سیلیکونی',
  'gen.regenerate': 'ساخت دوباره',
  'gen.mlSilicone': 'میلی‌لیتر سیلیکون',
  'gen.split': 'برش ±{axis}',
  'gen.threePiece': ' · سه‌تکه (نیمه‌ی سنگین زیرتقسیم در عمق)',
  'gen.extract3': ' · جداسازی A {a}mm، B1 {b1}mm، B2 {b2}mm',
  'gen.extract2': ' · جداسازی A تا {a}mm، B تا {b}mm آزاد است',
  'gen.elapsed': 'ساخته شد در {s} ثانیه · ابعاد بیرونی جکت {d} میلی‌متر',
  'gen.efficiency':
    'بازده سیلیکون: گپ درخواستی {g} میلی‌متر · میانه‌ی چسبندگی {p50} (کمینه {min} · p90 {p90})',
  'gen.efficiency.excessTight': ' · اضافه ≈ {e} میلی‌لیتر — حالت چسبیده بخشی را پس می‌گیرد',
  'gen.efficiency.excess': ' · اضافه ≈ {e} میلی‌لیتر',
  'gen.efficiency.onTarget': ' · در هدف',
  'gen.support': 'پیش‌بینی ساپورت: {list} سطح بدون‌تکیه در 45 درجه — جزئیات در assembly.md',
  'gen.release': 'اطمینان جداشدن دوتکه: {level}',
  'gen.release.detail': '{p}٪ هندسه‌ی گیرکرده در راستای ±{axis}',
  'gen.release.detail3': '{p}٪ هندسه‌ی گیرکرده در راستای ±{axis} — حالت سه‌تکه فعال',
  'gen.release.detailTest': '{p}٪ هندسه‌ی گیرکرده در راستای ±{axis} — قبل از قطعی، چاپ آزمایشی',
  'gen.threePieceBtn': 'ساخت جکت سه‌تکه',
  'gen.threePieceBtnTitle':
    'نیمه‌ی پرگیر را در راستای عمق زیرتقسیم می‌کند تا کانال‌های تا‌خوردن باز شوند',
  'layer.master': 'مستر',
  'layer.skin': 'سیلیکون',
  'layer.jacketA': 'جکت A',
  'layer.jacketB': 'جکت B',
  'layer.jacketB1': 'جکت B1',
  'layer.jacketB2': 'جکت B2',
  'layer.plate': 'پلیت',
  'layer.outer': 'پوسته‌ی بیرونی (شفاف)',
  'gen.exportBtn': 'ساخت پکیج چاپ (zip)',
  'gen.download': 'دانلود {name}',
  'gen.exportBlocked': 'خروجی مسدود است — گیت سخت رد شده',
  'gen.couponBtn': 'ساخت کوپن کالیبراسیون',
  'gen.couponBtnTitle':
    'چاپ کالیبراسیون مستقل: کلیرنس مفصل‌ها، فیت کلیپ‌های A–D، سگمنت بیس‌لاک — جدا از زیپ قالب',
  'gen.downloadStl': 'دانلود {name} (STL)',
  'gen.fastening': '{n} ایستگاه گیره · حالت {mode}',
  'gen.fastening.warn': ' · ⚠ {w}',
  'gen.fastening.default': 'گیره‌های 6–10 عددی 25–32 میلی‌متری روی ریل درز',
  'gen.package': 'پکیج: ست STL، project.json، برگه‌ی اسمبلی.',
  'view.explode': 'نمای بازشده',
  'view.schematic': 'شماتیک',
  'view.real': 'واقعی',
  'size.sliderLabel': 'بزرگ‌ترین بعد قالب',
  'size.cm': 'سانتی‌متر',
  'size.preset.cupcake': 'کاپ‌کیک',
  'size.preset.small': 'کوچک',
  'size.preset.medium': 'متوسط',
  'size.preset.large': 'بزرگ',
  'size.preset.max': 'حداکثر چاپ',
  'size.silicone': 'سیلیکون موردنیاز',
  'size.moldWeight': 'قالب چاپی',
  'size.masterWeight': 'رزین ریخته‌گری (کپی مستر)',
  'size.dims': 'ابعاد بیرونی قالب: {d} میلی‌متر',
  'size.estimateNote': 'مقادیر هنگام کشیدن، برآورد هستند — برای عدد دقیق بسازید',
  'size.smallHint':
    'در این اندازه، گپ {g} میلی‌متری نسبت به مدل بزرگ است — پریست «جزئیات ریز» (6 میلی‌متر) سیلیکون کمتری هدر می‌دهد.',
  'size.densityNote': 'جرم ≈ حجم × 1.2 گرم بر سانتی‌متر مکعب (رزین/PLA چاپی) · رزین ریخته‌گری ≈ 1.13',
  'size.range': '۶٫۵ تا ۲۰ سانتی‌متر — کف کاپ‌کیک (کمینهٔ معتبر مستر 20 میلی‌متر)، سقف چاپ ۲۰ سانتی‌متر',
};

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

export function t(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  return interpolate(lang === 'fa' ? fa[key] : en[key], vars);
}

/** Hook: bound translator for the current UI language. */
export function useT() {
  const lang = useStore((s) => s.lang);
  return useMemo(() => {
    const fn = (key: Key, vars?: Record<string, string | number>) => t(lang, key, vars);
    fn.lang = lang;
    return fn;
  }, [lang]) as ((key: Key, vars?: Record<string, string | number>) => string) & { lang: Lang };
}

// ---- engine-string translation (display-time, pattern-based) ----

// static strings (progress stages, fixed warnings, gate names, failure text)
const FA_STATIC: Record<string, string> = {
  // worker/store progress stages
  'Reading file': 'خواندن فایل',
  'Parsing mesh': 'پارس مش',
  'Parsing STL': 'پارس STL',
  'Loading geometry kernel': 'بارگذاری هسته‌ی هندسه',
  'Kernel manifold check': 'بررسی منیفولد',
  'Topology not manifold — attempting SDF remesh repair': 'توپولوژی منیفولد نیست — تلاش برای ترمیم با SDF',
  'Decimating analysis mesh': 'ساده‌سازی مش تحلیل',
  'Building distance field': 'ساخت فیلد فاصله',
  'Distance field (exact BVH queries)': 'فیلد فاصله (کوئری‌های دقیق BVH)',
  'Lofting a smooth, releasable envelope around the master': 'ساخت پوسته‌ی نرم و جداشدنی دور مستر',
  'Building the third panel (sub-splitting the heavy half)': 'ساخت پنل سوم (زیرتقسیم نیمه‌ی سنگین)',
  'Building the glove and simulating extraction': 'ساخت دستکش و شبیه‌سازی جداسازی',
  'Simulating the release path': 'شبیه‌سازی مسیر جداشدن',
  'Simulating the release path (half B)': 'شبیه‌سازی مسیر جداشدن (نیمه‌ی B)',
  'Simulating the release path (sub-panels B1/B2)': 'شبیه‌سازی مسیر جداشدن (زیرپنل‌های B1/B2)',
  'Building the contoured base plate': 'ساخت پلیت کنتوردار',
  'Building ZeroClips': 'ساخت زیروکلیپ‌ها',
  'Building BaseLock collar': 'ساخت کولار بیس‌لاک',
  'Splitting jacket and simulating extraction': 'برش جکت و شبیه‌سازی جداسازی',
  'Running validation gates': 'اجرای گیت‌های اعتبارسنجی',
  Done: 'تمام',
  'Starting generate': 'شروع ساخت',
  'Building print package': 'ساخت پکیج چاپ',
  'Building fit coupon': 'ساخت کوپن کالیبراسیون',
  'Worker crashed': 'ورکر کرش کرد',
  // gate names
  'Open crown above the master': 'تاج باز بالای مستر',
  'Air escape through the open crown': 'خروج هوا از تاج باز',
  'Fill path reaches the gap': 'مسیر ریختن به گپ می‌رسد',
  'Silicone volume positive': 'حجم سیلیکون مثبت',
  'Master-to-jacket clearance audit': 'بررسی فاصله‌ی مستر تا جکت',
  // fixed warnings / notes
  'jacket comes closer to the master than the silicone gap — inspect the preview':
    'جکت از گپ سیلیکون به مستر نزدیک‌تر می‌شود — پیش‌نمایش را بررسی کنید',
  'quantized accessor extension present — decoding best-effort':
    'افزونه‌ی کوآنتایز در فایل هست — با بهترین تلاش خوانده شد',
  'BaseLock segment (4 notches): slide the collar corner over the rim corner — 0.6 mm slide clearances, 0.6 mm capture travel':
    'سگمنت بیس‌لاک (۴ شیار): گوشه‌ی کولار را روی گوشه‌ی لبه بلغزانید — کلیرنس لغزش 0.6 و کسرو 0.6 میلی‌متر',
  'No candidate axis produced an extractable 2-piece mold — the highlighted regions trap the jacket on every candidate axis':
    'هیچ محوری جداشدن دوتکه را ممکن نکرد — ناحیه‌های مشخص‌شده جکت را روی همه‌ی محورها گیر می‌اندازند',
  'No extractable 3-piece split — the sub-panels fragment into disconnected pieces on this shape at these settings. Try a smaller silicone gap (the sub-panels stay connected at gap ≤ ~6 on this model) or keep the 2-piece jacket with painted supports.':
    'جداشدن سه‌تکه ممکن نشد — زیرپنل‌ها روی این شکل با این تنظیمات به قطعات جدا می‌شوند. گپ سیلیکون کوچک‌تری امتحان کنید (زیرپنل‌ها در گپ ≈ 6 به‌هم متصل می‌مانند) یا جکت دوتکه با ساپورت نقاشی‌شده را نگه دارید.',
};

// dynamic patterns — first match wins; fallback = original English
type FaPattern = [RegExp, (...g: string[]) => string];
const FA_PATTERNS: FaPattern[] = [
  // gate names with labels
  [/^Jacket (A|B1|B2|B) seats on the plate$/, (l) => `جکت ${l} روی پلیت می‌نشیند`],
  [/^Printed part (\d+) non-empty$/, (n) => `قطعه‌ی چاپی ${n} خالی نیست`],
  // gate details
  [
    /^bottom at (-?[\d.]+) mm = plate top (-?[\d.]+)$/,
    (a, b) => `کف در ${a} میلی‌متر = سطح پلیت ${b}`,
  ],
  [
    /^bottom at (-?[\d.]+) mm vs plate top (-?[\d.]+) — hangs below the plate \(support waste\)$/,
    (a, b) => `کف در ${a} در برابر سطح پلیت ${b} — زیر پلیت آویزان است (هدررفت ساپورت)`,
  ],
  [
    /^bottom at (-?[\d.]+) mm vs plate top (-?[\d.]+) — floats above it$/,
    (a, b) => `کف در ${a} در برابر سطح پلیت ${b} — بالای پلیت شناور است`,
  ],
  // SDF grid progress
  [
    /^Distance field grid (\d+)×(\d+)×(\d+)$/,
    (a, b, c) => `گرید فیلد فاصله ${a}×${b}×${c}`,
  ],
  [
    /^Distance field done \(([\d,]+) exact queries\)$/,
    (n) => `فیلد فاصله تمام شد (${n} کوئری دقیق)`,
  ],
  // split ladder progress
  [
    /^Splitting along ±([XYZ]) \(candidate (\d+)\/(\d+)\)$/,
    (ax, i, n) => `برش در راستای ±${ax} (نامزد ${i} از ${n})`,
  ],
  [/^Rejected ±([XYZ]): (.+)$/, (ax, r) => `رد شد ±${ax}: ${r}`],
  [
    /^No 2-piece split extracted — retrying ±([XYZ]) as a 3-piece jacket$/,
    (ax) => `جداشدن دوتکه نشد — تلاش مجدد ±${ax} به‌صورت جکت سه‌تکه`,
  ],
  [
    /^jacket top ([\d.]+) mm, master top ([\d.]+) mm, freeboard ([\d.]+) mm$/,
    (a, b, c) => `بالای جکت ${a}، بالای مستر ${b}، ارتفاع آزاد ${c} میلی‌متر`,
  ],
  [/^Open crown; (\d+) optional wall outlet\(s\)$/, (n) => `تاج باز؛ ${n} خروجی دیواری اختیاری`],
  [
    /^([\d.]+)% of cavity volume connected to the open crown \((\d+)\/(\d+) cells\)$/,
    (p, r, t2) => `${p}٪ حجم حفره به تاج باز متصل است (${r}/${t2} سلول)`,
  ],
  [/^([\d.]+) mL$/, (v) => `${v} میلی‌لیتر`],
  [/^(\d+) tris$/, (n) => `${n} مثلث`],
  [
    /^sampled minimum=([\d.]+) p10=([\d.]+) p50=([\d.]+) p90=([\d.]+) mm \(target ≥ ([\d.]+)\) (✓|⚠)$/,
    (min, p10, p50, p90, tgt, mark) =>
      `نمونه‌گیری: کمینه ${min} · p10 ${p10} · p50 ${p50} · p90 ${p90} میلی‌متر (هدف ≥ ${tgt}) ${mark}`,
  ],
  [
    /^(.*) — tight-hug envelope: advisory \(extraction sim remains the hard gate\)$/,
    (base) => `${base} — پاکت چسبیده: توصیه‌ای (شبیه‌سازی جداسازی همچنان گیت سخت است)`,
  ],
  // analysis warnings
  [
    /^Mesh has (\d+) boundary edges \(holes\) — repair lands in V0\.2$/,
    (n) => `مش ${n} یال مرزی (سوراخ) دارد — ترمیم در نسخه‌های بعدی`,
  ],
  [
    /^([\d.]+)k triangles — analysis decimated to ([\d.]+)k$/,
    (n, m) => `${n} هزار مثلث — تحلیل به ${m} هزار ساده‌سازی شد`,
  ],
  [
    /^Best pull axis ([XYZ]) still traps ([\d.]+)% of rays — expect extraction issues$/,
    (ax, p) => `بهترین محور جداشدن ${ax} هنوز ${p}٪ پرتوها را گیر می‌اندازد — انتظار مشکل در جداسازی`,
  ],
  [
    /^master normalized ×([\d.]+) to a 150 mm default height \(was ([\d.]+) units\) — CONFIRM THE REAL SIZE before printing; pass the true dimensions if these are not mm$/,
    (k, s) =>
      `مستر ×${k} نرمال‌سازی شد (ارتفاع پیش‌فرض 150 میلی‌متر؛ قبلاً ${s} واحد) — قبل از چاپ، اندازه‌ی واقعی را در پنل ساخت تأیید کنید`,
  ],
  [
    /^GLB coordinates looked like meters — scaled ×1000\. Confirm the physical size before generating\.$/,
    () => 'مختصات GLB متر به نظر می‌رسید — ×1000 مقیاس شد. قبل از ساخت، اندازه‌ی واقعی را تأیید کنید.',
  ],
  // split / hardware warnings
  [
    /^3-piece: heavy side is ([+−-])([XYZ]) \((\d+) of (\d+) trapped verts\) — sub-splitting it along ±([XYZ])$/,
    (sign, ax, n, d, dep) =>
      `سه‌تکه: سمت سنگین ${sign}${ax} (${n} از ${d} رأس گیرکرده) — زیرتقسیم در راستای ±${dep}`,
  ],
  [
    /^ZeroClips skipped: (.+) — fewer than 2 usable stations, falling back to binder clamps$/,
    (r) => `زیروکلیپ رد شد: ${r} — کمتر از ۲ ایستگاه قابل‌استفاده؛ بازگشت به گیره`,
  ],
  [
    /^ZeroClips: skipped (.+) \((.+)\) — the remaining (\d+) stations hold the seam; add binder clips between them$/,
    (sk, r, n) => `زیروکلیپ: ${sk} رد شد (${r}) — ${n} ایستگاه باقی درز را نگه می‌دارند؛ بینشان گیره اضافه کنید`,
  ],
  [/^BaseLock disabled: (.+)$/, (r) => `بیس‌لاک غیرفعال شد: ${r}`],
  [/^jacket ≈ ([\d×.]+) mm — check printer bed$/, (d) => `جکت ≈ ${d} میلی‌متر — بستر پرینتر را چک کنید`],
  [
    /^base plate ≈ ([\d×.]+) mm — may exceed the bed$/,
    (d) => `پلیت ≈ ${d} میلی‌متر — ممکن است از بستر بزرگ‌تر باشد`,
  ],
  [
    /^([\d.]+)% of the cavity is not directly connected to the crown — cured silicone may trap voids there$/,
    (p) => `${p}٪ حفره به تاج متصل نیست — سیلیکون سفت‌شده ممکن است آنجا حفره بگیرد`,
  ],
  [
    /^hug band outside audit targets \(min ([\d.]+) p50 ([\d.]+) vs gap ([\d.]+)\) — acceptable only after a test print$/,
    (min, p50, g) => `باند چسبندگی خارج از هدف (کمینه ${min} · p50 ${p50} در برابر گپ ${g}) — فقط بعد از چاپ آزمایشی قابل قبول`,
  ],
  [/^usable seam rail ≈ ([\d.]+) mm — too short for planned clamp stations; clamp manually$/,
    (r) => `ریل قابل‌استفاده ≈ ${r} میلی‌متر — برای ایستگاه‌های گیره کوتاه است؛ دستی گیره بزنید`],
  // parsers
  [/^(\d+) degenerate or malformed faces dropped$/, (n) => `${n} وجه معیوب حذف شد`],
  [/^(\d+) non-triangle primitives skipped$/, (n) => `${n} پریمیتیو غیرمثلثی رد شد`],
  // coupon notes
  [
    /^joint sample (\d+) notch\(es\): clearance ([\d.]+) mm — slide the ridge into the slot$/,
    (i, c) => `نمونه‌ی مفصل ${i}: کلیرنس ${c} میلی‌متر — لبه را در شیار بلغزانید`,
  ],
  [
    /^clip sample (\d+) notch\(es\): interference ([\d.]+) mm — spring it onto the stub, radial gap first$/,
    (i, c) => `نمونه‌ی کلیپ ${i}: اینترفیرنس ${c} میلی‌متر — با گپ شعاعی اول، روی زائده فنر کنید`,
  ],
  // input rejection prefixes
  [
    /^Input rejected: (.+)$/,
    (r) => `ورودی رد شد: ${r}`,
  ],
  [
    /^([\d.]+)M triangles exceeds the 5M hard limit — regenerate at lower detail$/,
    (n) => `${n} میلیون مثلث از سقف ۵ میلیون می‌گذرد — با جزئیات کمتر بسازید`,
  ],
];

export function te(lang: Lang, s: string): string {
  if (lang !== 'fa') return s;
  if (FA_STATIC[s]) return FA_STATIC[s];
  for (const [re, render] of FA_PATTERNS) {
    const m = s.match(re);
    if (m) return render(...m.slice(1));
  }
  return s;
}

export function applyDocumentLang(lang: Lang): void {
  document.documentElement.lang = lang === 'fa' ? 'fa' : 'en';
  document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
}
