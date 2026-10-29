import { useState, useEffect } from 'react';
import { savedBgGrid, useStreaming } from '../../integrations';

/**
 * The music layer around the board: whether the dock is open, and the mic
 * equalizer and sound-grid flags. The board's pulse on the beat is the
 * integrations' own (integrations/music/boardPulse.ts). Without
 * STREAMING_UI the dock never opens and the mic never starts; a sound
 * grid saved on before v1.1.4 still shows.
 */
export function useMusicState() {
  const live = useStreaming();
  // SP — Spotify dock visibility + whether the mic equalizer runs
  // (the perimeter ring mounts only while it does).
  const [showMusicDock, setShowMusicDock] = useState(false);
  const [vizOn, setVizOn] = useState(false);
  useEffect(() => live?.micEq.onState(setVizOn), [live]);
  // M.15 — optional full-screen sound-grid background (toggled in the dock).
  const [bgGridOn, setBgGridOn] = useState(savedBgGrid);
  useEffect(() => live?.vizMode.onChange(setBgGridOn), [live]);
  return { showMusicDock, setShowMusicDock, vizOn, bgGridOn };
}
