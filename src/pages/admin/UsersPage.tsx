/**
 * 用户管理：表格 + 分页 + 三个弹窗（新建用户、重置密码、分配角色）。
 * 关键交互：搜索、翻页、写操作后刷新都统一走 load(page)，角色下拉数据来自 roleApi.list；
 * 重置密码与分配角色都是独立弹窗，成功后各自关闭并刷新当前页。
 * 坑 1：本页要求 ADMIN，接口层还会再校验一次，前端藏入口不等于安全；
 * 坑 2：分配角色不允许为空，这里先拦一道给出中文提示，避免直接吃后端的英文报错。
 */
import { useEffect, useState } from 'react'
import { Button, Form, Input, Modal, Select, Space, Table, Tag, message } from 'antd'
import { roleApi, userApi } from '../../api'
import { ApiError } from '../../api/client'
import type { RoleItem, UserVO } from '../../types'
import { formatTime } from '../../utils'

export default function UsersPage() {
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<UserVO[]>([])
  const [roles, setRoles] = useState<RoleItem[]>([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [roleUser, setRoleUser] = useState<UserVO | null>(null)
  const [roleCodes, setRoleCodes] = useState<string[]>([])
  const [pwdUser, setPwdUser] = useState<UserVO | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [form] = Form.useForm()

  // 查询、翻页、写后刷新都走这里，保证 page 状态和接口参数一致
  async function load(nextPage = page) {
    setLoading(true)
    try {
      const res = await userApi.page({
        page: nextPage,
        pageSize: 10,
        keyword: keyword.trim() || undefined,
      })
      setItems(res.items)
      setTotal(res.total)
      setPage(nextPage)
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  // 首屏拉第一页 + 角色字典；角色列表失败只是下拉为空，不阻断表格
  useEffect(() => {
    void load(1)
    roleApi.list().then(setRoles).catch(() => undefined)
  }, [])

  return (
    <div className="kh-page">
      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder="用户名 / 姓名 / 邮箱"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={() => void load(1)}
        />
        <Button onClick={() => void load(1)}>查询</Button>
        <Button
          type="primary"
          onClick={() => {
            form.resetFields()
            setCreateOpen(true)
          }}
        >
          新建用户
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        pagination={{ current: page, pageSize: 10, total, onChange: (p) => void load(p) }}
        columns={[
          { title: '用户名', dataIndex: 'username' },
          { title: '姓名', dataIndex: 'realName' },
          { title: '邮箱', dataIndex: 'email' },
          {
            title: '角色',
            dataIndex: 'roleCodes',
            render: (codes: string[]) => codes?.map((c) => <Tag key={c}>{c}</Tag>),
          },
          {
            title: '状态',
            dataIndex: 'status',
            render: (s: number) => (s === 1 ? '启用' : '禁用'),
          },
          { title: '最近登录', dataIndex: 'lastLoginAt', render: formatTime },
          {
            title: '操作',
            render: (_: unknown, row: UserVO) => (
              <Space>
                <a
                  onClick={() => {
                    setPwdUser(row)
                    setNewPassword('')
                  }}
                >
                  重置密码
                </a>
                <a
                  onClick={() => {
                    setRoleUser(row)
                    setRoleCodes(row.roleCodes || [])
                  }}
                >
                  角色
                </a>
              </Space>
            ),
          },
        ]}
      />
      {/* 三个弹窗各自独立 state：新建用户、重置密码、分配角色互不干扰 */}
      <Modal
        title="新建用户"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values: {
            username: string
            password: string
            realName?: string
            email?: string
            roleCodes?: string[]
          }) => {
            try {
              await userApi.create(values)
              message.success('已创建')
              setCreateOpen(false)
              void load(1)
            } catch (error) {
              message.error(error instanceof ApiError ? error.message : '创建失败')
            }
          }}
        >
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="realName" label="姓名">
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input />
          </Form.Item>
          <Form.Item name="roleCodes" label="角色">
            <Select
              mode="multiple"
              options={roles.map((r) => ({ value: r.roleCode, label: r.roleName }))}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={pwdUser ? `重置 ${pwdUser.username} 的密码` : '重置密码'}
        open={Boolean(pwdUser)}
        onCancel={() => setPwdUser(null)}
        onOk={async () => {
          if (!pwdUser) return
          if (newPassword.length < 6) {
            message.error('密码至少 6 位')
            return
          }
          try {
            await userApi.resetPassword(pwdUser.id, newPassword)
            message.success('已重置')
            setPwdUser(null)
          } catch (error) {
            message.error(error instanceof ApiError ? error.message : '重置失败')
          }
        }}
      >
        <Input.Password
          placeholder="新密码至少 6 位"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </Modal>
      <Modal
        title="分配角色"
        open={Boolean(roleUser)}
        onCancel={() => setRoleUser(null)}
        onOk={async () => {
          if (!roleUser || !roleCodes.length) {
            message.error('至少选择一个角色')
            return
          }
          try {
            await userApi.assignRoles(roleUser.id, roleCodes)
            message.success('已更新角色')
            setRoleUser(null)
            void load()
          } catch (error) {
            message.error(error instanceof ApiError ? error.message : '更新失败')
          }
        }}
      >
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          value={roleCodes}
          onChange={setRoleCodes}
          options={roles.map((r) => ({ value: r.roleCode, label: r.roleName }))}
        />
      </Modal>
    </div>
  )
}
