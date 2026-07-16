import crypto from "node:crypto"
import { createReadStream } from "node:fs"
import {
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PUBLIC_DIR = path.join(ROOT, "public")
const DATA_DIR = path.join(ROOT, "data")
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json")
const HOST = process.env.HOST || "127.0.0.1"
const PORT = Number(process.env.PORT || 3847)
const BODY_LIMIT_BYTES = 1024 * 1024
const REQUEST_TIMEOUT_MS = 18000
const SUB2API_REFRESH_BUFFER_MS = 120 * 1000

class AppError extends Error {
  constructor(message, status = 500, details = undefined) {
    super(message)
    this.status = status
    this.details = details
  }
}

class RemoteError extends AppError {
  constructor(message, status = 502, endpoint = "") {
    super(message, status, endpoint ? { endpoint } : undefined)
    this.endpoint = endpoint
  }
}

function jsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  })
  res.end(body)
}

function textResponse(res, statusCode, body, contentType = "text/plain") {
  res.writeHead(statusCode, {
    "Content-Type": `${contentType}; charset=utf-8`,
    "Content-Length": Buffer.byteLength(body),
  })
  res.end(body)
}

function redactSecrets(value) {
  return String(value ?? "")
    .replace(/"([^"]*password[^"]*)"\s*:\s*"[^"]*"/gi, '"$1":"[REDACTED]"')
    .replace(/\bBearer\s+([a-zA-Z0-9._-]+)\b/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/\bsk-[a-z0-9_-]{10,}\b/gi, "[REDACTED_KEY]")
    .replace(/(access[_-]?token|refresh[_-]?token|api[_-]?key|password)\s*[:=]\s*[^,\s&}]+/gi, "$1=[REDACTED]")
}

function errorResponse(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500
  const message = redactSecrets(error?.message || "Unknown error")
  jsonResponse(res, status, {
    error: message,
    details: error?.details ? redactSecrets(JSON.stringify(error.details)) : undefined,
  })
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true })
}

function emptyState() {
  return { accounts: [], updatedAt: null }
}

async function loadState() {
  await ensureDataDir()
  try {
    const raw = await readFile(ACCOUNTS_FILE, "utf8")
    const parsed = JSON.parse(raw)
    return {
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      updatedAt: parsed.updatedAt || null,
    }
  } catch (error) {
    if (error?.code === "ENOENT") return emptyState()
    throw error
  }
}

async function saveState(state) {
  await ensureDataDir()
  const next = {
    accounts: Array.isArray(state.accounts) ? state.accounts : [],
    updatedAt: new Date().toISOString(),
  }
  const tmp = `${ACCOUNTS_FILE}.tmp`
  await writeFile(tmp, JSON.stringify(next, null, 2), "utf8")
  await rename(tmp, ACCOUNTS_FILE)
  return next
}

function normalizeBaseUrl(value) {
  const raw = String(value ?? "").trim()
  if (!raw) throw new AppError("请填写站点地址。", 400)
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new AppError("站点地址格式不正确，需要包含 http:// 或 https://。", 400)
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AppError("站点地址只支持 http:// 或 https://。", 400)
  }
  url.hash = ""
  url.search = ""
  return url.toString().replace(/\/+$/, "")
}

function trimmed(value) {
  return typeof value === "string" ? value.trim() : ""
}

function finiteNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function finiteIntegerOrNull(value) {
  const parsed = finiteNumber(value, Number.NaN)
  return Number.isInteger(parsed) ? parsed : null
}

function normalizeTokenExpiresAt(value) {
  if (value === null || value === undefined || value === "") return undefined
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return undefined
    return value > 1_000_000_000_000 ? Math.floor(value) : Math.floor(value * 1000)
  }
  const raw = String(value).trim()
  if (!raw) return undefined
  const numeric = Number(raw)
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1_000_000_000_000
      ? Math.floor(numeric)
      : Math.floor(numeric * 1000)
  }
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

