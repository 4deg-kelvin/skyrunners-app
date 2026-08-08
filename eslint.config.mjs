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
      ".next/**",
      // Output of `npm run build:check`. Same generated code as `.next`, so
      // linting it produces hundreds of errors about Next's own bundles.
      ".next-build/**",
      "node_modules/**",
      "next-env.d.ts",
      "supabase/**",
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
