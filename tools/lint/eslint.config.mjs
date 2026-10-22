// The project's lint rules: real mistakes only (undefined names, unreachable
// code, duplicate keys...), no style opinions. Run from the repo root:
//   npm install --prefix tools/lint
//   tools/lint/node_modules/.bin/eslint -c tools/lint/eslint.config.mjs --no-config-lookup students/js src crypto.js sw.js tools/qa
import globals from "globals";
export default [
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node, supabase: "readonly", PanaloCrypto: "readonly" },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-self-assign": "error",
      "no-cond-assign": ["error", "except-parens"],
      "no-constant-condition": ["warn", { checkLoops: false }],
      "no-fallthrough": "warn",
      "use-isnan": "error",
      "valid-typeof": "error",
      "no-unsafe-finally": "error",
      "no-dupe-else-if": "error",
      "no-import-assign": "error",
      "no-loss-of-precision": "error",
      "getter-return": "error",
      "no-async-promise-executor": "error",
      "no-compare-neg-zero": "error",
      "no-unused-private-class-members": "warn",
    },
  },
];
