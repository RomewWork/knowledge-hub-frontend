/**
 * 职责：与后端 DTO/VO 一一对应的前端类型定义，供 api 层与页面共享。
 * 依赖：无，纯类型文件，编译后不产生运行时代码。
 * 坑：
 * 1. 后端雪花 ID 经序列化后是 string，前端 id 一律用 string，别写 number；
 * 2. 大量字段是可空可选的，渲染前要判空，否则会出现 "null" 字样；
 * 3. 分页固定是 items/total/page/pageSize，不是常见的 records 或 list。
 */
export interface AuthUser {
  userId: string
  username: string
  realName?: string | null
  email?: string | null
  avatar?: string | null
  roles: string[]
  permissions: string[]
}

export interface LoginResult {
  accessToken: string
  refreshToken: string
  tokenType: 'Bearer'
  expiresIn: number
  userInfo: AuthUser
}

// 统一分页结构，所有列表接口都复用它
export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

// status 是数字枚举，展示文案与颜色统一查 utils 里的 DOC_STATUS
export interface DocumentItem {
  id: string
  title: string
  summary?: string | null
  content?: string
  categoryId?: string | null
  teamId?: string | null
  authorId?: string | null
  tags?: string | null
  status: number
  isPublic: boolean
  viewCount?: number
  likeCount?: number
  wordCount?: number
  publishTime?: string | null
  createdAt?: string
  updatedAt?: string
  remark?: string | null
}

export interface SearchHit {
  id: string
  title: string
  summary?: string | null
  categoryId?: string | null
  tags?: string | null
  authorId?: string | null
  status?: number | null
  publishTime?: string | null
  score: number
  highlight: {
    title: string[]
    summary: string[]
    content: string[]
  }
}

export interface ChunkHit {
  chunkId: string
  documentId: string
  documentTitle: string
  content: string
  heading: string | null
  score: number
  bm25Score?: number
  vectorScore?: number
}

export interface ChatSource {
  index: number
  documentId: string
  documentTitle: string
  heading: string | null
  excerpt: string
  score: number
}

export interface ChatResult {
  sessionId: string | null
  answer: string
  sources: ChatSource[]
}

export interface ChatSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  sources?: ChatSource[] | null
  createdAt: string
}

export interface GraphHit {
  id: string
  name: string
  label?: string | null
  type?: string | null
  title?: string | null
  description?: string | null
  heading?: string | null
  documentId?: string | null
  summary?: string | null
  snippet?: string | null
}

// GraphView* 是 /graph/overview 的画图结构（kind 决定样式），GraphNode/GraphEdge 是 /graph/nodes、/graph/edges 的原始结构
export interface GraphViewNode {
  id: string
  name: string
  kind: 'document' | 'entity' | 'tag'
  type?: string | null
  documentId?: string | null
  updatedAt?: string | null
  description?: string | null
}

export interface GraphViewEdge {
  source: string
  target: string
  relation: string
  kind: 'mentions' | 'related' | 'tagged'
}

export interface GraphOverview {
  nodes: GraphViewNode[]
  edges: GraphViewEdge[]
  stats: {
    nodeCount: number
    edgeCount: number
    documentCount: number
    entityCount: number
    tagCount: number
    mentionCount: number
    relatedCount: number
    entityTypes: Array<{ type: string; count: number }>
  }
  topEntities: Array<{ name: string; type: string | null; degree: number }>
  recentNodes: Array<{ id: string; name: string; kind: string; updatedAt: string | null }>
  entityTypes: string[]
}

export interface GraphNode {
  id: string
  name: string
  type?: string | null
  description?: string | null
}

export interface GraphEdge {
  source: string
  target: string
  relation: string
  weight: number
}

export interface UserVO {
  id: string
  username: string
  email?: string | null
  realName?: string | null
  avatar?: string | null
  status: number
  lastLoginAt?: string | null
  createdAt: string
  updatedAt: string
  roleCodes: string[]
}

export interface RoleItem {
  id: string
  roleName: string
  roleCode: string
  description?: string | null
  status?: number
}

export interface TeamItem {
  id: string
  teamName: string
  teamCode?: string | null
  description?: string | null
  leaderId?: string | null
  parentId?: string
  sort?: number
  status?: number
  memberCount?: number
}

export interface ReviewTask {
  id: string
  documentId: string
  reviewerId?: string | null
  reviewerName?: string | null
  reviewResult?: number | null
  reviewComment?: string | null
  beforeStatus: number
  reviewedAt?: string | null
  createdAt: string
}

export interface UserStats {
  documentCount: number
  viewCount: number
  likeCount: number
  commentCount: number
}

export interface PermissionNode {
  id: string
  parentId: string
  permissionName: string
  permissionCode: string
  permissionType: number
  children?: PermissionNode[]
}
