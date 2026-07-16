import path from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow, ipcMain, nativeTheme, screen, shell } from "electron"
import { startServer } from "../server/index.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOST = process.env.HOST || "127.0.0.1"
const PORT = Number(process.env.PORT || 3847)
const APP_URL = `http://${HOST}:${PORT}/`
const WIDGET_URL = `${APP_URL}?mode=widget`
const WINDOW_BOUNDS_KEY = "widgetBounds760"
const WINDOW_LOCKED_KEY = "widgetLockedScaledFit"
const STORE_FILE = "desktop-settings.json"
const WIDGET_WIDTH = 760
const WIDGET_HEIGHT = 430
const WIDGET_MIN_WIDTH = 180
const WIDGET_MIN_HEIGHT = 72
const WIDGET_MAX_WIDTH = 1600
const WIDGET_MAX_HEIGHT = 1400

let server
let widgetWindow
let panelWindow
let store = {}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

async function loadStore() {
  const userDataDir = app.getPath("userData")
  const storePath = path.join(userDataDir, STORE_FILE)
  try {
    const raw = await readFile(storePath, "utf8")
    store = JSON.parse(raw)
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error("Failed to load desktop settings:", error)
    }
    store = {}
  }
}

async function persistStore() {
  const userDataDir = app.getPath("userData")
  const storePath = path.join(userDataDir, STORE_FILE)
  await mkdir(userDataDir, { recursive: true })
  await writeFile(storePath, JSON.stringify(store, null, 2), "utf8")
}

function readStore(key, fallback) {
  return key in store ? store[key] : fallback
}

function writeStore(key, value) {
  store[key] = value
  void persistStore()
}

function loadSavedBounds() {
  const bounds = readStore(WINDOW_BOUNDS_KEY, null)
  if (!bounds) return null
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return null
  if (
    bounds.width > WIDGET_MAX_WIDTH ||
    bounds.height > WIDGET_MAX_HEIGHT ||
    bounds.width < WIDGET_MIN_WIDTH ||
    bounds.height < WIDGET_MIN_HEIGHT
  ) {
    return null
  }
  return bounds
}

function defaultWidgetBounds() {
  const area = screen.getPrimaryDisplay().workArea
  return {
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
    x: area.x + area.width - WIDGET_WIDTH - 24,
    y: area.y + 44,
  }
}

function currentLockState() {
  return Boolean(readStore(WINDOW_LOCKED_KEY, false))
}

function clampWidgetBounds(bounds) {
  const current = widgetWindow?.getBounds() || defaultWidgetBounds()
  return {
    x: Number.isFinite(bounds?.x) ? Math.round(bounds.x) : current.x,
    y: Number.isFinite(bounds?.y) ? Math.round(bounds.y) : current.y,
    width: Math.max(WIDGET_MIN_WIDTH, Math.min(WIDGET_MAX_WIDTH, Math.round(bounds?.width || current.width))),
    height: Math.max(WIDGET_MIN_HEIGHT, Math.min(WIDGET_MAX_HEIGHT, Math.round(bounds?.height || current.height))),
  }
}

function applyWindowLockState(win, locked) {
  win.setMovable(!locked)
  win.setResizable(!locked)
  win.setAlwaysOnTop(false)
  win.setVisibleOnAllWorkspaces(false)
  win.setSkipTaskbar(true)
}

async function ensureServer() {
  if (server) return server
  if (await isExistingDashboardAvailable()) return null
  try {
    server = await startServer({ host: HOST, port: PORT })
  } catch (error) {
    if (error?.code === "EADDRINUSE" && (await isExistingDashboardAvailable())) return null
    throw error
  }
  return server
}

async function isExistingDashboardAvailable() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1200)
  try {
    const response = await fetch(`${APP_URL}api/health`, { signal: controller.signal })
    const data = await response.json().catch(() => null)
    return response.ok && data?.ok === true
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

function createWidgetWindow() {
  const bounds = loadSavedBounds() || defaultWidgetBounds()
  widgetWindow = new BrowserWindow({
    ...bounds,
    minWidth: WIDGET_MIN_WIDTH,
    minHeight: WIDGET_MIN_HEIGHT,
    maxWidth: WIDGET_MAX_WIDTH,
    maxHeight: WIDGET_MAX_HEIGHT,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    movable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    title: "账号额度桌面挂件",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  applyWindowLockState(widgetWindow, currentLockState())

  widgetWindow.on("move", () => {
    if (widgetWindow?.isDestroyed()) return
    writeStore(WINDOW_BOUNDS_KEY, widgetWindow.getBounds())
  })

  widgetWindow.on("resize", () => {
    if (widgetWindow?.isDestroyed()) return
    writeStore(WINDOW_BOUNDS_KEY, widgetWindow.getBounds())
  })

  widgetWindow.on("closed", () => {
    widgetWindow = null
  })

  widgetWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  widgetWindow.loadURL(WIDGET_URL)
}

function createPanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.show()
    panelWindow.focus()
    return panelWindow
  }

  panelWindow = new BrowserWindow({
    width: 690,
    height: 860,
    minWidth: 650,
    minHeight: 680,
    autoHideMenuBar: true,
    title: "账号额度面板",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#101820" : "#f6f7f9",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  panelWindow.on("closed", () => {
    panelWindow = null
  })

  panelWindow.loadURL(APP_URL)
  return panelWindow
}

async function showWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    if (widgetWindow.isMinimized()) widgetWindow.restore()
    widgetWindow.setSkipTaskbar(true)
    widgetWindow.showInactive()
    return widgetWindow
  }
  await ensureServer()
  createWidgetWindow()
  return widgetWindow
}

function registerIpc() {
  ipcMain.handle("desktop:get-state", () => {
    return {
      isDesktop: true,
      locked: currentLockState(),
    }
  })

  ipcMain.handle("desktop:get-bounds", () => {
    if (!widgetWindow || widgetWindow.isDestroyed()) return null
    return widgetWindow.getBounds()
  })

  ipcMain.handle("desktop:set-bounds", (_event, bounds) => {
    if (!widgetWindow || widgetWindow.isDestroyed()) return null
    if (currentLockState()) return widgetWindow.getBounds()
    const nextBounds = clampWidgetBounds(bounds)
    widgetWindow.setBounds(nextBounds, false)
    writeStore(WINDOW_BOUNDS_KEY, widgetWindow.getBounds())
    return widgetWindow.getBounds()
  })

  ipcMain.handle("desktop:toggle-lock", () => {
    const nextLocked = !currentLockState()
    writeStore(WINDOW_LOCKED_KEY, nextLocked)
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      applyWindowLockState(widgetWindow, nextLocked)
      widgetWindow.webContents.send("desktop:lock-changed", nextLocked)
    }
    return { locked: nextLocked }
  })

  ipcMain.handle("desktop:open-panel", () => {
    createPanelWindow()
    return { ok: true }
  })

  ipcMain.handle("desktop:minimize-widget", () => {
    widgetWindow?.hide()
    return { ok: true }
  })

  ipcMain.handle("desktop:close-widget", () => {
    widgetWindow?.hide()
    return { ok: true }
  })
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (app.isReady()) void showWidgetWindow()
  })

  app.whenReady().then(async () => {
    await loadStore()
    registerIpc()
    await ensureServer()
    createWidgetWindow()
    app.on("activate", () => {
      void showWidgetWindow()
    })
  })
}

app.on("window-all-closed", () => {
  // Keep the background process alive; the desktop shortcut can reveal the widget again.
})

app.on("before-quit", async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve))
    server = null
  }
})
