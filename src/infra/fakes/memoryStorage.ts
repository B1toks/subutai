/**
 * Unit tests only: a localStorage that lives in a Map, for
 * setLocalDataBackend (src/infra/localData.ts). Nothing in the app imports
 * this file, so it never reaches the build.
 */
export function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string): string | null => map.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      map.set(key, String(value));
    },
    removeItem: (key: string): void => {
      map.delete(key);
    },
    /** What is stored, for assertions. */
    dump: (): Record<string, string> => Object.fromEntries(map),
  };
}
