/**
 * 职责：登录态的唯一数据源，用 localStorage 持久化 token 与用户信息，并向组件暴露 useAuth。
 * 依赖：react 的 useSyncExternalStore，./types 的 AuthUser。
 * 坑：
 * 1. token 放在 localStorage，任何 XSS 都能直接读走，所有外部内容必须转义后再渲染；
 * 2. 不用 Context 是刻意的：订阅粒度精确到"用户变了"，且 api 层等非组件代码也能直接读写；
 * 3. 内存里的 currentUser 必须与 localStorage 同步更新并 emit，否则 useSyncExternalStore 的快照比对不会触发重渲染。
 */
import { useSyncExternalStore } from 'react'
import type { AuthUser } from './types'

const ACCESS_KEY = 'kh_access_token'
const REFRESH_KEY = 'kh_refresh_token'
const USER_KEY = 'kh_user'

// 首屏直接从 localStorage 还原，避免刷新页面闪一下未登录
let currentUser: AuthUser | null = loadUser()
const listeners = new Set<() => void>()

// 存储里的 JSON 可能被手改坏，解析失败按未登录处理，不能让它阻断应用启动
function loadUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

function emit() {
  for (const listener of listeners) listener()
}

export function getAccessToken() {
  return localStorage.getItem(ACCESS_KEY)
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY)
}

export function getUser() {
  return currentUser
}

// 登录成功与静默刷新都复用它，三个 key 必须一起写，避免 token 与用户信息错位
export function setAuth(params: {
  accessToken: string
  refreshToken: string
  user: AuthUser
}) {
  localStorage.setItem(ACCESS_KEY, params.accessToken)
  localStorage.setItem(REFRESH_KEY, params.refreshToken)
  localStorage.setItem(USER_KEY, JSON.stringify(params.user))
  currentUser = params.user
  emit()
}

export function updateUser(user: AuthUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  currentUser = user
  emit()
}

// 401 刷新失败或主动退出时调用，必须同时清掉内存态并 emit
export function clearAuth() {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(USER_KEY)
  currentUser = null
  emit()
}

// 订阅入口：返回取消订阅函数，直接交给 useSyncExternalStore 使用
export function subscribeAuth(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAuth() {
  return useSyncExternalStore(subscribeAuth, getUser)
}
