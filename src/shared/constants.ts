export const fileEncoding = "utf8";

export const getNotesDirectoryPath = () => {
  return window["config"].getMainDirectoryPathSync();
};

export const enum ContextMenuTypes {
  FILE,
  DIRECTORY,
  FILEEXPLORER,
  FILEBOOKMARKS,
}
