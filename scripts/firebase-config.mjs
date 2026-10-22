// The Firebase web config for the Node scripts (dump-*.mjs), from the one
// place the app keeps it: src/firebase/client.ts. Read as text, since it is
// TypeScript and starts the app's Auth and Firestore on import.
// FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN and FIREBASE_PROJECT_ID in the
// environment win (another project, or a key with other restrictions).
// The key is the public web key the app ships; nothing here prints it.
import { readFileSync } from 'node:fs';

const CLIENT = new URL('../src/firebase/client.ts', import.meta.url);

function fromClient(field) {
  const found = readFileSync(CLIENT, 'utf8').match(new RegExp(`\\b${field}:\\s*'([^']+)'`));
  if (!found) throw new Error(`src/firebase/client.ts has no ${field}`);
  return found[1];
}

export const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || fromClient('apiKey'),
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || fromClient('authDomain'),
  projectId: process.env.FIREBASE_PROJECT_ID || fromClient('projectId'),
};
