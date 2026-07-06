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
    // M.28 — building blocks of the TempoCNN mel extractor.
    FrameGenerator(
      audio: Float32Array,
      frameSize?: number,
      hopSize?: number,
    ): { size(): number; get(i: number): unknown; delete?(): void };
    Windowing(
      frame: unknown,
      normalized?: boolean,
      size?: number,
      type?: string,
      zeroPadding?: number,
      zeroPhase?: boolean,
    ): { frame: unknown };
    Spectrum(frame: unknown, size?: number): { spectrum: unknown };
    MelBands(
      spectrum: unknown,
      highFrequencyBound?: number,
      inputSize?: number,
      log?: boolean,
      lowFrequencyBound?: number,
      normalize?: string,
      numberBands?: number,
      sampleRate?: number,
      type?: string,
      warpingFormula?: string,
      weighting?: string,
    ): { bands: unknown };
  };
  export default Essentia;
}

declare module 'essentia.js/dist/essentia-wasm.es.js' {
  export const EssentiaWASM: unknown;
}
