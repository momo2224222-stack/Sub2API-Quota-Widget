const state = {
  accounts: [],
  editingId: null,
  pending2FA: null,
  autoRefreshing: false,
  changedMetricKeys: new Set(),
  viewMode: "full",
  desktop: {
    available: false,
    locked: false,
    layoutWidth: 760,
    zoom: 1,
  },
}

const els = {
  body: document.body,
  widgetContent: document.querySelector("#widgetContent"),
  accountList: document.querySelector("#accountList"),
  emptyState: document.querySelector("#emptyState"),
  summaryText: document.querySelector("#summaryText"),
  toast: document.querySelector("#toast"),
  accountModal: document.querySelector("#accountModal"),
  form: document.querySelector("#accountForm"),
  formTitle: document.querySelector("#formTitle"),
  cancelEditBtn: document.querySelector("#cancelEditBtn"),
  closeFormBtn: document.querySelector("#closeFormBtn"),
  refreshAllBtn: document.querySelector("#refreshAllBtn"),
  openAddBtn: document.querySelector("#openAddBtn"),
  parseBtn: document.querySelector("#parseBtn"),
  accountId: document.querySelector("#accountId"),
  nameInput: document.querySelector("#nameInput"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  baseUrlHistory: document.querySelector("#baseUrlHistory"),
  loginEmailInput: document.querySelector("#loginEmailInput"),
  loginPasswordInput: document.querySelector("#loginPasswordInput"),
  turnstileTokenInput: document.querySelector("#turnstileTokenInput"),
  loginBtn: document.querySelector("#loginBtn"),
  twoFactorBlock: document.querySelector("#twoFactorBlock"),
  twoFactorEmail: document.querySelector("#twoFactorEmail"),
  twoFactorCodeInput: document.querySelector("#twoFactorCodeInput"),
  twoFactorBtn: document.querySelector("#twoFactorBtn"),
  accessTokenInput: document.querySelector("#accessTokenInput"),
  refreshTokenInput: document.querySelector("#refreshTokenInput"),
  tokenExpiresAtInput: document.querySelector("#tokenExpiresAtInput"),
  pasteInput: document.querySelector("#pasteInput"),
  widgetToolbar: document.querySelector("#widgetToolbar"),
  widgetOpenPanelBtn: document.querySelector("#widgetOpenPanelBtn"),
  widgetLockBtn: document.querySelector("#widgetLockBtn"),
  widgetMinimizeBtn: document.querySelector("#widgetMinimizeBtn"),
  widgetCloseBtn: document.querySelector("#widgetCloseBtn"),
  widgetWidthHandle: document.querySelector("#widgetWidthHandle"),
  widgetResizeHandle: document.querySelector("#widgetResizeHandle"),
}

const BASE_URL_HISTORY_KEY = "account-dashboard.baseUrlHistory"
const AUTO_REFRESH_MS = 60_000
const VIEW_MODE = new URLSearchParams(window.location.search).get("mode") === "widget" ? "widget" : "full"
const WIDGET_VIEWPORT_PADDING = 16
const WIDGET_LAYOUT_WIDTH_KEY = "account-dashboard.widgetLayoutWidth"
const WIDGET_ZOOM_KEY = "account-dashboard.widgetZoom"
const WIDGET_DEFAULT_LAYOUT_WIDTH = 760
const WIDGET_MIN_LAYOUT_WIDTH = 390
const WIDGET_MAX_LAYOUT_WIDTH = 1080
const WIDGET_MIN_ZOOM = 0.35
const WIDGET_MAX_ZOOM = 1.4

state.viewMode = VIEW_MODE
els.body.classList.toggle("widget-mode", VIEW_MODE === "widget")

function normalizeBaseUrlInput(value) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  try {
    const url = new URL(raw)
    url.hash = ""
    url.search = ""
    return url.toString().replace(/\/+$/, "")
  } catch {
    return raw
  }
}

function readBaseUrlHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BASE_URL_HISTORY_KEY) || "[]")
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 12) : []
  } catch {
    return []
  }
}

function writeBaseUrlHistory(items) {
  localStorage.setItem(BASE_URL_HISTORY_KEY, JSON.stringify(items.slice(0, 12)))
}

function rememberBaseUrl(value) {
  const normalized = normalizeBaseUrlInput(value)
  if (!normalized) return
  const next = [normalized, ...readBaseUrlHistory().filter((item) => item !== normalized)]
  writeBaseUrlHistory(next)
  renderBaseUrlHistory()
}

function syncBaseUrlHistoryFromAccounts() {
  const accountUrls = state.accounts.map((account) => normalizeBaseUrlInput(account.baseUrl)).filter(Boolean)
  const next = [...accountUrls, ...readBaseUrlHistory()]
  writeBaseUrlHistory([...new Set(next)])
  renderBaseUrlHistory()
}

function renderBaseUrlHistory() {
  els.baseUrlHistory.innerHTML = readBaseUrlHistory()
    .map((url) => `<option value="${htmlEscape(url)}"></option>`)
    .join("")
}

function formatUsd(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-"
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value).replace(/^US\$/, "$")
}

function formatMetricUsd(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-"
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 2 : 4,
    maximumFractionDigits: value >= 100 ? 2 : 4,
  }).format(value).replace(/^US\$/, "$")
}

function renderMoney(value) {
  return `<span class="money">${formatMetricUsd(value)}</span>`
}

function usagePercent(used, limit) {
  if (typeof used !== "number" || typeof limit !== "number" || !Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
    return null
  }
  return Math.max(0, Math.min(100, (used / limit) * 100))
}

function hasQuotaData(remain, used, limit) {
  return (
    (typeof limit === "number" && Number.isFinite(limit) && limit > 0) ||
    (typeof used === "number" && Number.isFinite(used) && used > 0) ||
    (typeof remain === "number" && Number.isFinite(remain) && remain > 0)
  )
}

function daysUntil(value) {
  if (!value) return null
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return null
  return Math.max(0, Math.ceil((time - Date.now()) / 86_400_000))
}

