import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { ensureSignedIn, onUserStateChanged, getUserProfile } from './auth';
import type { UserProfile } from './types';

const LS_KEY = 'subutai_user_cache_v1';

interface CachedAuth {
  uid: string;
  displayName: string | null;
}

function readCache(): CachedAuth | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as CachedAuth) : null;
  } catch {
    return null;
  }
}

function writeCache(data: CachedAuth | null) {
  try {
    if (data) localStorage.setItem(LS_KEY, JSON.stringify(data));
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore quota / private-mode failures */
  }
}

export function useAuth() {
  const cached = readCache();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(
    cached?.displayName ?? null,
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ensureSignedIn().catch((err) => console.error('[auth] signIn failed', err));
    const unsub = onUserStateChanged(async (u) => {
      setUser(u);
      if (u) {
        try {
          const p = await getUserProfile(u.uid);
          setProfile(p);
          if (p) {
            setDisplayName(p.displayName);
            writeCache({ uid: u.uid, displayName: p.displayName });
          } else {
            setDisplayName(null);
            writeCache({ uid: u.uid, displayName: null });
          }
        } catch (err) {
          console.error('[auth] profile load failed', err);
          setProfile(null);
        }
      } else {
        setProfile(null);
        setDisplayName(null);
        writeCache(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  return { user, profile, displayName, loading, setDisplayName, setProfile };
}
