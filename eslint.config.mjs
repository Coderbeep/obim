// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const rendererStoreForbiddenAreas = [
  "app",
  "features",
  "infrastructure",
  "components",
  "hooks",
  "services",
  "domain",
  "cm-extensions",
  "assets",
  "extensions",
  "lib",
  "repositories",
  "utils",
  "preload",
];

const rendererStoreForbiddenImports = rendererStoreForbiddenAreas.flatMap((area) => [
  `@renderer/${area}`,
  `@renderer/${area}/**`,
  `../**/${area}`,
  `../**/${area}/**`,
  `src/renderer/src/${area}`,
  `src/renderer/src/${area}/**`,
]);

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    ignores: ["out/", "dist/", "coverage/", ".agents/"],
  },
  {
    files: ["src/renderer/src/**/*.{ts,tsx}"],
    ignores: ["src/renderer/src/store/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["jotai/utils", "jotai/utils/*", "jotai/vanilla", "jotai/vanilla/*"],
              importNamePattern:
                "^(atom|atomFamily|atomWith[A-Za-z]*|selectAtom|focusAtom|splitAtom|freezeAtom|freezeAtomCreator|loadable|unwrap)$",
              message: "Define Jotai atoms and derived atom utilities in src/renderer/src/store.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportDeclaration[importKind!='type'][source.value='jotai'] > ImportSpecifier[importKind!='type'][imported.name='atom']",
          message: "Define Jotai atoms in src/renderer/src/store.",
        },
        {
          selector: "ImportDeclaration[importKind!='type'][source.value='jotai'] > ImportNamespaceSpecifier",
          message: "Import Jotai hooks or types by name; atom construction belongs in store.",
        },
        {
          selector: "ImportDeclaration[importKind!='type'][source.value^='jotai/'] > ImportNamespaceSpecifier",
          message: "Import Jotai hooks or types by name; atom construction belongs in store.",
        },
      ],
    },
  },
  {
    files: ["src/renderer/src/store/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              message: "Renderer store modules must not depend on React.",
            },
            {
              name: "react-dom",
              message: "Renderer store modules must not depend on React DOM.",
            },
          ],
          patterns: [
            {
              group: [
                "react/*",
                "react-dom/*",
                ...rendererStoreForbiddenImports,
                "@components",
                "@components/**",
                "@extensions",
                "@extensions/**",
                "@hooks",
                "@hooks/**",
                "@lib",
                "@lib/**",
                "@services",
                "@services/**",
                "@store",
                "@store/**",
                "@utils",
                "@utils/**",
                "src/preload",
                "src/preload/**",
                "**/*Repository",
              ],
              message: "Renderer store modules may depend only on Jotai, other store modules, and shared data helpers.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='window'][property.name='api']",
          message: "Renderer store modules must not call the preload API.",
        },
        {
          selector: "MemberExpression[object.name='window'][property.name='config']",
          message: "Renderer store modules must not read preload configuration.",
        },
        {
          selector: "MemberExpression[object.name='window'][computed=true][property.value='api']",
          message: "Renderer store modules must not call the preload API.",
        },
        {
          selector: "MemberExpression[object.name='window'][computed=true][property.value='config']",
          message: "Renderer store modules must not read preload configuration.",
        },
      ],
    },
  },
  {
    files: ["*.config.js"],
    languageOptions: {
      globals: {
        module: "readonly",
        require: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
