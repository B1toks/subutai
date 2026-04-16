import type { SerializedBoardState } from '../engine';

export async function sendToGlobalMemory(state: SerializedBoardState): Promise<void> {
  // TODO: Replace with actual university server endpoint once provided.
  console.log('[GlobalMemory] payload ready:', JSON.stringify(state));
}
