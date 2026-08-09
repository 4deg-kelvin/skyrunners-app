import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      // `**/` prefixes are load-bearing. A git worktree lives at
      // `.claude/worktrees/<name>/`, INSIDE this directory, so a root-anchored
      // `.next/**` doesn't match the worktree's build output — and linting from
      // the main checkout then reports hundreds of errors in Next's own
      // generated bundles, which look like real failures and block CI.
      "**/.next/**",
      // Output of `npm run build:check`, same generated code as `.next`.
      "**/.next-build/**",
      "**/node_modules/**",
      // Agent worktrees and local settings — another checkout's source is not
      // this checkout's problem.
      ".claude/**",
      "next-env.d.ts",
      "supabase/**",
      // Dev tooling run directly by node, not part of the app build. It talks
      // to Postgres through `pg`, a --no-save install with no types, so the
      // app's strictness would only produce noise here. Also excluded from
      // tsconfig for the same reason.
      "scripts/**",
    ],
  },
  {
    rules: {
      // Unused vars are usually a mistake, but an underscore prefix is an
      // explicit "I know, I'm keeping it for the signature".
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    /**
     * Pages and components must go through the data layer.
     *
     * This rule is the enforcement behind lib/data/README.md. Importing
     * mock-data directly is exactly what would make the Supabase migration a
     * six-file rewrite instead of a one-directory change — so it fails lint
     * rather than relying on everyone remembering.
     */
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/lib/mock-data", "@/lib/mock-data"],
              message:
                "Import from @/lib/data/* instead. Pages must not touch the data source directly — see lib/data/README.md.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