function nearestSubscriptionExpiry(subscriptions) {
  const items = Array.isArray(subscriptions?.items) ? subscriptions.items : []
  return items
    .map((item) => ({ item, time: new Date(item.expiresAt).getTime() }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((a, b) => a.time - b.time)[0]?.item?.expiresAt || null
}

function formatTime(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("zh-CN")
}

function formatShortTime(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function showToast(message, variant = "normal") {
  els.toast.textContent = message
  els.toast.className = `toast ${variant === "error" ? "error" : ""}`
  window.clearTimeout(showToast.timer)
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.add("hidden")
  }, 3600)
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`)
  }
  return payload
}

function accountStatus(account) {
  if (account.status === "healthy") return "healthy"
  if (account.status === "error") return "error"
  return "unknown"
}

function metricValues(account) {
  const latest = account.latest || {}
  const subscriptions = latest.subscriptions || {}
  return {
    status: account.status || "unknown",
    balance: latest.balanceUsd ?? null,
    daily: `${subscriptions.dailyRemainUsd ?? ""}|${subscriptions.dailyUsedUsd ?? ""}|${subscriptions.dailyLimitUsd ?? ""}`,
    monthly: `${subscriptions.monthlyRemainUsd ?? ""}|${subscriptions.monthlyUsedUsd ?? ""}|${subscriptions.monthlyLimitUsd ?? ""}`,
  }
}

function metricChangedClass(accountId, metricName) {
  return state.changedMetricKeys.has(`${accountId}:${metricName}`) ? " changed" : ""
}

function markChangedMetrics(previousAccounts, nextAccounts) {
  const previousById = new Map(previousAccounts.map((account) => [account.id, metricValues(account)]))
  const changed = new Set()
  for (const account of nextAccounts) {
    const before = previousById.get(account.id)
    if (!before) continue
    const after = metricValues(account)
    for (const key of Object.keys(after)) {
      if (before[key] !== after[key]) changed.add(`${account.id}:${key}`)
    }
  }
  state.changedMetricKeys = changed
  if (changed.size) {
    window.clearTimeout(markChangedMetrics.timer)
    markChangedMetrics.timer = window.setTimeout(() => {
      state.changedMetricKeys = new Set()
      render()
    }, 1200)
  }
}

function renderQuotaMetric({ accountId, metricName, label, remain, used, limit, daysLeft = null, highlight = false }) {
  if (!hasQuotaData(remain, used, limit)) return ""
  const percent = usagePercent(used, limit)
  const changed = metricChangedClass(accountId, metricName)
  const classes = `metric quota-metric${highlight ? " highlight" : ""}${changed}`
  const usageText = percent === null ? "未返回总量" : `${renderMoney(used)} / ${renderMoney(limit)}`
  const percentText = percent === null ? "" : `${Math.round(percent)}% 已用`
  const barStyle = percent === null ? "" : ` style="--usage: ${percent.toFixed(2)}%"`
  return `
    <div class="${classes}">
      <div class="metric-row">
        <span>${label}</span>
        <div class="metric-badges">
          ${daysLeft === null ? "" : `<b>${daysLeft} 天</b>`}
          <em>${htmlEscape(percentText)}</em>
        </div>
      </div>
      <strong>${renderMoney(remain)}</strong>
      <div class="usage-bar"${barStyle}><i></i></div>
      <small>${usageText}</small>
    </div>
  `
}

function renderWidgetCard(account) {
  const latest = account.latest || {}
  const subscriptions = latest.subscriptions || {}
  const status = accountStatus(account)
  const monthlyRemain = subscriptions.monthlyRemainUsd ?? latest.balanceUsd ?? null
  const expiryDays = daysUntil(nearestSubscriptionExpiry(subscriptions))
  return `
    <article class="account-card widget-card" data-id="${account.id}">
      <div class="widget-card-head">
        <div>
          <span class="widget-label">账号</span>
          <strong title="${htmlEscape(account.name)}">${htmlEscape(account.name)}</strong>
        </div>
        <span class="status ${status}">${status === "healthy" ? "正常" : status === "error" ? "异常" : "未刷新"}</span>
      </div>
      <div class="widget-balance">
        <span>本月剩余</span>
        <strong>${renderMoney(monthlyRemain)}</strong>
      </div>
      <div class="widget-grid">
        <div class="metric compact">
          <span>账户余额</span>
          <strong>${renderMoney(latest.balanceUsd)}</strong>
        </div>
        <div class="metric compact">
          <span>今日剩余</span>
          <strong>${renderMoney(subscriptions.dailyRemainUsd)}</strong>
        </div>
        <div class="metric compact">
          <span>到期倒计时</span>
          <strong>${expiryDays === null ? "-" : `${expiryDays} 天`}</strong>
        </div>
      </div>
      <div class="widget-foot">
        <small title="${htmlEscape(account.baseUrl)}">${htmlEscape(account.baseUrl)}</small>
        <small>${formatShortTime(latest.refreshedAt)}</small>
      </div>
    </article>
  `
}

function renderFullAccount(account) {
  const latest = account.latest || {}
  const subscriptions = latest.subscriptions || {}
  const status = accountStatus(account)
  const hasDailyQuota = hasQuotaData(subscriptions.dailyRemainUsd, subscriptions.dailyUsedUsd, subscriptions.dailyLimitUsd)
  const hasMonthlyQuota = hasQuotaData(subscriptions.monthlyRemainUsd, subscriptions.monthlyUsedUsd, subscriptions.monthlyLimitUsd)
  const hasQuota = hasDailyQuota || hasMonthlyQuota
  const quotaLayoutClass = hasQuota ? "" : " no-quota"
  const cardLayoutClass = hasQuota ? "" : " no-quota-card"
  return `
    <article class="account-card${cardLayoutClass}" data-id="${account.id}">
      <div class="account-main">
        <div class="account-metrics${quotaLayoutClass}">
          <div class="metric account-summary${metricChangedClass(account.id, "status")}${metricChangedClass(account.id, "balance")}">
            <span>账号</span>
            <div class="account-name-row">
              <strong>${htmlEscape(account.name)}</strong>
              <span class="status ${status}">${status === "healthy" ? "正常" : status === "error" ? "异常" : "未刷新"}</span>
            </div>
            <small title="${htmlEscape(account.baseUrl)}">${htmlEscape(account.baseUrl)}</small>
            <div class="summary-balance">
              <strong>${renderMoney(latest.balanceUsd)}</strong>
            </div>
          </div>
          ${renderQuotaMetric({
            accountId: account.id,
            metricName: "daily",
            label: "今日余额",
            remain: subscriptions.dailyRemainUsd,
            used: subscriptions.dailyUsedUsd,
            limit: subscriptions.dailyLimitUsd,
          })}
          ${renderQuotaMetric({
            accountId: account.id,
            metricName: "monthly",
            label: "本月余额",
            remain: subscriptions.monthlyRemainUsd,
            used: subscriptions.monthlyUsedUsd,
            limit: subscriptions.monthlyLimitUsd,
            daysLeft: daysUntil(nearestSubscriptionExpiry(subscriptions)),
            highlight: true,
          })}
          <div class="metric action-metric">
            <span>操作</span>
            <div class="row-actions">
              <button data-action="edit">编辑</button>
              <button data-action="delete" class="danger">删除</button>
            </div>
          </div>
        </div>
      </div>
    </article>
  `
}

function render() {
  if (els.summaryText) {
    els.summaryText.textContent =
      state.viewMode === "widget"
        ? `${state.accounts.length} 个账号，自动刷新中`
        : `${state.accounts.length} 个账号`
  }
  els.emptyState.classList.toggle("hidden", state.accounts.length > 0)
  els.accountList.innerHTML = state.accounts
    .map(renderFullAccount)
    .join("")
  applyWidgetSizing()
}

async function loadAccounts({ animateChanges = false } = {}) {
  const data = await api("/api/accounts")
  const nextAccounts = data.accounts || []
  if (animateChanges) markChangedMetrics(state.accounts, nextAccounts)
  state.accounts = nextAccounts
  syncBaseUrlHistoryFromAccounts()
  render()
}

async function autoRefreshAccounts() {
  if (state.autoRefreshing) return
  if (document.hidden) return
  if (state.viewMode !== "widget" && !els.accountModal.classList.contains("hidden")) return
  if (!state.accounts.length) return
  state.autoRefreshing = true
  try {
    const data = await api("/api/refresh-all", {
      method: "POST",
      body: "{}",
    })
    const nextAccounts = data.accounts || []
    markChangedMetrics(state.accounts, nextAccounts)
    state.accounts = nextAccounts
    syncBaseUrlHistoryFromAccounts()
    render()
  } catch {
    // Auto refresh stays quiet; manual refresh still reports errors.
  } finally {
    state.autoRefreshing = false
  }
}

function openAccountModal() {
  if (state.viewMode === "widget") return
  els.accountModal.classList.remove("hidden")
  document.body.classList.add("modal-open")
  window.setTimeout(() => {
    ;(els.nameInput.value ? els.baseUrlInput : els.nameInput).focus()
  }, 0)
}

function closeAccountModal() {
  if (state.viewMode === "widget") return
  els.accountModal.classList.add("hidden")
  document.body.classList.remove("modal-open")
}

function clearLoginState(clearCredentials = true) {
  state.pending2FA = null
  els.twoFactorBlock.classList.add("hidden")
  els.twoFactorEmail.textContent = ""
  els.twoFactorCodeInput.value = ""
  if (clearCredentials) {
    els.turnstileTokenInput.value = ""
  }
}

function applyTokenResult(result) {
  if (result.accessToken) els.accessTokenInput.value = result.accessToken
  if (result.refreshToken) els.refreshTokenInput.value = result.refreshToken
  if (result.tokenExpiresAt) els.tokenExpiresAtInput.value = result.tokenExpiresAt
}

function resetForm() {
  if (state.viewMode === "widget") return
  state.editingId = null
  els.form.reset()
  els.accountId.value = ""
  els.formTitle.textContent = "新增 Sub2API 账号"
  els.cancelEditBtn.classList.add("hidden")
  clearLoginState(false)
  renderBaseUrlHistory()
}

function fillForm(account) {
  if (state.viewMode === "widget") return
  state.editingId = account.id
  els.accountId.value = account.id
  els.nameInput.value = account.name || ""
  els.baseUrlInput.value = account.baseUrl || ""
  els.loginEmailInput.value = account.loginEmail || ""
  els.loginPasswordInput.value = ""
  els.accessTokenInput.value = ""
  els.refreshTokenInput.value = ""
  els.tokenExpiresAtInput.value = account.tokenExpiresAt ? String(account.tokenExpiresAt) : ""
  els.pasteInput.value = ""
  els.formTitle.textContent = `编辑：${account.name}`
  els.cancelEditBtn.classList.remove("hidden")
  clearLoginState()
  rememberBaseUrl(account.baseUrl)
  openAccountModal()
}

function formPayload() {
  return {
    name: els.nameInput.value,
    baseUrl: els.baseUrlInput.value,
    accessToken: els.accessTokenInput.value,
    refreshToken: els.refreshTokenInput.value,
    tokenExpiresAt: els.tokenExpiresAtInput.value,
    loginEmail: els.loginEmailInput.value,
    loginPassword: els.loginPasswordInput.value,
  }
}

function updateWidgetLockButton() {
  if (!els.widgetLockBtn) return
  els.widgetLockBtn.textContent = state.desktop.locked ? "解锁位置" : "锁定位置"
  els.widgetLockBtn.title = state.desktop.locked ? "允许拖动和缩放挂件" : "固定挂件的位置和大小"
  els.body.classList.toggle("widget-locked", state.desktop.locked)
  els.widgetWidthHandle?.classList.toggle("hidden", state.viewMode !== "widget" || state.desktop.locked)
  els.widgetResizeHandle?.classList.toggle("hidden", state.viewMode !== "widget" || state.desktop.locked)
}

function clampNumber(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.max(min, Math.min(max, number))
}

function readStoredNumber(key, fallback) {
  try {
    const value = Number(localStorage.getItem(key))
    return Number.isFinite(value) ? value : fallback
  } catch {
    return fallback
  }
}

function writeStoredNumber(key, value) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // Ignore storage failures; the widget still works for the current session.
  }
}

function readWidgetLayoutWidth() {
  return Math.round(clampNumber(readStoredNumber(WIDGET_LAYOUT_WIDTH_KEY, WIDGET_DEFAULT_LAYOUT_WIDTH), WIDGET_MIN_LAYOUT_WIDTH, WIDGET_MAX_LAYOUT_WIDTH))
}

function readWidgetZoom() {
  return clampNumber(readStoredNumber(WIDGET_ZOOM_KEY, 1), WIDGET_MIN_ZOOM, WIDGET_MAX_ZOOM)
}

function setWidgetLayoutWidth(value, { persist = true, fitWindow = true } = {}) {
  const nextWidth = Math.round(clampNumber(value, WIDGET_MIN_LAYOUT_WIDTH, WIDGET_MAX_LAYOUT_WIDTH))
  state.desktop.layoutWidth = nextWidth
  if (persist) writeStoredNumber(WIDGET_LAYOUT_WIDTH_KEY, nextWidth)
  applyWidgetSizing({ fitWindow })
  return nextWidth
}

function setWidgetZoom(value, { persist = true, fitWindow = true } = {}) {
  const nextZoom = clampNumber(value, WIDGET_MIN_ZOOM, WIDGET_MAX_ZOOM)
  state.desktop.zoom = nextZoom
  if (persist) writeStoredNumber(WIDGET_ZOOM_KEY, Number(nextZoom.toFixed(4)))
  applyWidgetSizing({ fitWindow })
  return nextZoom
}

function targetWidgetWidth(layoutWidth = state.desktop.layoutWidth, zoom = state.desktop.zoom) {
  return Math.ceil(layoutWidth * zoom + WIDGET_VIEWPORT_PADDING)
}

function targetWidgetHeight(zoom = state.desktop.zoom) {
  const contentHeight = els.widgetContent?.offsetHeight || 1
  return Math.ceil(contentHeight * zoom + WIDGET_VIEWPORT_PADDING)
}

let widgetFitFrame = 0

function applyWidgetSizing({ fitWindow = true } = {}) {
  if (state.viewMode !== "widget" || !els.widgetContent) return
  els.body.style.setProperty("--widget-layout-width", `${state.desktop.layoutWidth}px`)
  els.body.style.setProperty("--widget-zoom", state.desktop.zoom.toFixed(4))
  if (fitWindow) scheduleWidgetWindowFit()
}

function scheduleWidgetWindowFit() {
  window.cancelAnimationFrame(widgetFitFrame)
  widgetFitFrame = window.requestAnimationFrame(() => {
    void fitWidgetWindow()
  })
}

async function fitWidgetWindow(baseBounds = null) {
  if (state.viewMode !== "widget" || state.desktop.locked || !window.desktopWidget?.getBounds || !window.desktopWidget?.setBounds) return
  const bounds = baseBounds || (await window.desktopWidget.getBounds())
  if (!bounds) return
  const nextBounds = {
    ...bounds,
    width: targetWidgetWidth(),
    height: targetWidgetHeight(),
  }
  if (Math.abs(bounds.width - nextBounds.width) < 3 && Math.abs(bounds.height - nextBounds.height) < 3) return
  await window.desktopWidget.setBounds(nextBounds)
}

function initializeWidgetSizingControls() {
  if (state.viewMode !== "widget" || !window.desktopWidget) return
  let dragState = null

  const beginDrag = async (event, type, handle) => {
    if (state.desktop.locked) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = await window.desktopWidget.getBounds?.()
    if (!bounds) return
    dragState = {
      type,
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      startLayoutWidth: state.desktop.layoutWidth,
      startZoom: state.desktop.zoom,
      startPhysicalWidth: Math.max(1, targetWidgetWidth() - WIDGET_VIEWPORT_PADDING),
      startPhysicalHeight: Math.max(1, targetWidgetHeight() - WIDGET_VIEWPORT_PADDING),
      bounds,
    }
    handle.setPointerCapture(event.pointerId)
    els.body.classList.add("widget-resizing")
  }

  const moveDrag = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return
    event.preventDefault()
    const deltaX = event.screenX - dragState.startX
    const deltaY = event.screenY - dragState.startY

    if (dragState.type === "width") {
      setWidgetLayoutWidth(dragState.startLayoutWidth + deltaX / dragState.startZoom, { fitWindow: false })
    } else {
      const widthRatio = (dragState.startPhysicalWidth + deltaX) / dragState.startPhysicalWidth
      const heightRatio = (dragState.startPhysicalHeight + deltaY) / dragState.startPhysicalHeight
      const ratio = Math.abs(deltaX) >= Math.abs(deltaY) ? widthRatio : heightRatio
      setWidgetZoom(dragState.startZoom * ratio, { fitWindow: false })
    }

    void fitWidgetWindow(dragState.bounds)
  }

  const endResize = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return
    dragState = null
    els.body.classList.remove("widget-resizing")
    applyWidgetSizing()
  }

  els.widgetWidthHandle?.addEventListener("pointerdown", (event) => {
    void beginDrag(event, "width", els.widgetWidthHandle)
  })
  els.widgetResizeHandle?.addEventListener("pointerdown", (event) => {
    void beginDrag(event, "zoom", els.widgetResizeHandle)
  })
  els.widgetWidthHandle?.addEventListener("pointermove", moveDrag)
  els.widgetResizeHandle?.addEventListener("pointermove", moveDrag)
  els.widgetWidthHandle?.addEventListener("pointerup", endResize)
  els.widgetResizeHandle?.addEventListener("pointerup", endResize)
  els.widgetWidthHandle?.addEventListener("pointercancel", endResize)
  els.widgetResizeHandle?.addEventListener("pointercancel", endResize)
}

async function initializeDesktopWidget() {
  if (state.viewMode !== "widget") return
  const bridge = window.desktopWidget
  if (!bridge) return
  state.desktop.available = true
  state.desktop.layoutWidth = readWidgetLayoutWidth()
  state.desktop.zoom = readWidgetZoom()
  const desktopState = await bridge.getState().catch(() => null)
  state.desktop.locked = Boolean(desktopState?.locked)
  els.widgetToolbar.classList.remove("hidden")
  applyWidgetSizing({ fitWindow: false })
  updateWidgetLockButton()
  initializeWidgetSizingControls()
  applyWidgetSizing()
  if (typeof bridge.onLockChanged === "function") {
    bridge.onLockChanged((locked) => {
      state.desktop.locked = Boolean(locked)
      updateWidgetLockButton()
      applyWidgetSizing()
    })
  }
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault()
  try {
    const id = state.editingId
    const payload = formPayload()
    rememberBaseUrl(payload.baseUrl)
    if (id) {
      await api(`/api/accounts/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      })
      showToast("账号已更新")
    } else {
      await api("/api/accounts", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      showToast("账号已新增")
    }
    resetForm()
    closeAccountModal()
    await loadAccounts()
  } catch (error) {
    showToast(error.message, "error")
  }
})

