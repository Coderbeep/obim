import { app } from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";

// Run before modules capture userData paths and before Chromium initializes its session.
if (!app.isPackaged) {
  const developmentProfile = path.join(app.getPath("appData"), "obim-dev");
  mkdirSync(developmentProfile, { recursive: true });
  app.setPath("userData", developmentProfile);
  app.setPath("sessionData", developmentProfile);
}
