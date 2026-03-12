import './App.css';
import type { BoardState, Move, SquareId } from './engine';
import { createStartingPosition } from './engine';
import { applyMove, generateLegalMoves } from './engine/moves';
import { toggleTopology, computeBoardLayout, tilePixelCenter } from './engine/auxetic';
import { RandomAgent } from './ai/agents';
import { useEffect, useMemo, useState } from 'react';
import type { GameLog } from './recording/log';
import { appendMove, appendTopologyToggle, createGameLog } from './recording/log';

type PlayerType = 'human' | 'random';

const BOARD_CONTAINER = 520;
const TILE_BASE = 65;

function App() {
  const [playerWhite, setPlayerWhite] = useState<PlayerType>('human');
  const [playerBlack, setPlayerBlack] = useState<PlayerType>('random');
  const [, setSeed] = useState<number>(1);
  const [state, setState] = useState<BoardState>(() => createStartingPosition(1));
  const [selected, setSelected] = useState<string | null>(null);
  const [legalMoves, setLegalMoves] = useState<Move[]>(() =>
    generateLegalMoves(createStartingPosition(1)),
  );
  const [log, setLog] = useState<GameLog>(() =>
    createGameLog('game-1', createStartingPosition(1), 1),
  );

  function startNewGame() {
    const newSeed = Date.now();
    const initial = createStartingPosition(newSeed);
    setSeed(newSeed);
    setState(initial);
    setSelected(null);
    setLegalMoves(generateLegalMoves(initial));
    setLog(createGameLog(`game-${newSeed}`, initial, newSeed));
  }

  function handleRotate() {
    const next = toggleTopology(state);
    setState(next);
    setLegalMoves(generateLegalMoves(next));
    setSelected(null);
    setLog((prev) => appendTopologyToggle(prev, next.topologyState));
  }

  const currentPlayer: PlayerType =
    state.sideToMove === 'white' ? playerWhite : playerBlack;

  useEffect(() => {
    async function maybePlayAgentMove() {
      if (currentPlayer !== 'random') return;
      const move = await RandomAgent.chooseMove(state, legalMoves);
      if (!move) return;
      const next = applyMove(state, move);
      setState(next);
      setLegalMoves(generateLegalMoves(next));
      setSelected(null);
      setLog((prev) => appendMove(prev, move));
    }
    void maybePlayAgentMove();
  }, [currentPlayer, state, legalMoves]);

  const highlightedTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    const targets = new Set<string>();
    for (const move of legalMoves) {
      if (move.from === selected && move.to) {
        targets.add(move.to);
      }
    }
    return targets;
  }, [legalMoves, selected]);

  function onSquareClick(square: string) {
    if (currentPlayer !== 'human') return;
    if (!selected) {
      setSelected(square);
      return;
    }
    if (selected === square) {
      setSelected(null);
      return;
    }
    const move = legalMoves.find(
      (m) => m.from === selected && m.to === square,
    );
    if (!move) {
      setSelected(square);
      return;
    }
    const next = applyMove(state, move);
    setState(next);
    setLegalMoves(generateLegalMoves(next));
    setSelected(null);
    setLog((prev) => appendMove(prev, move));
  }

  const squares = useMemo(() => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    return ranks.flatMap((rank) =>
      files.map((file) => `${file}${rank}`),
    );
  }, []);

  const layout = useMemo(
    () => computeBoardLayout(state.topologyState, BOARD_CONTAINER),
    [state.topologyState],
  );

  const scale = layout.tileSize / TILE_BASE;

  return (
    <div className="app-root">
      <header className="app-header">
        <h1>subutai</h1>
      </header>

      <main className="layout">
        <section className="board-panel">
          <div
            className="board"
            style={{ width: BOARD_CONTAINER, height: BOARD_CONTAINER }}
          >
            {squares.map((sq) => {
              const piece = state.pieces.get(sq as SquareId);
              const isDark =
                ((sq.charCodeAt(0) - 'a'.charCodeAt(0)) +
                  (Number(sq[1]) - 1)) %
                2 ===
                1;
              const isSelected = selected === sq;
              const isTarget = highlightedTargets.has(sq);

              const { cx, cy, angle } = tilePixelCenter(
                sq as SquareId,
                state.topologyState,
                layout,
              );

              const tx = cx - TILE_BASE / 2;
              const ty = cy - TILE_BASE / 2;

              return (
                <button
                  key={sq}
                  type="button"
                  className={[
                    'tile',
                    isDark ? 'dark' : 'light',
                    isSelected ? 'selected' : '',
                    isTarget ? 'target' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{
                    width: TILE_BASE,
                    height: TILE_BASE,
                    transform: `translate(${tx}px, ${ty}px) rotate(${angle}deg) scale(${scale})`,
                  }}
                  onClick={() => onSquareClick(sq)}
                >
                  {piece ? (
                    <span
                      className={[
                        'piece',
                        piece.color === 'white'
                          ? 'piece-white'
                          : 'piece-black',
                      ].join(' ')}
                      style={angle ? { transform: `rotate(${-angle}deg)` } : undefined}
                    >
                      {glyphForPiece(piece.color, piece.type)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="board-actions">
            <button
              type="button"
              className="rotate-btn"
              onClick={handleRotate}
            >
              Rotate board &middot; {state.topologyState === 'A' ? 'A \u2192 B' : 'B \u2192 A'}
            </button>
          </div>
        </section>

        <aside className="side-panel">
          <section>
            <h2>Players</h2>
            <div className="players">
              <label>
                White
                <select
                  value={playerWhite}
                  onChange={(e) =>
                    setPlayerWhite(e.target.value as PlayerType)
                  }
                >
                  <option value="human">Human</option>
                  <option value="random">Random</option>
                </select>
              </label>
              <label>
                Black
                <select
                  value={playerBlack}
                  onChange={(e) =>
                    setPlayerBlack(e.target.value as PlayerType)
                  }
                >
                  <option value="human">Human</option>
                  <option value="random">Random</option>
                </select>
              </label>
            </div>
          </section>

          <section>
            <h2>Topology</h2>
            <p className="topology-label">
              State <strong>{state.topologyState}</strong>
            </p>
          </section>

          <section className="move-log-section">
            <h2>Moves</h2>
            <div className="move-log">
              {log.moves.length === 0 ? (
                <p className="move-log-empty">No moves yet</p>
              ) : (
                <ol className="move-list">
                  {log.moves.map((entry, i) => (
                    <li key={i}>
                      {entry.move.from} &rarr; {entry.move.to}
                      {entry.topologyAfter
                        ? ` [\u2192${entry.topologyAfter}]`
                        : ''}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>

          <section>
            <button
              type="button"
              className="new-game-btn"
              onClick={startNewGame}
            >
              New Game
            </button>
          </section>
        </aside>
      </main>
    </div>
  );
}

function glyphForPiece(color: string, type: string): string {
  const map: Record<string, string> = {
    'white-pawn': '\u265F\uFE0E',
    'white-knight': '\u265E',
    'white-bishop': '\u265D',
    'white-rook': '\u265C',
    'white-queen': '\u265B',
    'white-king': '\u265A',
    'black-pawn': '\u265F\uFE0E',
    'black-knight': '\u265E',
    'black-bishop': '\u265D',
    'black-rook': '\u265C',
    'black-queen': '\u265B',
    'black-king': '\u265A',
  };
  return map[`${color}-${type}`] ?? '';
}

export default App;
