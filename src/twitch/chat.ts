/**
 * T1 — anonymous read-only Twitch chat client.
 *
 * Twitch IRC accepts anonymous logins with a `justinfan<digits>` nick
 * and no OAuth token — read-only, which is exactly what an on-screen
 * chat overlay needs. No client id, no secrets, no rate-limit worries
 * beyond JOIN throttling (we join a single channel).
 *
 * The `twitch.tv/tags` capability adds per-message metadata; we use
 * `display-name` and `color` so nicks render like in the real chat.
 */

export interface TwitchChatMessage {
  id: string;
  /** Lowercase login (stable identity for prediction tracking). */
  nick: string;
  /** Capitalised display name as the viewer styled it. */
  displayName: string;
  /** Hex color from tags, or '' when the user never picked one. */
  color: string;
  text: string;
  ts: number;
}

export type TwitchChatStatus = 'idle' | 'connecting' | 'connected' | 'error';

type MessageCb = (msg: TwitchChatMessage) => void;
type StatusCb = (status: TwitchChatStatus, detail?: string) => void;

const TWITCH_IRC_WS = 'wss://irc-ws.chat.twitch.tv:443';

/** Parse the @key=value;key=value prefix of a tagged IRC line. */
function parseTags(raw: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    tags[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return tags;
}

/** Parse one IRC line into a chat message, or null for non-PRIVMSG. */
export function parsePrivmsg(line: string): TwitchChatMessage | null {
  // @tags :nick!nick@nick.tmi.twitch.tv PRIVMSG #channel :text
  let tags: Record<string, string> = {};
  let rest = line;
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    tags = parseTags(rest.slice(1, sp));
    rest = rest.slice(sp + 1);
  }
  const m = rest.match(/^:(\w+)!\S+ PRIVMSG #\S+ :(.*)$/);
  if (!m) return null;
  const nick = m[1].toLowerCase();
  return {
    id: tags['id'] ?? `${nick}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    nick,
    displayName: tags['display-name'] || nick,
    color: tags['color'] || '',
    text: m[2],
    ts: Date.now(),
  };
}

export class TwitchChatClient {
  private ws: WebSocket | null = null;
  private channel: string | null = null;
  private status: TwitchChatStatus = 'idle';
  private messageCbs: MessageCb[] = [];
  private statusCbs: StatusCb[] = [];
  private manualClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;

  onMessage(cb: MessageCb): () => void {
    this.messageCbs.push(cb);
    return () => {
      this.messageCbs = this.messageCbs.filter((c) => c !== cb);
    };
  }

  onStatus(cb: StatusCb): () => void {
    this.statusCbs.push(cb);
    return () => {
      this.statusCbs = this.statusCbs.filter((c) => c !== cb);
    };
  }

  getStatus(): TwitchChatStatus {
    return this.status;
  }

  getChannel(): string | null {
    return this.channel;
  }

  connect(channelRaw: string) {
    const channel = channelRaw.trim().toLowerCase().replace(/^#/, '').replace(/^.*twitch\.tv\//, '');
    if (!channel) return;
    this.disconnect();
    this.manualClose = false;
    this.channel = channel;
    this.open();
  }

  disconnect() {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch { /* already closed */ }
      this.ws = null;
    }
    this.channel = null;
    this.reconnectAttempts = 0;
    this.setStatus('idle');
  }

  private open() {
    if (!this.channel) return;
    this.setStatus('connecting');
    const ws = new WebSocket(TWITCH_IRC_WS);
    this.ws = ws;
    const channel = this.channel;

    ws.onopen = () => {
      // Anonymous login: any justinfan nick, no PASS needed.
      ws.send('CAP REQ :twitch.tv/tags');
      ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
      ws.send(`JOIN #${channel}`);
    };

    ws.onmessage = (ev) => {
      const data = String(ev.data);
      for (const line of data.split('\r\n')) {
        if (!line) continue;
        if (line.startsWith('PING')) {
          ws.send(line.replace('PING', 'PONG'));
          continue;
        }
        // 366 = end of NAMES — join confirmed.
        if (line.includes(' 366 ')) {
          this.reconnectAttempts = 0;
          this.setStatus('connected');
          continue;
        }
        const msg = parsePrivmsg(line);
        if (msg) {
          for (const cb of this.messageCbs) cb(msg);
        }
      }
    };

    ws.onerror = () => {
      this.setStatus('error', 'Connection error');
    };

    ws.onclose = () => {
      if (this.manualClose) return;
      // Transparent auto-reconnect with capped backoff — kiosk streams
      // shouldn't die because wifi blinked.
      if (this.reconnectAttempts >= 5) {
        this.setStatus('error', 'Disconnected (gave up after 5 retries)');
        return;
      }
      this.reconnectAttempts++;
      this.setStatus('connecting', `Reconnecting (${this.reconnectAttempts})`);
      this.reconnectTimer = setTimeout(() => this.open(), 1000 * this.reconnectAttempts);
    };
  }

  private setStatus(status: TwitchChatStatus, detail?: string) {
    this.status = status;
    for (const cb of this.statusCbs) cb(status, detail);
  }
}

export const twitchChat = new TwitchChatClient();
