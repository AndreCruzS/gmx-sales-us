import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default [
  ...nextVitals,
  ...nextTs,
  {
    // D55: no feature code imports IndexedDB/Dexie directly — everything goes
    // through the LocalStore/BlobStore interfaces. This rule is the discipline
    // that keeps a native-shell escalation a swap, not a rewrite.
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "dexie",
              message:
                "D55: import LocalStore/BlobStore from '@/lib/offline' instead of Dexie directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/lib/offline/local-store.dexie.ts",
      "src/lib/offline/blob-store.dexie.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },
  {
    ignores: [".next/**", "node_modules/**", "supabase/**", "public/sw.js"],
  },
];
