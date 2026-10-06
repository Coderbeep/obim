import { open, stat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

import { LARGE_TEXT_PREVIEW_BYTES, type LargeTextPreview } from "@shared/large-files";

export const readLargeTextPreview = async (filePath: string): Promise<LargeTextPreview> => {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("Large-file preview requires a regular file");

  const sizeBytes = Number(fileStat.size);
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(Math.min(sizeBytes, LARGE_TEXT_PREVIEW_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return {
      content: new StringDecoder("utf8").write(buffer.subarray(0, bytesRead)),
      previewBytes: bytesRead,
      sizeBytes,
      truncated: sizeBytes > bytesRead,
    };
  } finally {
    await handle.close();
  }
};
