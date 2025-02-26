export const appDirectoryName = 'NoteMark'
export const fileEncoding = 'utf8'
export const notesDirectoryPath = '/home/coderbeep/Documents/test-markdown'

/*
 * Used to differentiate UI sections where the same props may appear multiple times.
 * 
 * Example use case: A file can be listed in both the file explorer and bookmarks
 * without this distinction, actions like renaming might not apply to the correct instance.
 */
export const enum AppSections {
    FILE_EXPLORER_FILES,
    FILE_EXPLORER_BOOKMARKS,
    UNSPECIFIED
}

export const enum ContextMenuTypes {
    FILE,
    DIRECTORY,
    FILEEXPLORER,
    FILEBOOKMARKS
}