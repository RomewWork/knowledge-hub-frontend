/**
 * 审核队列：按状态（待审/已通过/已驳回）翻文档审核任务。
 * 关键交互：切换状态下拉即重拉第一页；通过可直接提交，驳回必须填意见，
 * 两者共用同一个弹窗，由 action 区分提交到 approve 还是 reject。
 * 坑 1：本页要求 REVIEWER 或 ADMIN，接口层还会再校验一次；
 * 坑 2：只有 reviewResult 为空的任务才显示操作，已审的不能再点。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Input, Modal, Select, Space, Table, Tag, message } from 'antd'
import { documentApi } from '../../api'
import { ApiError } from '../../api/client'
import type { ReviewTask } from '../../types'
import { formatTime } from '../../utils'

export default function ReviewsPage() {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [items, setItems] = useState<ReviewTask[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [task, setTask] = useState<ReviewTask | null>(null)
  const [action, setAction] = useState<'approve' | 'reject'>('approve')
  const [comment, setComment] = useState('')

  // 当前状态 + 页码决定列表；翻页不重置状态，但切状态要回到第一页
  async function load(nextPage = page) {
    setLoading(true)
    try {
      const res = await documentApi.reviewTasks({ status, page: nextPage, pageSize: 10 })
      setItems(res.items)
      setTotal(res.total)
      setPage(nextPage)
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  // 状态变化就重查第一页，避免停在旧页码上出现空表
  useEffect(() => {
    void load(1)
  }, [status])

  return (
    <div className="kh-page">
      <Space style={{ marginBottom: 16 }}>
        <Select
          value={status}
          style={{ width: 160 }}
          onChange={setStatus}
          options={[
            { value: 'pending', label: '待审' },
            { value: 'approved', label: '已通过' },
            { value: 'rejected', label: '已驳回' },
          ]}
        />
        <Button onClick={() => void load(1)}>刷新</Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        pagination={{ current: page, pageSize: 10, total, onChange: (p) => void load(p) }}
        columns={[
          {
            title: '文档',
            dataIndex: 'documentId',
            render: (id: string) => <Link to={`/documents/${id}`}>{id}</Link>,
          },
          {
            title: '结果',
            dataIndex: 'reviewResult',
            render: (v: number | null) =>
              v == null ? <Tag>待审</Tag> : v === 1 ? <Tag color="success">通过</Tag> : <Tag color="error">驳回</Tag>,
          },
          { title: '意见', dataIndex: 'reviewComment' },
          { title: '提交时间', dataIndex: 'createdAt', render: formatTime },
          {
            title: '操作',
            render: (_: unknown, row: ReviewTask) =>
              row.reviewResult == null ? (
                <Space>
                  <a
                    onClick={() => {
                      setTask(row)
                      setAction('approve')
                      setComment('内容符合规范，准予发布')
                    }}
                  >
                    通过
                  </a>
                  <a
                    onClick={() => {
                      setTask(row)
                      setAction('reject')
                      setComment('')
                    }}
                  >
                    驳回
                  </a>
                </Space>
              ) : (
                '-'
              ),
          },
        ]}
      />
      {/* 通过/驳回共用同一个弹窗，靠 action 区分；驳回时意见必须非空 */}
      <Modal
        title={action === 'approve' ? '审核通过' : '审核驳回'}
        open={Boolean(task)}
        onCancel={() => setTask(null)}
        onOk={async () => {
          if (!task) return
          try {
            if (action === 'approve') {
              await documentApi.approve(task.id, comment || undefined)
            } else {
              if (!comment.trim()) {
                message.error('驳回必须填写意见')
                return
              }
              await documentApi.reject(task.id, comment.trim())
            }
            message.success('已提交')
            setTask(null)
            void load()
          } catch (error) {
            message.error(error instanceof ApiError ? error.message : '操作失败')
          }
        }}
      >
        <Input.TextArea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Modal>
    </div>
  )
}
