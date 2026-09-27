// App state — meshes live ONLY in the worker; the store holds the analysis
// report and transferred result arrays for rendering.
import { create } from 'zustand';
import type { AnalysisReport, GenerateParams, GenerateResult, MeshArrays, WorkerResponse } from '../engine/types';
import { applyDocumentLang, type Lang } from '../i18n';

export type Phase = 'idle' | 'busy' | 'ready' | 'error';

export interface Layers {
  master: boolean;
  skin: boolean;
  outer: boolean;
  jacketA: boolean;
  jacketB: boolean;
  jacketB1: boolean;
  jacketB2: boolean;
  plate: boolean;
}

export interface FailureInfo {
  axis: string;
  message: string;
  trapFlags?: Uint8Array;
}

interface StoreState {
  lang: Lang;
  setLang: (l: Lang) => void;
  phase: Phase;
  progress: { stage: string; pct: number } | null;
  error: string | null;
  failure: FailureInfo | null;
  fileName: string | null;
  report: AnalysisReport | null;
  preview: MeshArrays | null;
  result: GenerateResult | null;
  layers: Layers;
  exportUrl: string | null;
  exportName: string | null;
  couponUrl: string | null;
  couponName: string | null;
  couponNotes: string[];
  ingest: (file: File) => void;
  ingestBytes: (bytes: ArrayBuffer, name: string) => void;
  generate: (params: GenerateParams) => void;
  exportPkg: () => void;
  requestCoupon: () => void;
  toggleLayer: (k: keyof Layers) => void;
  reset: () => void;
}

let worker: Worker | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/geometry.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      useStore.setState({ phase: 'busy', progress: { stage: msg.stage, pct: msg.pct } });
    } else if (msg.type === 'analysis') {
      useStore.setState({ phase: 'ready', progress: null, report: msg.report, preview: msg.preview, error: null, result: null });
    } else if (msg.type === 'result') {
      useStore.setState(() => ({
        phase: 'ready',
        progress: null,
        result: msg.result,
        layers: { master: true, skin: true, outer: false, jacketA: false, jacketB: false, jacketB1: false, jacketB2: false, plate: false },
      }));
    } else if (msg.type === 'failure') {
      useStore.setState({
        phase: 'ready',
        progress: null,
        failure: { axis: msg.axis, message: msg.message, trapFlags: msg.trapFlags },
        layers: { ...useStore.getState().layers, master: true, skin: false, jacketA: false, jacketB: false, jacketB1: false, jacketB2: false, plate: false },
      });
    } else if (msg.type === 'export') {
      const url = URL.createObjectURL(new Blob([msg.blob], { type: 'application/zip' }));
      useStore.setState({ exportUrl: url, exportName: msg.fileName, progress: null });
    } else if (msg.type === 'coupon') {
      const url = URL.createObjectURL(new Blob([msg.blob], { type: 'model/stl' }));
      useStore.setState({ couponUrl: url, couponName: msg.fileName, couponNotes: msg.notes, progress: null });
    } else if (msg.type === 'error') {
      useStore.setState({ phase: 'error', progress: null, error: msg.message });
    }
  };
  worker.onerror = (e) => {
    useStore.setState({ phase: 'error', progress: null, error: e.message || 'Worker crashed' });
  };
  return worker;
}

export const useStore = create<StoreState>((set) => ({
  lang: 'fa',
  setLang: (l) => {
    applyDocumentLang(l);
    set({ lang: l });
  },
  phase: 'idle',
  progress: null,
  error: null,
  fileName: null,
  report: null,
  preview: null,
  result: null,
  failure: null,
  exportUrl: null,
  exportName: null,
  couponUrl: null,
  couponName: null,
  couponNotes: [],
  layers: { master: true, skin: true, outer: false, jacketA: false, jacketB: false, jacketB1: false, jacketB2: false, plate: false },
  ingest: (file) => {
    void file.arrayBuffer().then((bytes) => {
      useStore.getState().ingestBytes(bytes, file.name);
    });
  },
  ingestBytes: (bytes, name) => {
    set({ phase: 'busy', progress: { stage: 'Reading file', pct: 0 }, error: null, report: null, preview: null, result: null, failure: null, exportUrl: null, exportName: null, fileName: name });
    getWorker().postMessage({ type: 'ingest', fileName: name, bytes }, [bytes]);
  },
  generate: (params) => {
    set({ phase: 'busy', progress: { stage: 'Starting generate', pct: 0 }, error: null, failure: null, exportUrl: null, exportName: null });
    getWorker().postMessage({ type: 'generate', params });
  },
  exportPkg: () => {
    set({ phase: 'busy', progress: { stage: 'Building print package', pct: 0.5 }, error: null });
    getWorker().postMessage({ type: 'export' });
  },
  requestCoupon: () => {
    set({ phase: 'busy', progress: { stage: 'Building fit coupon', pct: 0.5 }, error: null });
    getWorker().postMessage({ type: 'coupon' });
  },
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  reset: () => set({ phase: 'idle', progress: null, error: null, failure: null, report: null, preview: null, result: null, exportUrl: null, exportName: null, couponUrl: null, couponName: null, couponNotes: [], layers: { master: true, skin: true, outer: false, jacketA: false, jacketB: false, jacketB1: false, jacketB2: false, plate: false } }),
}));
