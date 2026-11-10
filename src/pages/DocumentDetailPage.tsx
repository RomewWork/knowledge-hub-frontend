/**
 * 文档详情页：展示标题、状态、元数据与 Markdown 正文，并按状态给出可做的操作。
 * 关键交互：按路由 id 拉取详情；发布、下架编辑（存草稿）、归档都用接口返回值覆盖本地文档；删除走 Popconfirm 确认后回列表。
 * 坑 1：不同状态可做的操作不同，0 草稿和 2 已归档可发布，1 已发布可下架或归档；
 * 发布在开启审核的模式下只是提审，状态会变 3 待审核，不要以为立刻对所有人可见。
 * 坑 2：正文用 react-markdown 渲染而不是拼 HTML；按钮按 can() 隐藏只是体验，权限边界在后端 @RequirePermission。
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Popconfirm, Space, Spin, Tag, Typography, message } from 'antd'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { documentApi } from '../api'
import { ApiError } from '../api/client'
import type { DocumentItem } from '../types'
import { useAuth } from '../auth'
import { DOC_STATUS, can, formatTime } from '../utils'
import { FileTypeIcon } from '../components/FileTypeIcon'

export default function DocumentDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const user = useAuth()
  const [doc, setDoc] = useState<DocumentItem | null>(null)
  const [loading, setLoading] = useState(true)

  // 按路由 id 拉详情，失败提示后 loading 结束，页面落到空态
  async function load() {
    setLoading(true)
    try {
      setDoc(await documentApi.get(id))
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  // id 变化（例如从列表跳到另一篇文档）时重新拉取详情
  useEffect(() => {
    void load()
  }, [id])

  if (loading || !doc) {
    return (
      <div className="kh-page">
        <Spin />
      </div>
    )
  }

  const status = DOC_STATUS[doc.status]

  return (
    <div className="kh-page">
      <Space style={{ marginBottom: 12 }} wrap>
        <Button onClick={() => navigate('/documents')}>返回列表</Button>
        {can(user, 'document:edit') ? (
          <Button onClick={() => navigate(`/documents/${id}/edit`)}>编辑</Button>
        ) : null}
        {can(user, 'document:edit') && (doc.status === 0 || doc.status === 2) ? (
          <Button
            type="primary"
            onClick={async () => {
              // 草稿或已归档可发布，接口返回的文档直接覆盖本地状态；需审模式下会变成待审核
              try {
                setDoc(await documentApi.publish(id))
                message.success('已发布（若开启审核则进入待审）')
              } catch (error) {
                message.error(error instanceof ApiError ? error.message : '发布失败')
              }
            }}
          >
            发布
          </Button>
        ) : null}
        {can(user, 'document:edit') && doc.status === 1 ? (
          <>
            <Button
              onClick={async () => {
                // 下架编辑：把已发布文档退回草稿，方便继续改内容
                try {
                  setDoc(await documentApi.saveDraft(id))
                  message.success('已下架为草稿')
                } catch (error) {
                  message.error(error instanceof ApiError ? error.message : '操作失败')
                }
              }}
            >
              下架编辑
            </Button>
            <Button
              onClick={async () => {
                // 归档与下架走不同接口，归档后文档状态为 2，不再出现在已发布结果里
                try {
                  setDoc(await documentApi.archive(id))
                  message.success('已归档')
                } catch (error) {
                  message.error(error instanceof ApiError ? error.message : '归档失败')
                }
              }}
            >
              归档
            </Button>
          </>
        ) : null}
        {can(user, 'document:delete') ? (
          <Popconfirm
            title="确认删除该文档？"
            onConfirm={async () => {
              // 删除不可恢复，确认成功后再跳回列表页
              try {
                await documentApi.remove(id)
                message.success('已删除')
                navigate('/documents')
              } catch (error) {
                message.error(error instanceof ApiError ? error.message : '删除失败')
              }
            }}
          >
            <Button danger>删除</Button>
          </Popconfirm>
        ) : null}
      </Space>
      <Typography.Title
        level={3}
        style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}
      >
        <FileTypeIcon name={doc.title} size={28} />
        {doc.title}
      </Typography.Title>
      <Space wrap>
        <Tag color={status?.color}>{status?.label}</Tag>
        <Tag>{doc.isPublic ? '公开' : '非公开'}</Tag>
        <span style={{ color: '#8c8c8c' }}>更新于 {formatTime(doc.updatedAt)}</span>
      </Space>
      {doc.summary ? (
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          {doc.summary}
        </Typography.Paragraph>
      ) : null}
      <div style={{ marginTop: 16 }}>
        <Markdown remarkPlugins={[remarkGfm]}>{doc.content || ''}</Markdown>
      </div>
    </div>
  )
}
