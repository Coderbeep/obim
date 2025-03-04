import { contextBridge, ipcRenderer } from "electron"

if (!process.contextIsolated) {
  throw new Error('contextIsolation must be enabled in the BrowserWindow')
}

contextBridge.exposeInMainWorld('api', {
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  getFiles: (directoryPath) => ipcRenderer.invoke('get-files', directoryPath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
  createDirectory: (directoryPath) => ipcRenderer.invoke('create-directory', directoryPath),
  getFilesRecursiveAsList: (directoryPath) => ipcRenderer.invoke('get-files-recursive-as-list', directoryPath),
  getFilesRecursiveAsTree: (directoryPath) => ipcRenderer.invoke('get-files-recursive-as-tree', directoryPath),
  createFile: (filePath) => ipcRenderer.invoke('create-file', filePath),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  moveFile: (sourcePath, destinationPath) => ipcRenderer.invoke('move-file', sourcePath, destinationPath),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
})

contextBridge.exposeInMainWorld('config', {
  getMainDirectoryPathSync: () => { return ipcRenderer.sendSync('get-main-directory-path-sync') },
  getConfigValue: (key) => ipcRenderer.invoke('get-config-value', key),
  updateConfig: (key, value) => ipcRenderer.invoke('update-config', key, value),
  getConfig: () => ipcRenderer.invoke('get-config'),
})