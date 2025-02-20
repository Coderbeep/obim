const { contextBridge, ipcRenderer } = require('electron')

if (!process.contextIsolated) {
  throw new Error('contextIsolation must be enabled in the BrowserWindow')
}

contextBridge.exposeInMainWorld('api', {
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  getFiles: (directoryPath) => ipcRenderer.invoke('get-files', directoryPath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
  getFilesRecursiveAsList: (directoryPath) => ipcRenderer.invoke('get-files-recursive-as-list', directoryPath),
  getFilesRecursiveAsTree: (directoryPath) => ipcRenderer.invoke('get-files-recursive-as-tree', directoryPath),
  createFile: (filePath) => ipcRenderer.invoke('create-file', filePath),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  moveFile: (sourcePath, destinationPath) => ipcRenderer.invoke('move-file', sourcePath, destinationPath),
})