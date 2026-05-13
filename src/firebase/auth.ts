import { signInAnonymously, onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './client';
import type { UserProfile } from './types';

export async function ensureSignedIn(): Promise<User> {
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

export function onUserStateChanged(cb: (user: User | null) => void) {
  return onAuthStateChanged(auth, cb);
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

export async function isDisplayNameAvailable(name: string): Promise<boolean> {
  const slug = normalizeDisplayName(name);
  const snap = await getDoc(doc(db, 'displayNames', slug));
  return !snap.exists();
}

export async function claimDisplayName(uid: string, name: string): Promise<void> {
  const slug = normalizeDisplayName(name);
  const userRef = doc(db, 'users', uid);
  const nameRef = doc(db, 'displayNames', slug);

  await runTransaction(db, async (tx) => {
    const nameSnap = await tx.get(nameRef);
    if (nameSnap.exists()) {
      const existing = nameSnap.data() as { uid: string };
      if (existing.uid !== uid) throw new Error('DISPLAY_NAME_TAKEN');
    }

    tx.set(nameRef, { uid, createdAt: serverTimestamp() });
    tx.set(
      userRef,
      {
        uid,
        displayName: name.trim(),
        displayNameLower: slug,
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export async function changeDisplayName(
  uid: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const oldSlug = normalizeDisplayName(oldName);
  const newSlug = normalizeDisplayName(newName);
  if (oldSlug === newSlug) return;

  const userRef = doc(db, 'users', uid);
  const oldNameRef = doc(db, 'displayNames', oldSlug);
  const newNameRef = doc(db, 'displayNames', newSlug);

  await runTransaction(db, async (tx) => {
    const newNameSnap = await tx.get(newNameRef);
    if (newNameSnap.exists()) {
      const data = newNameSnap.data() as { uid: string };
      if (data.uid !== uid) throw new Error('DISPLAY_NAME_TAKEN');
    }

    tx.delete(oldNameRef);
    tx.set(newNameRef, { uid, createdAt: serverTimestamp() });
    tx.set(
      userRef,
      {
        displayName: newName.trim(),
        displayNameLower: newSlug,
        lastActive: serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export function normalizeDisplayName(name: string): string {
  return name.trim().toLowerCase().normalize('NFKC');
}

export function isValidDisplayName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 3 || trimmed.length > 20) return false;
  return /^[\p{L}\p{N} _-]+$/u.test(trimmed);
}
