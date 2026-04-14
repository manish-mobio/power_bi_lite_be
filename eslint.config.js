import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs}"],

    ...js.configs.recommended, // ✅ correct way

    languageOptions: {
      globals: globals.node, // ✅ backend
    },

    rules: {
      // 🔥 strict rules (what you want)
      "no-unused-vars": "error",
      "no-undef": "error",
      "no-unreachable": "error",
      "no-shadow": "error",
      "no-redeclare": "error",
      "eqeqeq": ["error", "always"],
      "prefer-const": "error",
    },
  },
]);