els.loginBtn.addEventListener("click", async () => {
  try {
    els.loginBtn.disabled = true
    els.loginBtn.textContent = "登录中"
    const result = await api("/api/sub2api-login", {
      method: "POST",
      body: JSON.stringify({
        baseUrl: els.baseUrlInput.value,
        email: els.loginEmailInput.value,
        password: els.loginPasswordInput.value,
        turnstileToken: els.turnstileTokenInput.value,
      }),
    })
    if (result.requires2FA) {
      state.pending2FA = {
        baseUrl: els.baseUrlInput.value,
        tempToken: result.tempToken,
      }
      els.twoFactorEmail.textContent = result.userEmailMasked || els.loginEmailInput.value
      els.twoFactorBlock.classList.remove("hidden")
      els.twoFactorCodeInput.focus()
      showToast("需要 2FA 验证码")
      return
    }
    rememberBaseUrl(els.baseUrlInput.value)
    applyTokenResult(result)
    clearLoginState(false)
    showToast("Token 已获取，请保存账号")
  } catch (error) {
    showToast(error.message, "error")
  } finally {
    els.loginBtn.disabled = false
    els.loginBtn.textContent = "登录获取 Token"
  }
})

els.twoFactorBtn.addEventListener("click", async () => {
  try {
    if (!state.pending2FA) throw new Error("请先用账号密码登录")
    els.twoFactorBtn.disabled = true
    els.twoFactorBtn.textContent = "验证中"
    const result = await api("/api/sub2api-login-2fa", {
      method: "POST",
      body: JSON.stringify({
        baseUrl: state.pending2FA.baseUrl,
        tempToken: state.pending2FA.tempToken,
        totpCode: els.twoFactorCodeInput.value,
      }),
    })
    rememberBaseUrl(state.pending2FA.baseUrl)
    applyTokenResult(result)
    clearLoginState(false)
    showToast("Token 已获取，请保存账号")
  } catch (error) {
    showToast(error.message, "error")
  } finally {
    els.twoFactorBtn.disabled = false
    els.twoFactorBtn.textContent = "提交 2FA"
  }
})

