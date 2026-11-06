import { nowMs } from '../utils/nowMs';

/** A new id for the live snapshot of the game being played (Memory's
 *  autosave, useMemoryAutosave): one per play session, made when App
 *  mounts and on every new game or new position. */
export function newLiveSnapshotId(): string {
  return `live-${nowMs()}-${Math.random().toString(36).slice(2, 8)}`;
}
