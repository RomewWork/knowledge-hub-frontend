/**
 * 职责：跨页面复用的纯函数与常量：文档状态字典、时间格式化、权限判断、显示名、高亮转义。
 * 依赖：./types 的 AuthUser。
 * 坑：
 * 1. ROLE_ADMIN 在 can() 里已经直接放行，页面不要再单独判断角色；
 * 2. formatTime 按浏览器本地时区格式化后端返回的 ISO 串，非法值原样返回，不要假设一定是合法日期；
 * 3. safeHighlight 只放行 em 标签，是防 XSS 的关键，别改成直接把原文丢进 dangerouslySetInnerHTML。
 */
import type { AuthUser } from './types'

// 状态码与后端约定，改动需同步后端枚举
export const DOC_STATUS: Record<number, { label: string; color: string }> = {
  0: { label: '草稿', color: 'default' },
  1: { label: '已发布', color: 'success' },
  2: { label: '已归档', color: 'warning' },
  3: { label: '待审核', color: 'processing' },
}

export function formatTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function can(user: AuthUser | null, code: string) {
  if (!user) return false
  // 管理员默认拥有全部权限，避免每加一个权限码就要给管理员单独授权
  if (user.roles.includes('ROLE_ADMIN')) return true
  return user.permissions.includes(code)
}

export function isAdmin(user: AuthUser | null) {
  return Boolean(user?.roles.includes('ROLE_ADMIN'))
}

export function isReviewer(user: AuthUser | null) {
  return Boolean(
    user?.roles.includes('ROLE_ADMIN') || user?.roles.includes('ROLE_REVIEWER'),
  )
}

export function displayName(user: AuthUser | null) {
  if (!user) return '未登录'
  return user.realName?.trim() || user.username
}

/** ES 高亮只保留 em，避免 XSS */
export function safeHighlight(html?: string) {
  if (!html) return ''
  return html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;em&gt;/g, '<em>')
    .replace(/&lt;\/em&gt;/g, '</em>')
}
