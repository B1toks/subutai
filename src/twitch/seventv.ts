/**
 * T5 — 7TV emotes, read-only.
 *
 * Two public, token-free endpoints:
 *   - global emote set:   https://7tv.io/v3/emote-sets/global
 *   - channel emote set:  https://7tv.io/v3/users/twitch/{numericId}
 * The numeric Twitch id comes from ivr.fi's public resolver (the same
 * one chat tools use) since the anonymous IRC login never learns it.
 * Every failure degrades to "fewer emotes", never an error.
 */

export type EmoteMap = Map<string, string>; // name → CDN url (1x webp)

interface SevenTvEmote {
  name: string;
  data?: { host?: { url?: string; files?: { name: string }[] } };
}

function emoteUrl(e: SevenTvEmote): string | null {
  const host = e.data?.host;
  if (!host?.url) return null;
  // host.url is protocol-relative: //cdn.7tv.app/emote/<id>
  return `https:${host.url}/1x.webp`;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function loadGlobal(map: EmoteMap): Promise<void> {
  const data = (await fetchJson('https://7tv.io/v3/emote-sets/global')) as {
    emotes?: SevenTvEmote[];
  };
  for (const e of data.emotes ?? []) {
    const url = emoteUrl(e);
    if (url) map.set(e.name, url);
  }
}

async function loadChannel(map: EmoteMap, login: string): Promise<void> {
  const users = (await fetchJson(
    `https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(login)}`,
  )) as { id?: string }[];
  const id = users?.[0]?.id;
  if (!id) return;
  const data = (await fetchJson(`https://7tv.io/v3/users/twitch/${id}`)) as {
    emote_set?: { emotes?: SevenTvEmote[] };
  };
  for (const e of data.emote_set?.emotes ?? []) {
    const url = emoteUrl(e);
    if (url) map.set(e.name, url); // channel overrides global on clash
  }
}

const cache = new Map<string, Promise<EmoteMap>>();

/** Global + channel emotes for `login`. Cached per channel; safe to
 *  call repeatedly. Never rejects. */
export function loadEmoteMap(login: string): Promise<EmoteMap> {
  const key = login.toLowerCase();
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const map: EmoteMap = new Map();
      await Promise.allSettled([loadGlobal(map), loadChannel(map, key)]);
      return map;
    })();
    cache.set(key, p);
  }
  return p;
}
