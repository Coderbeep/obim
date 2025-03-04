import { app, dialog, ipcMain } from 'electron';
import path from 'path';
import { readFile, writeFile } from 'fs/promises';
import { readFileSync } from 'fs';


class ConfigManager {
    private static CONFIGPATH = path.join(app.getPath("userData"), "config.json")

    static async initializeConfig(): Promise<boolean>  {
        try {
            const mainDirectoryPath = await this.promptUserForMainDirectory()
            if (mainDirectoryPath) {
                await this.updateConfig("mainDirectory", mainDirectoryPath)
                return true
            }
            return false
        } catch (error) {
            console.error("Erorr while initializing config:", error)
            return false
        }
    }

    static async getConfig(): Promise<Record<string, any>> {
        try {
            const content = await readFile(this.CONFIGPATH, 'utf-8');
            return JSON.parse(content);
        } catch {
            return {};
        }
    }

    static getConfigSync(): Record<string, any> {
        try {
            const content = readFileSync(this.CONFIGPATH, 'utf-8');
            return JSON.parse(content);
        } catch {
            return {};
        }
    }

    static async getConfigValue<T>(key: string): Promise<T> {
        const config = await this.getConfig();
        return config[key];
    }

    static getConfigValueSync<T>(key: string): T {
        const config = this.getConfigSync();
        return config[key];
    }

    static async isPropertyDefined(property: string): Promise<boolean> {
        const config = await this.getConfig();
        return !!config[property];
    }

    static isPropertyDefinedSync(property: string): boolean {
        const config = this.getConfigSync();
        return !!config[property];
    }

    static async updateConfig(key: string, value: any): Promise<void> {
        const config = await this.getConfig();
        config[key] = value;
        await this.saveConfig(config);
    }

    private static async promptUserForMainDirectory(): Promise<string | null> {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Select main directory',
        });
    
        if (result.canceled) {
            app.quit();
        }
        await this.updateConfig('mainDirectory', result.filePaths[0]);
        return result.filePaths[0];
    }
    
    private static async saveConfig(config: Record<string, any>): Promise<void> {
        await writeFile(this.CONFIGPATH, JSON.stringify(config, null, 2), 'utf-8');
    }
}

/////////////////////////////////////////////////////////////////////////////////////

ipcMain.handle("get-config", async () => ConfigManager.getConfig());

ipcMain.handle("get-config-value", async (_, key) => ConfigManager.getConfigValue(key));

ipcMain.handle("update-config", async (_, key, value) => ConfigManager.updateConfig(key, value));

ipcMain.on("get-main-directory-path-sync", (event) => {
    event.returnValue = ConfigManager.getConfigValueSync('mainDirectory');
});

ipcMain.handle("initialize-config", async () => ConfigManager.initializeConfig());

ipcMain.on("is-main-directory-defined-sync", (event) => {
    event.returnValue = ConfigManager.isPropertyDefinedSync('mainDirectory');
});


export default ConfigManager