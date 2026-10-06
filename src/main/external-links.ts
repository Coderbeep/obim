/**
 * Normalizes and opens web links while preventing Electron from launching
 * unsupported or potentially unsafe URL schemes.
 */
import { shell } from "electron";

const normalizeExternalUrl = (url: string) => (/^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`);

export const openExternalUrl = async (rawUrl: string): Promise<void> => {
  const url = new URL(normalizeExternalUrl(rawUrl));
  if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) {
    throw new Error(`Unsupported external URL: ${rawUrl}`);
  }

  await shell.openExternal(url.toString(), { activate: true });
};
