import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

export default [
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
    },
  },
  {
    // Test doubles (fake DB clients/drivers) are intentionally loosely typed.
    files: ['test/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
];
