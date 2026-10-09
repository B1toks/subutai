import { defineConfig } from 'vitest/config';

// Unit tests sit next to the code they test. The rules tests in tests/rules
// need the Firestore emulator and run through `npm run test:rules` instead.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