els.parseBtn.addEventListener("click", async () => {
  try {
    const result = await api("/api/parse-sub2api", {
      method: "POST",
      body: JSON.stringify({ text: els.pasteInput.value }),
    })
    applyTokenResult(result)
    showToast("解析完成")
  } catch (error) {
    showToast(error.message, "error")
  }
})

els.accountList.addEventListener("click", async (event) => {
  if (state.viewMode === "widget") return
  const button = event.target.closest("button[data-action]")
  const card = event.target.closest(".account-card")
  if (!button || !card) return
  const id = card.dataset.id
  const action = button.dataset.action
  const account = state.accounts.find((item) => item.id === id)
  if (!account) return

  if (action === "edit") {
    fillForm(account)
    return
  }

  if (action === "delete") {
    if (!confirm(`删除账号「${account.name}」？`)) return
    try {
      await api(`/api/accounts/${encodeURIComponent(id)}`, { method: "DELETE" })
      showToast("账号已删除")
      await loadAccounts()
    } catch (error) {
      showToast(error.message, "error")
    }
  }
})

els.refreshAllBtn.addEventListener("click", async () => {
  try {
    els.refreshAllBtn.disabled = true
    els.refreshAllBtn.textContent = "刷新中"
    const data = await api("/api/refresh-all", {
      method: "POST",
      body: "{}",
    })
    const nextAccounts = data.accounts || []
    markChangedMetrics(state.accounts, nextAccounts)
    state.accounts = nextAccounts
    syncBaseUrlHistoryFromAccounts()
    render()
    showToast("全部刷新完成")
  } catch (error) {
    showToast(error.message, "error")
    await loadAccounts()
  } finally {
    els.refreshAllBtn.disabled = false
    els.refreshAllBtn.textContent = "全部刷新"
  }
})

