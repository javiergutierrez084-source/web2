import { BrowserWindow, dialog } from "electron";
import fs from "fs";



function log(message) {
console.log(`[PrintLog] ${message}`);
}

function createRenderWindow() {
  return new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    backgroundColor: "#ffffff",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });
}
async function loadHtml(win, html) {
const b64 = Buffer.from(html, "utf8").toString("base64");
await win.loadURL(
  `data:text/html;charset=utf-8;base64,${b64}`
);
await win.webContents.executeJavaScript("document.body.offsetHeight");
await new Promise(r => setTimeout(r, 500));
}

function getPageSize(paper) {
if (paper === "Tirilla 80 mm") return { width: 80000, height: 500000 };
if (paper === "Tirilla 58 mm") return { width: 58000, height: 500000 };
if (paper === "Carta") return "Letter";
return paper || "Letter";
}

async function handlePrint(event, { html, paper, landscape, title }) {
let win = null;
try {
win = createRenderWindow();
if (title) win.setTitle(title);

    await loadHtml(win, html);

    return await new Promise((resolve) => {
        win.webContents.print({
            silent: false,
            printBackground: true,
            landscape: !!landscape,
            pageSize: getPageSize(paper)
        }, (success, failureReason) => {
            if (win && !win.isDestroyed()) win.destroy();
            if (success) {
                resolve({ success: true });
            } else {
                resolve({ success: false, error: failureReason || "Impresión cancelada o fallida" });
            }
        });
    });
} catch (error) {
    log(error.message);
    if (win && !win.isDestroyed()) win.destroy();
    return { success: false, error: error.message };
}
}

async function handleSavePDF(event, { html, title }) {
let win = null;
try {
const { canceled, filePath } = await dialog.showSaveDialog({
title: "Guardar PDF",
defaultPath: title ? `${title}.pdf` : "documento.pdf",
filters: [{ name: "PDF", extensions: ["pdf"] }]
});

    if (canceled || !filePath) {
        return { success: false, error: "Operación cancelada por el usuario" };
    }

    win = createRenderWindow();
    await loadHtml(win, html);

    const pdfData = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: "Letter",
landscape: false,
    displayHeaderFooter: false
    });

    fs.writeFileSync(filePath, pdfData);

    if (win && !win.isDestroyed()) win.destroy();
    return { success: true, filePath: filePath };
} catch (error) {
    log(error.message);
    if (win && !win.isDestroyed()) win.destroy();
    return { success: false, error: error.message };
}
}

async function handleGetPrinters() {
let win = null;
try {
win = createRenderWindow();
await win.loadURL(
    "data:text/html,<html><body></body></html>"
);
const printers = await win.webContents.getPrintersAsync();
if (win && !win.isDestroyed()) win.destroy();
return printers;
} catch (error) {
log(error.message);
if (win && !win.isDestroyed()) win.destroy();
return [];
}
}

export function registerPrintHandlers(ipcMain) {
ipcMain.handle("print:print", handlePrint);
ipcMain.handle("print:save-pdf", handleSavePDF);
ipcMain.handle("print:get-printers", handleGetPrinters);
}