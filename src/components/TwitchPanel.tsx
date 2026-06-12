import { useEffect, useRef, useState } from 'react';
import { Cast, X } from 'lucide-react';
import { Icon } from './Icon';
import { twitchChat, type TwitchChatMessage, type TwitchChatStatus } from '../twitch/chat';
import {
  applyPrediction,
  emptyPredictions,
  tally,
  winnersFor,
  type GameResult,
  type PredictionState,
  type PredictionWinner,
} from '../twitch/predictions';

const CHANNEL_KEY = 'subutai_twitch_channel';
const MAX_MESSAGES = 60;
const MAX_WINNER_NICKS = 10;

interface TwitchPanelProps {
  /** Changes on every new game — clears votes + the winners banner. */
  gameKey: string;
  /** Null while the game runs; set once when it ends. */
  gameResult: GameResult | null;
  onClose: () => void;
}

/**
 * T3 — on-screen Twitch chat + predictions overlay.
 *
 * Read-only anonymous chat: viewers' messages render with their Twitch
 * colors; !white / !black / !draw messages double as predictions. When
 * the game ends the viewers who called it get their nicks on screen.
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
  const [winners, setWinners] = useState<PredictionWinner[] | null>(null);
  const predictionsRef = useRef<PredictionState>(emptyPredictions());
  const feedRef = useRef<HTMLDivElement | null>(null);

  // Chat subscription — lives as long as the panel is mounted. The
  // client itself is a singleton, so reopening the panel keeps the
  // connection (kiosk-friendly).
  //
  // Big channels push 50+ messages/sec; a setState per message melts
  // the renderer. Messages accumulate in a ref and flush to state on a
  // 300ms interval — chat still feels live, React renders ≤3×/sec.
  const pendingRef = useRef<TwitchChatMessage[]>([]);
  useEffect(() => {
    const offMsg = twitchChat.onMessage((msg) => {
      pendingRef.current.push(msg);
      // The buffer itself never needs more than one screenful.
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

  // New game — votes and banner reset, chat history stays.
  useEffect(() => {
    predictionsRef.current = emptyPredictions();
    setCounts({ white: 0, black: 0, draw: 0 });
    setWinners(null);
  }, [gameKey]);

  // Game ended — freeze the round and crown the correct predictors.
  useEffect(() => {
    if (!gameResult) return;
    setWinners(winnersFor(predictionsRef.current, gameResult));
  }, [gameResult]);

  // Stick to the newest message.
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function connect() {
    const ch = channelInput.trim();
    if (!ch) return;
    try {
      localStorage.setItem(CHANNEL_KEY, ch);
    } catch { /* private mode */ }
    setMessages([]);
    twitchChat.connect(ch);
  }

  const connected = status === 'connected';

  return (
    <aside className="twitch-panel" aria-label="Twitch chat">
      <div className="twitch-panel-header">
        <span className="twitch-panel-title">
          <Icon icon={Cast} size="md" aria-hidden /> Twitch
          {connected && twitchChat.getChannel() && (
            <span className="twitch-channel-name">#{twitchChat.getChannel()}</span>
          )}
        </span>
        <button type="button" className="twitch-close-btn" onClick={onClose} aria-label="Close Twitch panel">
          <Icon icon={X} size="sm" aria-hidden />
        </button>
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
          <div className="twitch-predict-bar" aria-label="Predictions">
            <span className="twitch-predict-hint">Chat votes: !white !black !draw</span>
            <span className="twitch-predict-counts">
              <span className="predict-chip predict-white">♙ {counts.white}</span>
              <span className="predict-chip predict-black">♟ {counts.black}</span>
              <span className="predict-chip predict-draw">½ {counts.draw}</span>
            </span>
          </div>

          {winners && (
            <div className="twitch-winners" role="status">
              {winners.length === 0 ? (
                <span className="twitch-winners-none">Nobody called it 🤷</span>
              ) : (
                <>
                  <span className="twitch-winners-title">🎉 Called it:</span>
                  <span className="twitch-winners-list">
                    {winners.slice(0, MAX_WINNER_NICKS).map((w) => (
                      <span
                        key={w.nick}
                        className="twitch-winner-nick"
                        style={w.color ? { color: w.color } : undefined}
                      >
                        {w.displayName}
                      </span>
                    ))}
                    {winners.length > MAX_WINNER_NICKS && (
                      <span className="twitch-winners-more">+{winners.length - MAX_WINNER_NICKS} more</span>
                    )}
                  </span>
                </>
              )}
            </div>
          )}

          <div className="twitch-feed" ref={feedRef}>
            {messages.length === 0 ? (
              <div className="twitch-feed-empty">Waiting for chat…</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="twitch-msg">
                  <span
                    className="twitch-msg-nick"
                    style={m.color ? { color: m.color } : undefined}
                  >
                    {m.displayName}
                  </span>
                  <span className="twitch-msg-text">{m.text}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </aside>
  );
}
