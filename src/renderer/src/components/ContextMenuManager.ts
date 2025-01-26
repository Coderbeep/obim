// TODO: Dynamic menu rendering 
// - One top component that would render the menu items based on the context menu type

export enum ContextMenuType {
    Image = 'Image',
}

type ContextMenuCallback = (data: any) => void;

class ContextMenuManager {
    private menus: Record<ContextMenuType, ContextMenuCallback> = {};

    registerMenu(type: ContextMenuType, callback: ContextMenuCallback) {
        this.menus[type] = callback;
    }

    showMenu(type: ContextMenuType, data: any) {
        if (this.menus[type]) {
            this.menus[type](data);
        }
        else {
            console.error(`No menu registered for type: ${type}`);
        }
    }
}

const contextMenuManager = new ContextMenuManager();

export default contextMenuManager;