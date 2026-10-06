// @vitest-environment node

import { describe, expect, it } from "vitest";

import electronConfig, { pdfAssetsPlugins } from "../electron.vite.config";

import designGraphConfig from "../vite.design-graph.config";

it("isolates the preview optimizer cache from the running editor", () => {
  const rendererCache = (electronConfig as { renderer: { cacheDir?: string } }).renderer.cacheDir;
  expect(rendererCache).toBeTruthy();
  expect(designGraphConfig.cacheDir).toBeTruthy();
  expect(designGraphConfig.cacheDir).not.toBe(rendererCache);
});

describe("PDF.js asset plugins", () => {
  it("keeps file emission out of serve mode", () => {
    const [servePlugin, buildPlugin] = pdfAssetsPlugins();

    expect(servePlugin).toMatchObject({
      name: "obim-pdfjs-assets-serve",
      apply: "serve",
    });
    expect(servePlugin.configureServer).toBeTypeOf("function");
    expect(servePlugin.buildStart).toBeUndefined();

    expect(buildPlugin).toMatchObject({
      name: "obim-pdfjs-assets-build",
      apply: "build",
    });
    expect(buildPlugin.buildStart).toBeTypeOf("function");
    expect(buildPlugin.configureServer).toBeUndefined();
  });
});
