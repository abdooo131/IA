import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/generated/**', '**/*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // A module may use another module only through its public index.ts.
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/modules/*/!(index)', '**/modules/*/*/**'], message: 'Use the module public index.ts' }] },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
