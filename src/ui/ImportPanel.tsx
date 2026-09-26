import { useRef, useState } from 'react';
import { useStore } from '../state/store';

export function ImportPanel() {
  const ingest = useStore((s) => s.ingest);
  const fileName = useStore((s) => s.fileName);
  const phase = useStore((s) => s.phase);
  const reset = useStore((s) => s.reset);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const take = (file: File | undefined | null) => {
    if (file) ingest(file);
  };

  return (
    <section
      className={`panel dropzone${dragOver ? ' over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); take(e.dataTransfer.files?.[0]); }}
    >
      <div className="panel-title">1 · Import master</div>
      <input ref={inputRef} type="file" accept=".stl,.obj,.glb,model/stl,model/gltf-binary" hidden onChange={(e) => take(e.target.files?.[0])} />
      {fileName ? (
        <div className="file-row">
          <span className="file-name" title={fileName}>{fileName}</span>
          <button className="btn ghost" onClick={() => { reset(); inputRef.current && (inputRef.current.value = ''); }}>
            Clear
          </button>
        </div>
      ) : (
        <>
          <p className="hint">Drop a <b>STL / OBJ / GLB</b> master here, or</p>
          <button className="btn primary" onClick={() => inputRef.current?.click()} disabled={phase === 'busy'}>
            Choose STL file
          </button>
          <p className="hint dim">Analysis runs automatically after import. Nothing is uploaded — all geometry stays on this machine.</p>
        </>
      )}
    </section>
  );
}
