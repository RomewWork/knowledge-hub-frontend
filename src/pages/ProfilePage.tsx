/**
 * 个人中心：顶部三项统计 + 资料表单 + 改密表单。
 * 关键交互：保存资料后同步刷新 auth 里的用户对象，顶部导航/头像才会立即变；
 * 改密必须带原密码，成功后只重置改密表单，资料表单保持原样。
 * 坑 1：资料表单的初始值来自 useAuth()，必须放进 effect 跟随 user 同步，否则刚改完不刷新；
 * 坑 2：统计接口失败被静默吞掉（catch 返回 undefined），页面仍可用，不要改成阻塞渲染。
 */
import { useEffect, useState } from 'react'
import { Button, Card, Col, Form, Input, Row, Statistic, message } from 'antd'
import { userApi } from '../api'
import { ApiError } from '../api/client'
import type { UserStats } from '../types'
import { updateUser, useAuth } from '../auth'

export default function ProfilePage() {
  const user = useAuth()
  const [stats, setStats] = useState<UserStats | null>(null)
  const [profileForm] = Form.useForm()
  const [pwdForm] = Form.useForm()

  // 统计与资料初始值一起同步：user 变化（比如刚保存完资料）就重新回填一次表单
  useEffect(() => {
    userApi.stats().then(setStats).catch(() => undefined)
    profileForm.setFieldsValue({
      realName: user?.realName,
      email: user?.email,
    })
  }, [user, profileForm])

  return (
    <div className="kh-page">
      <Row gutter={16}>
        <Col span={8}>
          <Statistic title="我的文档" value={stats?.documentCount ?? 0} />
        </Col>
        <Col span={8}>
          <Statistic title="浏览" value={stats?.viewCount ?? 0} />
        </Col>
        <Col span={8}>
          <Statistic title="点赞" value={stats?.likeCount ?? 0} />
        </Col>
      </Row>
      <Card title="资料" style={{ marginTop: 24 }}>
        <Form
          form={profileForm}
          layout="vertical"
          style={{ maxWidth: 420 }}
          onFinish={async (values: { realName?: string; email?: string }) => {
            try {
              // 先落库再更新本地 auth 用户，顺序反了会出现「提交失败但界面已改」
              await userApi.updateMe(values)
              if (user) {
                updateUser({ ...user, realName: values.realName, email: values.email })
              }
              message.success('已更新')
            } catch (error) {
              message.error(error instanceof ApiError ? error.message : '更新失败')
            }
          }}
        >
          <Form.Item label="用户名">
            <Input disabled value={user?.username} />
          </Form.Item>
          <Form.Item name="realName" label="姓名">
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            保存资料
          </Button>
        </Form>
      </Card>
      <Card title="修改密码" style={{ marginTop: 16 }}>
        <Form
          form={pwdForm}
          layout="vertical"
          style={{ maxWidth: 420 }}
          onFinish={async (values: { oldPassword: string; newPassword: string }) => {
            try {
              // 成功后只重置改密表单；失败保留输入（原密码错要让用户就地改），不要无条件 reset
              await userApi.changePassword(values.oldPassword, values.newPassword)
              message.success('密码已修改')
              pwdForm.resetFields()
            } catch (error) {
              message.error(error instanceof ApiError ? error.message : '修改失败')
            }
          }}
        >
          <Form.Item name="oldPassword" label="原密码" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            修改密码
          </Button>
        </Form>
      </Card>
    </div>
  )
}
