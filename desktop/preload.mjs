import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("desktopWidget", {
  getState: () => ipcRenderer.invoke("desktop:get-state"),
  getBounds: () => ipcRenderer.invoke("desktop:get-bounds"),
  setBounds: (bounds) => ipcRenderer.invoke("desktop:set-bounds", bounds),
  toggleLock: () => ipcRenderer.invoke("desktop:toggle-lock"),
  openPanel: () => ipcRenderer.invoke("desktop:open-panel"),
  minimize: () => ipcRenderer.invoke("desktop:minimize-widget"),
  close: () => ipcRenderer.invoke("desktop:close-widget"),
  onLockChanged: (callback) => {
    const listener = (_event, locked) => callback(locked)
    ipcRenderer.on("desktop:lock-changed", listener)
    return () => ipcRenderer.removeListener("desktop:lock-changed", listener)
  },
})
