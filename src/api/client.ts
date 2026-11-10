/**
 * 职责：全站唯一的 HTTP 出口，负责拼 API_BASE、注入 Bearer token、401 时刷新并重放请求。
 * 依赖：../auth 的 token 读写与 setAuth/clearAuth，../types 的 AuthUser。
 * 坑：
 * 1. API_BASE 默认 '/api'，该前缀在开发时由 Vite 的 rewrite 剥掉，只有后端真挂在 /api 下才配 VITE_API_BASE；
 * 2. FormData 请求不能手写 Content-Type，否则缺少 boundary，后端解析失败；
 * 3. 401 刷新必须收敛成单例 Promise，且失败要 clearAuth，否则会陷入反复刷新或"已登录但无 token"的坏状态。
 */
import { clearAuth, getAccessToken, getRefreshToken, setAuth } from '../auth'
import type { AuthUser } from '../types'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

// 带上 HTTP 状态码，页面据此区分 401/403 与普通失败
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// 后端校验异常的 message 可能是 string[]，直接渲染会变成逗号串，这里统一 join 成可读文案
function errorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== 'object') return fallback
  const message = (body as { message?: unknown }).message
  if (typeof message === 'string') return message
  if (Array.isArray(message)) return message.filter((x) => typeof x === 'string').join('；')
  return fallback
}

// 并发请求同时 401 时共用同一个刷新 Promise，避免每个请求各刷一次把 refresh token 用废
let refreshing: Promise<boolean> | null = null

// 必须用裸 fetch 而不能复用 request，否则刷新接口自身 401 时会递归调用自己
async function tryRefresh() {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        })
        if (!res.ok) return false
        const data = (await res.json()) as {
          accessToken: string
          refreshToken: string
          userInfo: AuthUser
        }
        setAuth({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          user: data.userInfo,
        })
        return true
      } catch {
        return false
      } finally {
        refreshing = null
      }
    })()
  }
  return refreshing
}

// 先读 text 再手动 JSON.parse，兼容 204 等空响应，避免 res.json() 直接抛错
export async function request<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(init.headers)
  // 表单请求交给浏览器自动生成带 boundary 的 Content-Type，手动设置反而会让上传失败
  const isForm = init.body instanceof FormData
  if (!isForm && !headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })

  // 重放后 retry 置 false，再遇到 401 就只清登录态，避免无限刷新
  if (res.status === 401 && retry && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
    const ok = await tryRefresh()
    if (ok) return request<T>(path, init, false)
    clearAuth()
    throw new ApiError(401, '未登录或登录已过期')
  }

  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : null
  if (!res.ok) {
    throw new ApiError(res.status, errorMessage(data, res.statusText || '请求失败'))
  }
  return data as T
}

export function get<T>(path: string) {
  return request<T>(path)
}

export function post<T>(path: string, body?: unknown) {
  return request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function put<T>(path: string, body?: unknown) {
  return request<T>(path, {
    method: 'PUT',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function patch<T>(path: string, body?: unknown) {
  return request<T>(path, {
    method: 'PATCH',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function del<T>(path: string, body?: unknown) {
  return request<T>(path, {
    method: 'DELETE',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
