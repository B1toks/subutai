import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cast, GripVertical, PanelRight, X } from 'lucide-react';
import { Icon } from './Icon';
import { twitchChat, type TwitchChatMessage, type TwitchChatStatus } from '../twitch/chat';
import {
  applyPrediction,
  emptyPredictions,
  tally,
  winnersFor,
  type GameResult,
  type PredictionState,
} from '../twitch/predictions';
import { moveVoting, type ViewerScore, type VoteMode, type VoteRound } from '../twitch/moveVoting';
import { loadEmoteMap, type EmoteMap } from '../twitch/seventv';

const CHANNEL_KEY = 'subutai_twitch_channel';
const POS_KEY = 'subutai_twitch_pos';
const MAX_MESSAGES = 60;
const LEADERBOARD_SIZE = 10;

interface TwitchPanelProps {
  /** Changes on every new game — clears votes + the leaderboard. */
  gameKey: string;
  /** Null while the game runs; set once when it ends. */
  gameResult: GameResult | null;
  onClose: () => void;
}

/** Message text with 7TV emote tokens swapped for <img> tags. */
function EmoteText({ text, emotes }: { text: string; emotes: EmoteMap | null }) {
  const parts = useMemo(() => {
    if (!emotes || emotes.size === 0) return [text];
    const out: (string | { name: string; url: string })[] = [];
    let buf: string[] = [];
    for (const word of text.split(' ')) {
      const url = emotes.get(word);
      if (url) {
        if (buf.length) out.push(buf.join(' ') + ' ');
        buf = [];
        out.push({ name: word, url });
        out.push(' ');
      } else {
        buf.push(word);
      }
    }
    if (buf.length) out.push(buf.join(' '));
    return out;
  }, [text, emotes]);

  return (
    <span className="twitch-msg-text">
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          p
        ) : (
          <img key={i} className="twitch-emote" src={p.url} alt={p.name} title={p.name} loading="lazy" />
        ),
      )}
    </span>
  );
}

/* M.13 — memoised chat row. The feed re-renders every 300ms flush; on a
 * busy channel that's 60 emote-laden rows re-rendering several times a
 * second, which saturated the main thread and froze the panel (so the
 * scoring "stopped"). memo() means only the NEW rows in a batch render —
 * existing message objects keep their reference, so React skips them. */
const TwitchMessageRow = memo(function TwitchMessageRow({
  msg,
  emotes,
}: {
  msg: TwitchChatMessage;
  emotes: EmoteMap | null;
}) {
  return (
    <div className="twitch-msg">
      <span className="twitch-msg-nick" style={msg.color ? { color: msg.color } : undefined}>
        {msg.displayName}
      </span>
      <EmoteText text={msg.text} emotes={emotes} />
    </div>
  );
});

/**
 * T3/T4/T5 — Twitch overlay: live chat (with 7TV emotes), per-move
 * vote rounds (predict / chat-plays-the-AI), result calls, and a
 * match leaderboard. Freely draggable by the header — the first brick
 * of the stream-layout constructor.
 */