els.cancelEditBtn.addEventListener("click", () => {
  resetForm()
})

els.closeFormBtn.addEventListener("click", () => {
  resetForm()
  closeAccountModal()
})

els.accountModal.addEventListener("click", (event) => {
  if (state.viewMode !== "widget" && event.target === els.accountModal) {
    resetForm()
    closeAccountModal()
  }
})

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.viewMode !== "widget" && !els.accountModal.classList.contains("hidden")) {
    resetForm()
    closeAccountModal()
  }
})

els.openAddBtn.addEventListener("click", () => {
  if (state.viewMode === "widget") return
  resetForm()
  openAccountModal()
})

els.widgetOpenPanelBtn?.addEventListener("click", async () => {
  await window.desktopWidget?.openPanel?.()
})

els.widgetLockBtn?.addEventListener("click", async () => {
  const result = await window.desktopWidget?.toggleLock?.()
  state.desktop.locked = Boolean(result?.locked)
  updateWidgetLockButton()
  applyWidgetSizing()
})

els.widgetMinimizeBtn?.addEventListener("click", async () => {
  await window.desktopWidget?.minimize?.()
})

els.widgetCloseBtn?.addEventListener("click", async () => {
  await window.desktopWidget?.close?.()
})

renderBaseUrlHistory()
initializeDesktopWidget().catch(() => {})
loadAccounts().catch((error) => showToast(error.message, "error"))
window.setInterval(autoRefreshAccounts, AUTO_REFRESH_MS)
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    autoRefreshAccounts()
  }
})
window.addEventListener("resize", () => {
  applyWidgetSizing({ fitWindow: false })
})
