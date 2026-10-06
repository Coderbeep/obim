import { basename, isValidFilename } from "./pathUtils";

/** Reserved link syntax is allowed in existing filenames, but not section targets. */
export const canLinkToSections = (path: string) => {
  const name = basename(path);
  return isValidFilename(name) && !Array.from("#%[]^|").some((character) => name.includes(character));
};

export const SECTION_LINK_FILENAME_MESSAGE =
  "Rename the note to remove #, %, [, ], ^, | or other invalid filename characters before linking to its sections. You can still link to the whole note.";
