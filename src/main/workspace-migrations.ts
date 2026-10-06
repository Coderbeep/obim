import path from "node:path";
import { lstat, unlink } from "node:fs/promises";

/** Removes the obsolete field schema without touching any other workspace metadata. */
export const removeLegacyWorkspaceFieldSchema = async (workspacePath: string) => {
  if (!path.isAbsolute(workspacePath)) return false;
  const metadataPath = path.join(workspacePath, ".obim");
  const schemaPath = path.join(metadataPath, "fields.json");
  try {
    const metadata = await lstat(metadataPath);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) return false;
    const schema = await lstat(schemaPath);
    if (!schema.isFile() && !schema.isSymbolicLink()) return false;
    await unlink(schemaPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    console.warn(`Could not remove obsolete workspace field schema at ${schemaPath}:`, error);
    return false;
  }
};
