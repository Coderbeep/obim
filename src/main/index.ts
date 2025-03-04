import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { BrowserWindow, app, dialog, ipcMain, shell, protocol } from 'electron'
import path, { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { readFile, readdir, stat, writeFile, rename, unlink, mkdir } from 'fs/promises'
import { FileItem } from '@shared/models'
import { existsSync } from 'fs'
import { promptUserForMainDirectory, isPropertyDefined, getConfigValue } from './app-config'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    center: true,
    title: 'NoteMark',
    frame: false,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 10 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}



const mediaProtocolName = "media";
protocol.registerSchemesAsPrivileged([{
  scheme: mediaProtocolName,
  privileges: { standard: true, secure: true, supportFetchAPI: true }
}])

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron')

  protocol.handle(mediaProtocolName, async (request) => {
    const mainDirectoryPath = await getConfigValue('mainDirectory');
    let url = request.url.replace(`${mediaProtocolName}:/`, '');
    let filePath = path.join(mainDirectoryPath, url);
    if (filePath.endsWith('/')) {
      filePath = filePath.slice(0, -1);
    }
    try {
      const data = await readFile(filePath);
      return new Response(data, {
        headers: { 'Content-Type': 'image/png' }
      });
    } catch (error) {
      return new Response('File not found', { status: 404 });
    }
  });

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  let isDefined = await isPropertyDefined("mainDirectory");
  if (!isDefined) {
    const selectedDirectory = await promptUserForMainDirectory();
    if (!selectedDirectory) {
      app.quit();
      return;
    }
  }

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
});



// Define ipcMain handlers
ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });

  if (result.canceled) return [];

  const folderPath = result.filePaths[0];
  const files = readdir(folderPath);
  return files;
})

ipcMain.handle('get-files', async (_, directoryPath: string) => {
  const files: FileItem[] = [];
  const filenames = await readdir(directoryPath);

  for (const filename of filenames) {
    const filePath = path.join(directoryPath, filename);
    const fileStat = await stat(filePath);
    const mainDirectoryPath = await getConfigValue('mainDirectory');

    const fileItem: FileItem = {
      filename: filename,
      relativePath: filePath.replace(mainDirectoryPath, ''),
      path: filePath,
      isDirectory: fileStat.isDirectory(),
    }

    files.push(fileItem);
  }

  return files;
});

ipcMain.handle('open-file', async (_, filePath: string) => {
  try {
    const mainDirectoryPath = await getConfigValue('mainDirectory');
    const fullPath = path.resolve(mainDirectoryPath, filePath);
    const content = await readFile(fullPath, 'utf-8');
    return content;
  } catch (err) {
    console.error('Error reading file:', err);
    return '';
  }
});

ipcMain.handle('save-file', async (_, filePath: string, content: string) => {
  try {
    const mainDirectoryPath = await getConfigValue('mainDirectory');
    const fullPath = path.resolve(mainDirectoryPath, filePath);
    await writeFile(fullPath, content, 'utf-8');
    return true;
  } catch (err) {
    console.error('Error saving file:', err);
    return false;
  }
})

ipcMain.handle('create-directory', async (_, directoryPath: string) => {
  try {
    const mainDirectoryPath = await getConfigValue('mainDirectory');
    const fullPath = path.resolve(mainDirectoryPath, directoryPath);
    await mkdir(fullPath)
    return true;
  } catch (error) {
    console.error('Error creating directory:', error);
    return false;
  }
})

async function getFilesRecursiveAsList(directoryPath) {
  const files: FileItem[] = [];
  const filenames = await readdir(directoryPath);

  for (const filename of filenames) {
    const mainDirectoryPath = await getConfigValue('mainDirectory');
    const filePath = path.join(directoryPath, filename);
    const fileStat = await stat(filePath);

    if (fileStat.isDirectory()) {
      const children = await getFilesRecursiveAsList(filePath);
      files.push(...children)
    }
    
    const fileItem: FileItem = {
      filename: filename,
      relativePath: filePath.replace(mainDirectoryPath, ''),
      path: filePath,
      isDirectory: fileStat.isDirectory(),
    }
    files.push(fileItem);
  }
  return files;
}

ipcMain.handle('get-files-recursive-as-list', async (_, directoryPath: string) => {
  return getFilesRecursiveAsList(directoryPath);
})

async function getFilesRecursiveAsTree(directoryPath) {
  const files: FileItem[] = [];
  const filenames = await readdir(directoryPath);

  for (const filename of filenames) {
    const mainDirectoryPath = await getConfigValue('mainDirectory');
    const filePath = path.join(directoryPath, filename);
    const fileStat = await stat(filePath);

    const fileItem: FileItem = {
      filename: filename,
      relativePath: filePath.replace(mainDirectoryPath, ''),
      path: filePath,
      isDirectory: fileStat.isDirectory(),
    };

    if (fileStat.isDirectory()) {
      fileItem.children = await getFilesRecursiveAsTree(filePath);
    }

    files.push(fileItem);
  }

  files.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.filename.localeCompare(b.filename);
  });

  return files
}

ipcMain.handle('get-files-recursive-as-tree', async (_, directoryPath: string) => {
  return getFilesRecursiveAsTree(directoryPath);
})


ipcMain.handle("rename-file", async (_, currentFilePath: string, newFileName: string) => {
  const newFilePath = path.join(path.dirname(currentFilePath), newFileName);

  try {
    const mainDirectoryPath = await getConfigValue('mainDirectory');
    const fullSourcePath = path.resolve(mainDirectoryPath, currentFilePath);
    const fullDestinationPath = path.resolve(mainDirectoryPath, newFilePath);

    if (existsSync(fullDestinationPath)) {
      return { success: false, error: "Destination file already exists" }
    }

    await rename(fullSourcePath, fullDestinationPath);
    return { success: true, error: null, output: newFilePath }
  } catch (error) {
    console.error('Error moving file:', error);
    return { success: false, error: error }
  }
});

ipcMain.handle("move-file", async (_, movingFilePath: string, destinationDirectoryPath: string) => {
  const destinationPath = path.join(destinationDirectoryPath, path.basename(movingFilePath));

  try {
    const mainDirectoryPath = await getConfigValue('mainDirectory');
    const fullSourcePath = path.resolve(mainDirectoryPath, movingFilePath);
    const fullDestinationPath = path.resolve(mainDirectoryPath, destinationPath);

    if (existsSync(fullDestinationPath)) {
      return { success: false, error: "Destination file already exists" }
    }

    await rename(fullSourcePath, fullDestinationPath);
    return { success: true, error: null, output: destinationPath }
  } catch (error) {
    console.error('Error moving file:', error);
    return { success: false, error: error }
  }
});

ipcMain.handle("delete-file", async (_, filePath: string) => {
  try {
    const mainDirectoryPath = await getConfigValue('mainDirectory');
    const fullPath = path.resolve(mainDirectoryPath, filePath);
    await unlink(fullPath);
    return { success: true, error: null }
  } catch (error) {
    console.error('Error deleting file:', error);
    return { success: false, error: error }
  }
})