export function TwitchPanel({ gameKey, gameResult, onClose }: TwitchPanelProps) {
  const [channelInput, setChannelInput] = useState(() => {
    try {
      return localStorage.getItem(CHANNEL_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [status, setStatus] = useState<TwitchChatStatus>(twitchChat.getStatus());
  const [statusDetail, setStatusDetail] = useState<string>('');
  const [messages, setMessages] = useState<TwitchChatMessage[]>([]);
  const [counts, setCounts] = useState({ white: 0, black: 0, draw: 0 });
  const [voteMode, setVoteMode] = useState<VoteMode>(() => moveVoting.getMode());
  const [round, setRound] = useState<VoteRound | null>(() => moveVoting.getRound());
  const [roundNow, setRoundNow] = useState(() => Date.now());
  const [scores, setScores] = useState<ViewerScore[]>(() => moveVoting.getScores());
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [emotes, setEmotes] = useState<EmoteMap | null>(null);
  // M.13 — dock to the RIGHT edge (Spotify left, chat right stream layout).
  const [dockedRight, setDockedRight] = useState(() => {
    try { return localStorage.getItem('subutai_twitch_docked') === '1'; } catch { return false; }
  });
  const predictionsRef = useRef<PredictionState>(emptyPredictions());
  const feedRef = useRef<HTMLDivElement | null>(null);

  // ── chat plumbing (buffered: big channels push 50+ msg/s) ──
  const pendingRef = useRef<TwitchChatMessage[]>([]);
  useEffect(() => {
    const offMsg = twitchChat.onMessage((msg) => {
      pendingRef.current.push(msg);
      if (pendingRef.current.length > MAX_MESSAGES) {
        pendingRef.current = pendingRef.current.slice(-MAX_MESSAGES);
      }
      applyPrediction(predictionsRef.current, msg);
    });
    const offStatus = twitchChat.onStatus((s, detail) => {
      setStatus(s);
      setStatusDetail(detail ?? '');
    });
    const flush = setInterval(() => {
      if (pendingRef.current.length === 0) return;
      const batch = pendingRef.current;
      pendingRef.current = [];
      setMessages((cur) => {
        const next = [...cur, ...batch];
        return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
      });
      setCounts(tally(predictionsRef.current));
    }, 300);
    return () => {
      offMsg();
      offStatus();
      clearInterval(flush);
    };
  }, []);

  // ── vote rounds + scores ──
  useEffect(() => {
    const offRound = moveVoting.onRound(setRound);
    const offScores = moveVoting.onScores(setScores);
    return () => {
      offRound();
      offScores();
    };
  }, []);

  // Countdown tick while a round is open.
  useEffect(() => {
    if (!round || round.revealIdx !== null) return;
    const id = setInterval(() => setRoundNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [round]);

  // New game — votes, scores and banners reset; chat history stays.
  // setState-in-effect is intentional: this fires once per game change
  // (rare), and the reset must also touch refs + the external voting
  // store, so the render-phase "adjust state from props" pattern can't
  // express it without double-mutating the store under StrictMode.
  useEffect(() => {
    predictionsRef.current = emptyPredictions();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCounts({ white: 0, black: 0, draw: 0 });
    setShowLeaderboard(false);
    moveVoting.resetScores();
  }, [gameKey]);

  // Game ended — award result calls (+3) and show the leaderboard.
  // Same rationale as above: a once-per-game external-store mutation.
  useEffect(() => {
    if (!gameResult) return;
    moveVoting.awardResultCall(winnersFor(predictionsRef.current, gameResult));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowLeaderboard(true);
  }, [gameResult]);

  // 7TV emotes for the connected channel.
  useEffect(() => {
    if (status !== 'connected') return;
    const ch = twitchChat.getChannel();
    if (!ch) return;
    let cancelled = false;
    void loadEmoteMap(ch).then((map) => {
      if (!cancelled) setEmotes(map);
    });
    return () => {
      cancelled = true;
    };
  }, [status]);

  // Stick to the newest message.
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // ── free drag (desktop) — header is the handle ──
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      return raw ? (JSON.parse(raw) as { x: number; y: number }) : null;
    } catch {
      return null;
    }
  });
  const panelRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  const onDragStart = useCallback((e: React.PointerEvent) => {
    if (window.innerWidth <= 720) return; // bottom sheet on mobile
    const panel = panelRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch { /* synthetic/stale pointer — capture is best-effort */ }

    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const w = panel.offsetWidth;
      // Keep at least the header on screen — a fully off-screen panel
      // is unrecoverable without the double-click reset.
      const x = Math.max(0, Math.min(ev.clientX - d.dx, window.innerWidth - w));
      const y = Math.max(0, Math.min(ev.clientY - d.dy, window.innerHeight - 48));
      lastPosRef.current = { x, y };
      setPos({ x, y });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (lastPosRef.current) {
        try {
          localStorage.setItem(POS_KEY, JSON.stringify(lastPosRef.current));
        } catch { /* private mode */ }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  function resetPos() {
    setPos(null);
    try {
      localStorage.removeItem(POS_KEY);
    } catch { /* private mode */ }
  }

  function connect() {
    const ch = channelInput.trim();
    if (!ch) return;
    try {
      localStorage.setItem(CHANNEL_KEY, ch);
    } catch { /* private mode */ }
    setMessages([]);
    setEmotes(null);
    twitchChat.connect(ch);
  }

  function pickMode(m: VoteMode) {
    moveVoting.setMode(m);
    setVoteMode(m);
  }

  const connected = status === 'connected';
  const secondsLeft = round && round.revealIdx === null
    ? Math.max(0, Math.ceil((round.endsAt - roundNow) / 1000))
    : 0;

  const panelStyle: React.CSSProperties | undefined = dockedRight
    ? undefined
    : pos && window.innerWidth > 720
      ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
      : undefined;

  // Portal to <body>: ancestors inside the app shell carry transforms
  // (3D tilt, eval-gradient layers), which turn position:fixed into
  // "fixed relative to the transformed box" and break both the default
  // placement and drag math.
  return createPortal(
    <aside
      className={`twitch-panel${dockedRight ? ' is-docked-right' : ''}`}
      ref={panelRef}
      style={panelStyle}
      aria-label="Twitch chat"
    >
      <div
        className="twitch-panel-header twitch-drag-handle"
        onPointerDown={onDragStart}
        onDoubleClick={resetPos}
        title="Drag to move · double-click to reset position"
      >
        <span className="twitch-panel-title">
          <Icon icon={GripVertical} size="sm" aria-hidden />
          <Icon icon={Cast} size="md" aria-hidden /> Twitch
          {connected && twitchChat.getChannel() && (
            <span className="twitch-channel-name">#{twitchChat.getChannel()}</span>
          )}
        </span>
        <span className="twitch-header-actions">
          <button
            type="button"
            className={`twitch-close-btn${dockedRight ? ' is-on' : ''}`}
            onClick={() => {
              setDockedRight((v) => {
                const next = !v;
                try { localStorage.setItem('subutai_twitch_docked', next ? '1' : '0'); } catch { /* private */ }
                return next;
              });
            }}
            aria-label={dockedRight ? 'Float Twitch panel' : 'Dock to right edge'}
            title={dockedRight ? 'Float (free position)' : 'Dock to the right side'}
          >
            <Icon icon={PanelRight} size="sm" aria-hidden />
          </button>
          <button type="button" className="twitch-close-btn" onClick={onClose} aria-label="Close Twitch panel">
            <Icon icon={X} size="sm" aria-hidden />
          </button>
        </span>
      </div>

      {!connected && (
        <div className="twitch-connect-row">
          <input
            type="text"
            className="twitch-channel-input"
            placeholder="channel name"
            value={channelInput}
            onChange={(e) => setChannelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') connect();
            }}
          />
          <button
            type="button"
            className="twitch-connect-btn"
            onClick={connect}
            disabled={status === 'connecting' || !channelInput.trim()}
          >
            {status === 'connecting' ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      )}
      {status === 'error' && (
        <div className="twitch-status twitch-status-error">{statusDetail || 'Connection error'}</div>
      )}
      {status === 'connecting' && statusDetail && (
        <div className="twitch-status">{statusDetail}</div>
      )}

      {connected && (
        <>
          {/* T4 — move-vote mode selector */}
          <div className="twitch-mode-row" role="radiogroup" aria-label="Move voting mode">
            {(['off', 'predict', 'chat'] as VoteMode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={voteMode === m}
                className={`twitch-mode-pill${voteMode === m ? ' is-active' : ''}`}
                onClick={() => pickMode(m)}
              >
                {m === 'off' ? 'Off' : m === 'predict' ? 'Predict' : 'Chat plays'}
              </button>
            ))}
          </div>

          {/* T4 — live vote round */}
          {round && (
            <div className={`twitch-round${round.revealIdx !== null ? ' is-revealed' : ''}`}>
              <div className="twitch-round-title">
                {round.revealIdx !== null
                  ? round.mode === 'predict'
                    ? 'The engine played:'
                    : 'Chat picked:'
                  : round.mode === 'predict'
                    ? `Which move will the AI play? · ${secondsLeft}s`
                    : `Chat — pick the AI's move! · ${secondsLeft}s`}
              </div>
              {round.candidates.map((c, i) => (
                <div
                  key={i}
                  className={`twitch-round-option${round.revealIdx === i ? ' is-winner' : ''}`}
                >
                  <span className="twitch-round-cmd">!{i + 1}</span>
                  <span className="twitch-round-san">{c.san}</span>
                  <span className="twitch-round-count">{round.counts[i]}</span>
                </div>
              ))}
            </div>
          )}

          {/* leaderboard at match end */}
          {showLeaderboard && scores.length > 0 && (
            <div className="twitch-leaderboard" role="status">
              <div className="twitch-leaderboard-title">🏆 Chat leaderboard</div>
              {scores.slice(0, LEADERBOARD_SIZE).map((s, i) => (
                <div key={s.nick} className="twitch-leaderboard-row">
                  <span className="twitch-lb-rank">{i + 1}.</span>
                  <span
                    className="twitch-winner-nick"
                    style={s.color ? { color: s.color } : undefined}
                  >
                    {s.displayName}
                  </span>
                  <span className="twitch-lb-points">{s.points}</span>
                </div>
              ))}
            </div>
          )}

          <div className="twitch-predict-bar" aria-label="Result calls">
            <span className="twitch-predict-hint">
              Result: !white !black !draw (+3) · Moves: !1–!4 (+1)
            </span>
            <span className="twitch-predict-counts">
              <span className="predict-chip predict-white">♙ {counts.white}</span>
              <span className="predict-chip predict-black">♟ {counts.black}</span>
              <span className="predict-chip predict-draw">½ {counts.draw}</span>
            </span>
          </div>

          <div className="twitch-feed" ref={feedRef}>
            {messages.length === 0 ? (
              <div className="twitch-feed-empty">Waiting for chat…</div>
            ) : (
              messages.map((m) => <TwitchMessageRow key={m.id} msg={m} emotes={emotes} />)
            )}
          </div>
        </>
      )}
    </aside>,
    document.body,
  );
}
