// M.22 — essentia.js ships UMD typings only for its index; we deep-import
// the ES builds (core + inlined-WASM) for clean Vite chunking. Loose types
// are fine: the worker wraps everything in one narrow API.
declare module 'essentia.js/dist/essentia.js-core.es.js' {
  const Essentia: new (wasm: unknown) => {
    arrayToVector(arr: Float32Array): unknown;
    vectorToArray(vec: unknown): Float32Array;
    RhythmExtractor2013(
      signal: unknown,
      maxTempo?: number,
      method?: string,
      minTempo?: number,
    ): { bpm: number; confidence: number; ticks: unknown };
  };
  export default Essentia;
}

declare module 'essentia.js/dist/essentia-wasm.es.js' {
  export const EssentiaWASM: unknown;
}
