import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Architecture boundaries (docs/spec/02 §2). Imports that leave a guarded layer must use the
// `@/` alias: a relative `../` that climbs out of the layer is banned per file depth,
// non-normalised or root-style specifiers are banned, and forbidden `@/` targets are banned.
// Dynamic import()/require() are banned in guarded layers. Never disable these rules.
const MAX_DEPTH = 20;
const EXTENSIONS = '{ts,tsx,js,mjs,cjs,mts,cts}';

const SPECIFIER_HYGIENE = [
  {
    // A `..` segment after a non-`..` segment (`./../x`, `@/core/../x`, `a/../../x`), a `/./`
    // segment, or a root/project-absolute path can all hide where an import really points.
    regex: '(^|/)(?!\\.\\.(/|$))[^/]+/(.*/)?\\.\\.(/|$)|/\\./|^/|^src(/|$)',
    message: 'Use a normalised relative path or the @/ alias.',
  },
];

const NO_DYNAMIC_IMPORTS = [
  { selector: 'ImportExpression', message: 'No dynamic import() in guarded layers.' },
  { selector: "CallExpression[callee.name='require']", message: 'No require() in guarded layers.' },
];

function boundary(layerDir, forbiddenAliasRegex, message, extraSyntax = []) {
  const entry = (files, climbRegex) => ({
    files,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: climbRegex, message: `Relative import leaves ${layerDir}; use the @/ alias.` },
            { regex: forbiddenAliasRegex, message },
            ...SPECIFIER_HYGIENE,
          ],
        },
      ],
      'no-restricted-syntax': ['error', ...NO_DYNAMIC_IMPORTS, ...extraSyntax],
    },
  });
  return [
    // Files deeper than MAX_DEPTH: no relative climbing at all.
    entry([`${layerDir}/**/*.${EXTENSIONS}`], '^\\.\\./'),
    ...Array.from({ length: MAX_DEPTH }, (_, i) =>
      entry([`${layerDir}/${'*/'.repeat(i)}*.${EXTENSIONS}`], `^(\\.\\./){${i + 1},}`),
    ),
  ];
}

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', '.wrangler'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.strict, jsxA11y.flatConfigs.recommended],
    files: ['**/*.{ts,tsx,js}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['*.{ts,js}', 'tests/**', 'api/**', 'functions/**', 'scripts/**'],
    languageOptions: { globals: globals.node },
  },
  ...boundary(
    'src/core',
    '^@/(modules|features|infrastructure|app)(/|$)',
    'src/core must not import from modules, features, infrastructure or app.',
    [
      {
        selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
        message: 'Use the injected Clock.',
      },
    ],
  ),
  ...boundary(
    'src/features/chip-inventory/domain',
    '^@/(?!core/|shared/utilities/)',
    'chip-inventory/domain may only import from @/core and @/shared/utilities.',
  ),
  ...boundary(
    'src/modules',
    '^@/(app|infrastructure|features/(?!chip-inventory/domain/))',
    'Modules may only import @/core, @/shared and @/features/chip-inventory/domain.',
  ),
  {
    // Domain code takes an injected Clock; no ambient time or timers.
    files: [`src/core/**/*.${EXTENSIONS}`],
    ignores: ['**/*.test.*'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Use the injected Clock.' },
        { object: 'performance', property: 'now', message: 'Use the injected Clock.' },
        ...['setTimeout', 'setInterval', 'requestAnimationFrame'].flatMap((property) =>
          ['window', 'globalThis', 'self'].map((object) => ({
            object,
            property,
            message: 'No timers in core domain code.',
          })),
        ),
      ],
      'no-restricted-globals': [
        'error',
        ...['setTimeout', 'setInterval', 'requestAnimationFrame'].map((name) => ({
          name,
          message: 'No timers in core domain code.',
        })),
      ],
    },
  },
  prettier,
);
