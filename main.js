"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
let mainWindow = null;
let serverPort = null;
function createApplicationMenu() {
    const isMac = process.platform === "darwin";
    const appMenu = isMac
        ? [
            {
                label: electron_1.app.name,
                submenu: [
                    { role: "about" },
                    { type: "separator" },
                    { role: "hide" },
                    { role: "hideOthers" },
                    { role: "unhide" },
                    { type: "separator" },
                    { role: "quit" },
                ],
            },
        ]
        : [];
    const fileMenu = isMac
        ? []
        : [
            {
                label: "文件",
                submenu: [{ role: "quit" }],
            },
        ];
    const editMenu = {
        label: "编辑",
        submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "pasteAndMatchStyle" },
            { role: "delete" },
            { type: "separator" },
            { role: "selectAll" },
        ],
    };
    const viewMenu = {
        label: "显示",
        submenu: [
            { role: "reload" },
            { role: "toggleDevTools" },
            { type: "separator" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { type: "separator" },
            { role: "togglefullscreen" },
        ],
    };
    const windowMenu = {
        label: "窗口",
        submenu: isMac
            ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
            : [{ role: "minimize" }, { role: "close" }],
    };
    return electron_1.Menu.buildFromTemplate([...appMenu, ...fileMenu, editMenu, viewMenu, windowMenu]);
}
function startOkitServer() {
    if (serverPort)
        return Promise.resolve(serverPort);
    const serverPath = path_1.default.join(__dirname, "..", "web", "server.js");
    // The web server is CommonJS and copied into dist/web during the regular build.
    const { startServer } = require(serverPath);
    return new Promise((resolve) => {
        startServer(3780, (actualPort) => {
            serverPort = actualPort;
            resolve(actualPort);
        });
    });
}
async function createWindow() {
    const port = await startOkitServer();
    mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 1040,
        minHeight: 720,
        title: "OKIT",
        backgroundColor: "#07100b",
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    mainWindow.once("ready-to-show", () => {
        mainWindow?.show();
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (!url.startsWith(`http://localhost:${port}`) && !url.startsWith(`http://127.0.0.1:${port}`)) {
            electron_1.shell.openExternal(url);
            return { action: "deny" };
        }
        return { action: "allow" };
    });
    await mainWindow.loadURL(`http://127.0.0.1:${port}`);
}
electron_1.app.setName("OKIT");
electron_1.Menu.setApplicationMenu(createApplicationMenu());
electron_1.app.whenReady().then(async () => {
    await createWindow();
    electron_1.app.on("activate", async () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            await createWindow();
    });
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
//# sourceMappingURL=main.js.map