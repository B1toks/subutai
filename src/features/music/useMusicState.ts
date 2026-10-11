import { useState, useEffect } from 'react';
import { micEq } from '../../audio/micEqualizer';
import { vizMode } from '../../music/vizMode';
import { beatEngine } from '../../music/beatEngine';
import { liveBpm } from '../../music/liveBpm';
import { beatBridge } from '../../music/beatBridge';

/**
 * The music layer around the board: whether the dock is open, the mic
 * equalizer and sound-grid flags, and the board's pulse on the beat (or
 * on a tap that hits it). The pulse writes a class on .board-with-coords
 * directly, so it works with the dock closed.
 */
export function useMusicState() {
  // SP — Spotify dock visibility + whether the mic equalizer runs
  // (the perimeter ring mounts only while it does).
  const [showMusicDock, setShowMusicDock] = useState(false);
  const [vizOn, setVizOn] = useState(false);
  useEffect(() => micEq.onState(setVizOn), []);
  // M.15 — optional full-screen sound-grid background (toggled in the dock).
  const [bgGridOn, setBgGridOn] = useState(() => vizMode.isBgGrid());
  useEffect(() => vizMode.onChange(setBgGridOn), []);
  // M.10 — on-beat board pulse lives at App level (not in the dock) so
  // the board keeps reacting even when the music dock is closed or
  // minimised, as long as the beat grid is running.
  useEffect(() => {
    const pulseBoard = () => {
      const board = document.querySelector('.board-with-coords');
      if (!board) return;
      board.classList.remove('beat-tick');
      void (board as HTMLElement).offsetWidth; // restart the animation
      board.classList.add('beat-tick');
    };
    const offBeat = beatEngine.onBeat(() => {
      // M.21 — 'onmove' pulse mode: the ambient heartbeat rests; the
      // board reacts only when the PLAYER hits the beat (below).
      if (vizMode.getPulseMode() === 'onmove') return;
      // M.18 — live capture hearing silence ⇒ pause the visual heartbeat.
      // The grid keeps counting (a track pause/drop doesn't lose the lock);
      // only the pulse waits for the music to come back. File/Spotify
      // playback doesn't run the live detector, so it's unaffected.
      if (liveBpm.isRunning() && liveBpm.isSilent()) return;
      pulseBoard();
    });
    // M.21 — in tap mode an on-beat hit IS the pulse: the board answers
    // the player, not the metronome.
    const offMove = beatBridge.onMove((e) => {
      if (vizMode.getPulseMode() !== 'onmove') return;
      if (e.score === 'off') return;
      pulseBoard();
    });
    // M.21.1 — tap mode: ANY tap on the board is a rhythm hit. Scored in
    // beatBridge (points + streak); the onMove subscription above turns a
    // successful hit into the pulse. pointerdown (not click) so the hit
    // registers at touch time — rhythm can't wait for pointerup.
    const onPointerDown = (ev: PointerEvent) => {
      if (vizMode.getPulseMode() !== 'onmove') return;
      const target = ev.target as Element | null;
      if (!target?.closest('.board-with-coords')) return;
      beatBridge.reportTap();
    };
    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    return () => {
      offBeat();
      offMove();
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);
  return { showMusicDock, setShowMusicDock, vizOn, bgGridOn };
}
