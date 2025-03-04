import { app, dialog, ipcMain } from 'electron';
import path from 'path';
import { readFile, writeFile } from 'fs/promises';
import { readFileSync } from 'fs';

const CONFIGPATH = path.join(app.getPath('userData'), 'config.json');

async function getConfig() {
    try {
        const content = await readFile(CONFIGPATH, 'utf-8');
        return JSON.parse(content);
    } catch {
        return {};
    }
}

export async function getConfigValue(key: string): Promise<any> {
    const config = await getConfig();
    return config[key];
}

async function saveConfig(config) {
    await writeFile(CONFIGPATH, JSON.stringify(config, null, 2), 'utf-8');
}

async function updateConfig(key: string, value: any): Promise<void> {
    const config = await getConfig();
    config[key] = value;
    await saveConfig(config);
}

export async function isPropertyDefined(property: string): Promise<boolean> {
    const config = await getConfig();
    return !!config[property];
}

export async function promptUserForMainDirectory(): Promise<string> {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select main directory',
    });

    if (result.canceled) return '';
    await updateConfig('mainDirectory', result.filePaths[0]);
    return result.filePaths[0];
}

/////////////////////////////////////////////////////////////////////////////////////

ipcMain.handle("get-config", async () => {
    return getConfig();
})

ipcMain.handle("get-config-value", async (_, key) => {
    return getConfigValue(key);
})

ipcMain.handle("update-config", async (_, key, value) => {
    return updateConfig(key, value);
})

ipcMain.on("get-main-directory-path-sync", (event) => {
    const content = readFileSync(CONFIGPATH, 'utf-8');
    const config = JSON.parse(content);
    event.returnValue = config.mainDirectory;
})