function maskSecret(value) {
  const raw = trimmed(value)
  if (!raw) return ""
  if (raw.length <= 10) return "***"
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`
}

function safeLatest(latest) {
  if (!latest || typeof latest !== "object") return null
  const { keys, warnings, ...rest } = latest
  const nextWarnings = Array.isArray(warnings)
    ? warnings.filter((item) => !String(item).includes("密钥列表读取失败"))
    : []
  return {
    ...rest,
    warnings: nextWarnings,
  }
}

function safeAccount(account) {
  return {
    id: account.id,
    name: account.name,
    siteType: account.siteType || "sub2api",
    baseUrl: account.baseUrl,
    status: account.status || "unknown",
    message: account.message || "",
    hasAccessToken: Boolean(trimmed(account.accessToken)),
    hasRefreshToken: Boolean(trimmed(account.refreshToken)),
    hasLoginPassword: Boolean(account.loginPassword),
    loginEmail: trimmed(account.loginEmail),
    accessTokenMasked: maskSecret(account.accessToken),
    refreshTokenMasked: maskSecret(account.refreshToken),
    tokenExpiresAt: account.tokenExpiresAt,
    latest: safeLatest(account.latest),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }
}

function validateAccountSecrets(account) {
  if (!trimmed(account.accessToken) && !trimmed(account.refreshToken) && !hasSavedLoginCredentials(account)) {
    throw new AppError("至少需要填写 access token、refresh token，或保存登录邮箱和密码。", 400)
  }
}

function hasSavedLoginCredentials(account) {
  return Boolean(trimmed(account.loginEmail) && typeof account.loginPassword === "string" && account.loginPassword)
}

function createAccount(payload) {
  const now = new Date().toISOString()
  const account = {
    id: crypto.randomUUID(),
    siteType: "sub2api",
    name: trimmed(payload.name) || "Sub2API 账号",
    baseUrl: normalizeBaseUrl(payload.baseUrl),
    accessToken: trimmed(payload.accessToken),
    refreshToken: trimmed(payload.refreshToken),
    tokenExpiresAt: normalizeTokenExpiresAt(payload.tokenExpiresAt),
    loginEmail: trimmed(payload.loginEmail),
    loginPassword: typeof payload.loginPassword === "string" ? payload.loginPassword : "",
    status: "unknown",
    message: "",
    latest: null,
    createdAt: now,
    updatedAt: now,
  }
  validateAccountSecrets(account)
  return account
}

function updateAccount(account, payload) {
  if (payload.name !== undefined) {
    account.name = trimmed(payload.name) || account.name || "Sub2API 账号"
  }
  if (payload.baseUrl !== undefined) {
    account.baseUrl = normalizeBaseUrl(payload.baseUrl)
  }
  if (trimmed(payload.accessToken)) {
    account.accessToken = trimmed(payload.accessToken)
  }
  if (trimmed(payload.refreshToken)) {
    account.refreshToken = trimmed(payload.refreshToken)
  }
  if (payload.tokenExpiresAt !== undefined && payload.tokenExpiresAt !== "") {
    account.tokenExpiresAt = normalizeTokenExpiresAt(payload.tokenExpiresAt)
  }
  if (payload.loginEmail !== undefined) {
    account.loginEmail = trimmed(payload.loginEmail)
  }
  if (typeof payload.loginPassword === "string" && payload.loginPassword) {
    account.loginPassword = payload.loginPassword
  }
  account.updatedAt = new Date().toISOString()
  validateAccountSecrets(account)
  return account
}

async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > BODY_LIMIT_BYTES) {
      throw new AppError("请求内容太大。", 413)
    }
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString("utf8")
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new AppError("JSON 格式不正确。", 400)
  }
}

function endpointUrl(baseUrl, endpoint) {
  return new URL(endpoint, baseUrl).toString()
}

async function fetchRemoteJson(account, endpoint, options = {}) {
  const url = endpointUrl(account.baseUrl, endpoint)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const headers = {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.authorization !== false && trimmed(account.accessToken)
        ? { Authorization: `Bearer ${trimmed(account.accessToken)}` }
        : {}),
    }
    const response = await fetch(url, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })
    const text = await response.text()
    let json = null
    if (text.trim()) {
      try {
        json = JSON.parse(text)
      } catch {
        throw new RemoteError(`远端返回的不是 JSON：HTTP ${response.status}`, 502, endpoint)
      }
    }
    if (!response.ok) {
      const message = json?.message || json?.detail || text || `HTTP ${response.status}`
      throw new RemoteError(message, response.status === 401 ? 401 : 502, endpoint)
    }
    return json
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new RemoteError("请求超时。", 504, endpoint)
    }
    if (error instanceof AppError) throw error
    throw new RemoteError(error?.message || "远端请求失败。", 502, endpoint)
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchRemoteJsonByBaseUrl(baseUrl, endpoint, options = {}) {
  return fetchRemoteJson({ baseUrl, accessToken: "" }, endpoint, options)
}

function parseEnvelope(body, endpoint, options = {}) {
  if (!body || typeof body !== "object") {
    throw new RemoteError("远端响应格式不正确。", 502, endpoint)
  }
  if ("code" in body) {
    if (body.code !== 0) {
      throw new RemoteError(body.message || body.detail || "Sub2API 业务错误。", 502, endpoint)
    }
    if (body.data === undefined && !options.allowMissingData) {
      throw new RemoteError("Sub2API 响应缺少 data。", 502, endpoint)
    }
    return body.data
  }
  if ("success" in body) {
    if (body.success === false) {
      throw new RemoteError(body.message || body.detail || "Sub2API 业务错误。", 502, endpoint)
    }
    if (body.data === undefined && !options.allowMissingData) {
      throw new RemoteError("Sub2API 响应缺少 data。", 502, endpoint)
    }
    return body.data
  }
  return body.data ?? body
}

function parseAuthTokenResponse(data, endpoint) {
  if (data?.requires_2fa) {
    const tempToken = trimmed(data?.temp_token)
    if (!tempToken) throw new RemoteError("Sub2API 要求 2FA，但没有返回临时 token。", 502, endpoint)
    return {
      requires2FA: true,
      tempToken,
      userEmailMasked: trimmed(data?.user_email_masked),
    }
  }

  const accessToken = trimmed(data?.access_token)
  const refreshToken = trimmed(data?.refresh_token)
  const expiresIn = finiteNumber(data?.expires_in, 0)
  if (!accessToken) {
    throw new RemoteError("Sub2API 登录成功响应里没有 access token。", 502, endpoint)
  }
  return {
    requires2FA: false,
    accessToken,
    refreshToken,
    tokenExpiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : jwtExpiresAt(accessToken),
  }
}

async function loginSub2Api(payload) {
  const baseUrl = normalizeBaseUrl(payload.baseUrl)
  const email = trimmed(payload.email)
  const password = typeof payload.password === "string" ? payload.password : ""
  const turnstileToken = trimmed(payload.turnstileToken)
  if (!email) throw new AppError("请填写 Sub2API 登录邮箱。", 400)
  if (!password) throw new AppError("请填写 Sub2API 登录密码。", 400)

  // Sub2API upstream login contract: POST /api/v1/auth/login with email/password.
  // Source: https://github.com/Wei-Shaw/sub2api/blob/main/backend/internal/handler/auth_handler.go
  const body = await fetchRemoteJsonByBaseUrl(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    authorization: false,
    body: {
      email,
      password,
      ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
    },
  })
  return parseAuthTokenResponse(parseEnvelope(body, "/api/v1/auth/login"), "/api/v1/auth/login")
}

async function loginSub2Api2FA(payload) {
  const baseUrl = normalizeBaseUrl(payload.baseUrl)
  const tempToken = trimmed(payload.tempToken)
  const totpCode = trimmed(payload.totpCode)
  if (!tempToken) throw new AppError("缺少 2FA 临时 token，请先用账号密码登录。", 400)
  if (!/^\d{6}$/.test(totpCode)) throw new AppError("2FA 验证码需要是 6 位数字。", 400)

  const body = await fetchRemoteJsonByBaseUrl(baseUrl, "/api/v1/auth/login/2fa", {
    method: "POST",
    authorization: false,
    body: {
      temp_token: tempToken,
      totp_code: totpCode,
    },
  })
  return parseAuthTokenResponse(parseEnvelope(body, "/api/v1/auth/login/2fa"), "/api/v1/auth/login/2fa")
}

function displayNameFromUser(data) {
  const username = trimmed(data?.username)
  if (username) return username
  const email = trimmed(data?.email)
  if (!email) return ""
  const at = email.indexOf("@")
  return at > 0 ? email.slice(0, at) : email
}

function parseCurrentUser(data) {
  const userId = finiteIntegerOrNull(data?.id)
  if (userId === null) throw new RemoteError("用户信息缺少 id。", 502, "/api/v1/auth/me")
  return {
    id: userId,
    name: displayNameFromUser(data),
    balanceUsd: finiteNumber(data?.balance, 0),
  }
}

function subscriptionGroupName(item) {
  return trimmed(item?.group_name) || trimmed(item?.group?.name) || trimmed(item?.Group?.name) || "(未命名订阅)"
}

function optionalLimit(value) {
  const parsed = finiteNumber(value, Number.NaN)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseSub2Subscription(item) {
  const group = item?.group || item?.Group || {}
  const monthlyLimitUsd = optionalLimit(item?.monthly_limit_usd ?? group?.monthly_limit_usd)
  const monthlyUsedUsd = finiteNumber(item?.monthly_used_usd ?? item?.monthly_usage_usd, 0)
  const dailyLimitUsd = optionalLimit(item?.daily_limit_usd ?? group?.daily_limit_usd)
  const dailyUsedUsd = finiteNumber(item?.daily_used_usd ?? item?.daily_usage_usd, 0)
  const weeklyLimitUsd = optionalLimit(item?.weekly_limit_usd ?? group?.weekly_limit_usd)
  const weeklyUsedUsd = finiteNumber(item?.weekly_used_usd ?? item?.weekly_usage_usd, 0)
  return {
    id: item?.id ?? "",
    groupName: subscriptionGroupName(item),
    status: trimmed(item?.status) || "unknown",
    expiresAt: item?.expires_at || null,
    monthlyLimitUsd,
    monthlyUsedUsd,
    monthlyRemainUsd: typeof monthlyLimitUsd === "number" ? Math.max(monthlyLimitUsd - monthlyUsedUsd, 0) : null,
    dailyLimitUsd,
    dailyUsedUsd,
    dailyRemainUsd: typeof dailyLimitUsd === "number" ? Math.max(dailyLimitUsd - dailyUsedUsd, 0) : null,
    weeklyLimitUsd,
    weeklyUsedUsd,
    weeklyRemainUsd: typeof weeklyLimitUsd === "number" ? Math.max(weeklyLimitUsd - weeklyUsedUsd, 0) : null,
  }
}

function subscriptionItems(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.subscriptions)) return payload.subscriptions
  return extractItems(payload)
}

function summarizeSubscriptions(payload) {
  const subscriptions = subscriptionItems(payload).map(parseSub2Subscription)
  const totals = subscriptions.reduce(
    (acc, subscription) => {
      acc.total += 1
      acc[subscription.status] = (acc[subscription.status] || 0) + 1
      acc.monthlyUsedUsd += subscription.monthlyUsedUsd || 0
      acc.dailyUsedUsd += subscription.dailyUsedUsd || 0
      if (typeof subscription.monthlyLimitUsd === "number") acc.monthlyLimitUsd += subscription.monthlyLimitUsd
      if (typeof subscription.monthlyRemainUsd === "number") acc.monthlyRemainUsd += subscription.monthlyRemainUsd
      if (typeof subscription.dailyLimitUsd === "number") acc.dailyLimitUsd += subscription.dailyLimitUsd
      if (typeof subscription.dailyRemainUsd === "number") acc.dailyRemainUsd += subscription.dailyRemainUsd
      return acc
    },
    {
      total: 0,
      active: 0,
      monthlyUsedUsd: 0,
      monthlyLimitUsd: 0,
      monthlyRemainUsd: 0,
      dailyUsedUsd: 0,
      dailyLimitUsd: 0,
      dailyRemainUsd: 0,
    },
  )
  return {
    ...totals,
    activeCount: finiteNumber(payload?.active_count, totals.active || subscriptions.length),
    totalUsedUsd: finiteNumber(payload?.total_used_usd, totals.monthlyUsedUsd),
    items: subscriptions,
  }
}

function tokenIsCloseToExpiry(account) {
  return (
    typeof account.tokenExpiresAt === "number" &&
    account.tokenExpiresAt > 0 &&
    account.tokenExpiresAt - Date.now() <= SUB2API_REFRESH_BUFFER_MS
  )
}

async function refreshSub2ApiToken(account) {
  const refreshToken = trimmed(account.refreshToken)
  if (!refreshToken) throw new RemoteError("缺少 refresh token。", 401, "/api/v1/auth/refresh")
  const body = await fetchRemoteJson(account, "/api/v1/auth/refresh", {
    method: "POST",
    body: { refresh_token: refreshToken },
  })
  const data = parseEnvelope(body, "/api/v1/auth/refresh")
  const accessToken = trimmed(data?.access_token)
  const nextRefreshToken = trimmed(data?.refresh_token)
  const expiresIn = finiteNumber(data?.expires_in, 0)
  if (!accessToken || !nextRefreshToken || expiresIn <= 0) {
    throw new RemoteError("Sub2API token refresh failed。", 401, "/api/v1/auth/refresh")
  }
  account.accessToken = accessToken
  account.refreshToken = nextRefreshToken
  account.tokenExpiresAt = Date.now() + expiresIn * 1000
  account.updatedAt = new Date().toISOString()
}

async function loginSub2ApiWithSavedCredentials(account) {
  if (!hasSavedLoginCredentials(account)) {
    throw new RemoteError("缺少已保存的登录邮箱或密码。", 401, "/api/v1/auth/login")
  }
  const result = await loginSub2Api({
    baseUrl: account.baseUrl,
    email: account.loginEmail,
    password: account.loginPassword,
  })
  if (result.requires2FA) {
    throw new RemoteError("自动重新登录需要 2FA 验证码，请手动登录一次。", 401, "/api/v1/auth/login")
  }
  account.accessToken = result.accessToken
  account.refreshToken = result.refreshToken || account.refreshToken || ""
  account.tokenExpiresAt = result.tokenExpiresAt
  account.updatedAt = new Date().toISOString()
}

async function renewSub2ApiAuth(account) {
  if (trimmed(account.refreshToken)) {
    try {
      await refreshSub2ApiToken(account)
      return "refresh"
    } catch (error) {
      if (!hasSavedLoginCredentials(account)) throw error
    }
  }
  await loginSub2ApiWithSavedCredentials(account)
  return "login"
}

async function fetchCurrentUser(account) {
  const body = await fetchRemoteJson(account, "/api/v1/auth/me", { method: "GET" })
  return parseCurrentUser(parseEnvelope(body, "/api/v1/auth/me"))
}

async function fetchSubscriptions(account) {
  try {
    // Sub2API user subscriptions expose monthly usage/limits through the summary endpoint.
    // Source: https://github.com/Wei-Shaw/sub2api/blob/main/backend/internal/handler/subscription_handler.go
    const body = await fetchRemoteJson(account, "/api/v1/subscriptions/summary", {
      method: "GET",
    })
    return summarizeSubscriptions(parseEnvelope(body, "/api/v1/subscriptions/summary"))
  } catch (error) {
    if (error?.status === 401) throw error
    const body = await fetchRemoteJson(account, "/api/v1/subscriptions/active", {
      method: "GET",
    })
    return summarizeSubscriptions(parseEnvelope(body, "/api/v1/subscriptions/active"))
  }
}

async function refreshAccount(account) {
  const warnings = []
  try {
    if (!trimmed(account.accessToken) || tokenIsCloseToExpiry(account)) {
      if (trimmed(account.refreshToken) || hasSavedLoginCredentials(account)) {
        try {
          const method = await renewSub2ApiAuth(account)
          if (method === "login") warnings.push("token 已失效，已用保存的账号密码重新登录")
        } catch (error) {
          if (!trimmed(account.accessToken)) throw error
          warnings.push(`token 自动刷新/登录失败：${redactSecrets(error.message)}`)
        }
      }
    }

    let user
    try {
      user = await fetchCurrentUser(account)
    } catch (error) {
      if (error?.status === 401 && (trimmed(account.refreshToken) || hasSavedLoginCredentials(account))) {
        const method = await renewSub2ApiAuth(account)
        if (method === "login") warnings.push("访问令牌失效，已用保存的账号密码重新登录")
        user = await fetchCurrentUser(account)
      } else {
        throw error
      }
    }

    let subscriptions = null
    try {
      subscriptions = await fetchSubscriptions(account)
    } catch (error) {
      warnings.push(`订阅余额读取失败：${redactSecrets(error.message)}`)
    }

    account.status = "healthy"
    account.message = warnings.length ? warnings.join("；") : "正常"
    account.latest = {
      refreshedAt: new Date().toISOString(),
      user,
      balanceUsd: user.balanceUsd,
      subscriptions,
      warnings,
    }
    account.updatedAt = new Date().toISOString()
    return account
  } catch (error) {
    account.status = "error"
    account.message = redactSecrets(error.message)
    account.latest = {
      ...(account.latest || {}),
      refreshedAt: new Date().toISOString(),
      warnings: [redactSecrets(error.message)],
    }
    account.updatedAt = new Date().toISOString()
    throw error
  }
}

function findAccount(state, id) {
  const account = state.accounts.find((item) => item.id === id)
  if (!account) throw new AppError("账号不存在。", 404)
  return account
}

function base64UrlDecode(input) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=")
  return Buffer.from(padded, "base64").toString("utf8")
}

function jwtExpiresAt(token) {
  const parts = trimmed(token).split(".")
  if (parts.length < 2) return undefined
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]))
    return normalizeTokenExpiresAt(payload.exp)
  } catch {
    return undefined
  }
}

function collectTokenLikeValues(value, result = {}) {
  if (!value || typeof value !== "object") return result
  if (Array.isArray(value)) {
    value.forEach((item) => collectTokenLikeValues(item, result))
    return result
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[-_]/g, "")
    if (typeof child === "string") {
      if (!result.refreshToken && normalized.includes("refreshtoken")) {
        result.refreshToken = child.trim()
      }
      if (
        !result.accessToken &&
        (normalized === "accesstoken" ||
          normalized === "authtoken" ||
          normalized === "token" ||
          normalized === "jwt")
      ) {
        result.accessToken = child.trim()
      }
    } else {
      collectTokenLikeValues(child, result)
    }
    if (!result.tokenExpiresAt && normalized.includes("expires")) {
      result.tokenExpiresAt = normalizeTokenExpiresAt(child)
    }
  }
  return result
}

function parseSub2ApiText(text) {
  const raw = String(text ?? "")
  const result = {}
  try {
    collectTokenLikeValues(JSON.parse(raw), result)
  } catch {
    // Plain text is supported below.
  }

  const refreshMatch =
    raw.match(/refresh[_-]?token["'\s:=]+([a-zA-Z0-9._-]+)/i) ||
    raw.match(/refresh_token["'\s:=]+([a-zA-Z0-9._-]+)/i)
  if (!result.refreshToken && refreshMatch) result.refreshToken = refreshMatch[1]

  const accessMatch =
    raw.match(/access[_-]?token["'\s:=]+([a-zA-Z0-9._-]+)/i) ||
    raw.match(/auth_token["'\s:=]+([a-zA-Z0-9._-]+)/i)
  if (!result.accessToken && accessMatch) result.accessToken = accessMatch[1]

  const jwtMatch = raw.match(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/)
  if (!result.accessToken && jwtMatch) result.accessToken = jwtMatch[0]
  if (!result.tokenExpiresAt && result.accessToken) {
    result.tokenExpiresAt = jwtExpiresAt(result.accessToken)
  }

  return {
    accessToken: trimmed(result.accessToken),
    refreshToken: trimmed(result.refreshToken),
    tokenExpiresAt: result.tokenExpiresAt,
  }
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    jsonResponse(res, 200, { ok: true, host: HOST, port: PORT })
    return true
  }

  if (req.method === "GET" && url.pathname === "/api/accounts") {
    const state = await loadState()
    jsonResponse(res, 200, {
      accounts: state.accounts.map(safeAccount),
      updatedAt: state.updatedAt,
    })
    return true
  }

  if (req.method === "POST" && url.pathname === "/api/accounts") {
    const payload = await readJsonBody(req)
    const state = await loadState()
    const account = createAccount(payload)
    state.accounts.push(account)
    await saveState(state)
    jsonResponse(res, 201, { account: safeAccount(account) })
    return true
  }

  if (req.method === "POST" && url.pathname === "/api/refresh-all") {
    const state = await loadState()
    const results = []
    for (const account of state.accounts) {
      try {
        await refreshAccount(account)
        results.push({ id: account.id, ok: true, account: safeAccount(account) })
      } catch (error) {
        results.push({ id: account.id, ok: false, error: redactSecrets(error.message), account: safeAccount(account) })
      }
    }
    await saveState(state)
    jsonResponse(res, 200, { results, accounts: state.accounts.map(safeAccount) })
    return true
  }

  if (req.method === "POST" && url.pathname === "/api/parse-sub2api") {
    const payload = await readJsonBody(req)
    jsonResponse(res, 200, parseSub2ApiText(payload.text))
    return true
  }

  if (req.method === "POST" && url.pathname === "/api/sub2api-login") {
    const payload = await readJsonBody(req)
    jsonResponse(res, 200, await loginSub2Api(payload))
    return true
  }

  if (req.method === "POST" && url.pathname === "/api/sub2api-login-2fa") {
    const payload = await readJsonBody(req)
    jsonResponse(res, 200, await loginSub2Api2FA(payload))
    return true
  }

  const accountMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)(?:\/([^/]+))?$/)
  if (accountMatch) {
    const id = decodeURIComponent(accountMatch[1])
    const action = accountMatch[2]
    const state = await loadState()
    const account = findAccount(state, id)

    if (req.method === "PUT" && !action) {
      const payload = await readJsonBody(req)
      updateAccount(account, payload)
      await saveState(state)
      jsonResponse(res, 200, { account: safeAccount(account) })
      return true
    }

    if (req.method === "DELETE" && !action) {
      state.accounts = state.accounts.filter((item) => item.id !== id)
      await saveState(state)
      jsonResponse(res, 200, { ok: true })
      return true
    }

    if (req.method === "POST" && action === "refresh") {
      try {
        await refreshAccount(account)
        await saveState(state)
        jsonResponse(res, 200, { ok: true, account: safeAccount(account) })
      } catch (error) {
        await saveState(state)
        throw error
      }
      return true
    }
  }

  return false
}

const MIME_TYPES = new Map([
  [".html", "text/html"],
  [".css", "text/css"],
  [".js", "text/javascript"],
  [".json", "application/json"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
])

async function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    textResponse(res, 400, "Bad request")
    return
  }
  const filePath = path.normalize(path.join(PUBLIC_DIR, decoded))
  if (!filePath.startsWith(PUBLIC_DIR)) {
    textResponse(res, 403, "Forbidden")
    return
  }
  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      textResponse(res, 404, "Not found")
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, {
      "Content-Type": `${MIME_TYPES.get(ext) || "application/octet-stream"}; charset=utf-8`,
    })
    createReadStream(filePath).pipe(res)
  } catch (error) {
    if (error?.code === "ENOENT") {
      textResponse(res, 404, "Not found")
      return
    }
    throw error
  }
}

function createRequestHandler(host = HOST, port = PORT) {
  return async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${host}:${port}`)
      if (url.pathname.startsWith("/api/")) {
        const handled = await handleApi(req, res, url)
        if (!handled) textResponse(res, 404, "Not found")
        return
      }
      await serveStatic(req, res, url)
    } catch (error) {
      errorResponse(res, error)
    }
  }
}

export function createServer(options = {}) {
  const host = options.host || HOST
  const port = Number(options.port || PORT)
  return http.createServer(createRequestHandler(host, port))
}

export async function startServer(options = {}) {
  const host = options.host || HOST
  const port = Number(options.port || PORT)
  const server = createServer({ host, port })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, () => {
      server.off("error", reject)
      resolve()
    })
  })
  return server
}

export const serverUrl = `http://${HOST}:${PORT}/`

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  startServer()
    .then(() => {
      console.log(`Account quota dashboard running at ${serverUrl}`)
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}
