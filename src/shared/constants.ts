export const fileEncoding = "utf8";

export const FileSearchResultsLimit: number = 30;

export const getNotesDirectoryPath = () => {
  return window["config"].getMainDirectoryPathSync();
};

export const enum ContextMenuTypes {
  FILE,
  DIRECTORY,
  FILEEXPLORER,
  FILEBOOKMARKS,
}
