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
  // R-5 — firestore.rules refuses two spaces in a row (shown as one, so
  // "Bo  ss" would pass for "Bo ss").
  if (trimmed.includes('  ')) return false;
  return /^[\p{L}\p{N} _-]+$/u.test(trimmed);
}

/** R-5 — firestore.rules (slugCanonical) take ς in a slug only where
 *  toLowerCase() writes it, at the end of a word, and σ everywhere else.
 *  A name typed with σ at the end of a word ("Νίκοσ"), or with a modifier
 *  letter or ª before a final Σ, lowercases to a slug they refuse; the
 *  same three patterns, so the picker can say so before the save fails. */
export function sigmaPlacementOk(slug: string): boolean {
  return !/(^|[^\p{Ll}\p{Lm}])\p{Lm}*ς/u.test(slug)
    && !/ς\p{Lm}*\p{Ll}/u.test(slug)
    && !/\p{Ll}\p{Lm}*σ\p{Lm}*([^\p{Ll}\p{Lm}]|$)/u.test(slug);
}

/** R-5 — the name checks of firestore.rules (nameReserved: shownNameOk,
 *  no capital in the slug, slugCanonical, the slug matching the name up to
 *  case), run on the name and the slug a save would write. NFKC can turn a
 *  name the character check lets through into a slug the rules refuse:
 *  compatibility jamo (ㅋ) into conjoining jamo, fullwidth and letterlike
 *  letters (Ａ, ℂ, ᴬ) into capitals or into letters the name does not
 *  have. The picker refuses those itself instead of failing the save. */
export function nameAcceptedByRules(name: string): boolean {
  const shown = name.trim();
  const slug = normalizeDisplayName(name);
  return /^[\p{L}\p{N}_-]([\p{L}\p{N} _-]*[\p{L}\p{N}_-])?$/u.test(shown)
    && !shown.includes('  ')
    && !/[\p{Lu}\p{Lt}]/u.test(slug)
    && !/[\u00B5\u017F\u03D0\u03D1\u03D5\u03D6\u03F0\u03F1\u03F5\u1100-\u11FF\u1C80-\u1C88\u1E9B\u1FBE\u2160-\u217F\u24B6-\u24E9\u3164\uFFA0]|\u0345/u.test(slug)
    && sigmaPlacementOk(slug)
    // the shown name holds no regex syntax (checked above)
    && new RegExp(`^(?:${shown})$`, 'iu').test(slug.replace(/i\u0307/gu, '\u0130'));
}

export type DisplayNameProblem = 'tooShort' | 'tooLong' | 'invalidChars' | 'sigma' | 'changesWhenSaved';

/** What the name picker says against a name before it is saved, or null:
 *  every name it lets through, firestore.rules take (tests/rules/
 *  rules.test.mjs checks the two agree). */
export function displayNameProblem(name: string): DisplayNameProblem | null {
  const trimmed = name.trim();
  if (trimmed.length < 3) return 'tooShort';
  if (trimmed.length > 20) return 'tooLong';
  if (!isValidDisplayName(trimmed)) return 'invalidChars';
  if (!sigmaPlacementOk(normalizeDisplayName(trimmed))) return 'sigma';
  if (!nameAcceptedByRules(trimmed)) return 'changesWhenSaved';
  return null;
}
