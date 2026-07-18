import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // project/ is the embedded Snake Arcade workspace (own tooling),
  // .claude/ holds agent worktree copies — neither is this app's code.
  globalIgnores(['dist', 'project', '.claude', 'scripts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Underscore prefix = intentionally unused (kept for API shape docs,
      // e.g. the OAuth helpers' parameter lists).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Entry point and the toast context module intentionally export
    // non-components; fast-refresh can't apply to them anyway.
    files: ['src/main.tsx', 'src/components/Toast.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
