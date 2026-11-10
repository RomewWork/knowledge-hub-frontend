/**
 * 工作台总览页：展示当前用户的文档统计、功能入口和最近文档。
 * 关键交互：useEffect 同时拉取 userApi.stats() 与最近 8 条文档，入口卡片先用 can() 判断权限再渲染，
 * 点击文档标题跳转详情。
 * 坑 1：统计和列表请求都用 catch(() => undefined) 吞掉异常，接口失败时页面只显示 0 或空表，不会提示。
 * 坑 2：这里用 can() 隐藏入口只是体验优化，越权访问的兜底在后端 @RequirePermission，不能当安全边界。
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ClusterOutlined,
  FileTextOutlined,
  MessageOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { Card, Col, Row, Statistic, Table, Tag } from 'antd'
import { documentApi, userApi } from '../api'
import type { DocumentItem, UserStats } from '../types'
import { useAuth } from '../auth'
import { DOC_STATUS, can, formatTime } from '../utils'
import { FileTypeIcon } from '../components/FileTypeIcon'

export default function DashboardPage() {
  const user = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState<UserStats | null>(null)
  const [docs, setDocs] = useState<DocumentItem[]>([])

  // 进入页面时加载统计数据与最近文档；没有 document:list 权限就不请求列表
  useEffect(() => {
    userApi.stats().then(setStats).catch(() => undefined)
    if (can(user, 'document:list')) {
      documentApi
        .list({ page: 1, pageSize: 8 })
        .then((res) => setDocs(res.items))
        .catch(() => undefined)
    }
  }, [user])

  return (
    <div>
      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic title="我的文档" value={stats?.documentCount ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="浏览合计" value={stats?.viewCount ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="点赞合计" value={stats?.likeCount ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="评论合计" value={stats?.commentCount ?? 0} />
          </Card>
        </Col>
      </Row>
      <Row gutter={16} style={{ marginTop: 16 }}>
        {can(user, 'document:list') ? (
          <Col span={6}>
            <Card hoverable onClick={() => navigate('/documents')}>
              <FileTextOutlined style={{ color: '#1677ff', fontSize: 20 }} /> 文档管理
            </Card>
          </Col>
        ) : null}
        {can(user, 'search') ? (
          <>
            <Col span={6}>
              <Card hoverable onClick={() => navigate('/search')}>
                <SearchOutlined style={{ color: '#1677ff', fontSize: 20 }} /> 文档搜索
              </Card>
            </Col>
            <Col span={6}>
              <Card hoverable onClick={() => navigate('/chat')}>
                <MessageOutlined style={{ color: '#1677ff', fontSize: 20 }} /> AI 问答
              </Card>
            </Col>
            <Col span={6}>
              <Card hoverable onClick={() => navigate('/graph')}>
                <ClusterOutlined style={{ color: '#1677ff', fontSize: 20 }} /> 知识图谱
              </Card>
            </Col>
          </>
        ) : null}
      </Row>
      <div className="kh-page" style={{ marginTop: 16, minHeight: 0 }}>
        <h3 style={{ marginTop: 0 }}>最近文档</h3>
        <Table
          rowKey="id"
          size="middle"
          pagination={false}
          dataSource={docs}
          columns={[
            {
              title: '标题',
              dataIndex: 'title',
              render: (title: string, row: DocumentItem) => (
                <a
                  onClick={() => navigate(`/documents/${row.id}`)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                >
                  <FileTypeIcon name={title} />
                  {title}
                </a>
              ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (status: number) => (
                // 状态码 0 草稿 / 1 已发布 / 2 已归档 / 3 待审核，统一由 DOC_STATUS 映射成标签
                <Tag color={DOC_STATUS[status]?.color}>{DOC_STATUS[status]?.label ?? status}</Tag>
              ),
            },
            { title: '更新时间', dataIndex: 'updatedAt', render: formatTime },
          ]}
        />
      </div>
    </div>
  )
}
