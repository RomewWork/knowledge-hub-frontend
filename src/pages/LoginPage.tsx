/**
 * 登录页：账号密码登录入口。
 * 关键交互：提交表单调用 authApi.login，成功后 setAuth 写入 token 与用户信息并跳转 /dashboard；
 * 失败用 message.error 提示，ApiError 优先展示后端文案。
 * 坑 1：跳转用 replace，避免用户回退又回到登录页；登录态只代表身份，权限仍以后端 @RequirePermission 为准。
 * 坑 2：表单 initialValues 里是演示账号，接入真实环境前应去掉，否则等于把口令写死在前端。
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Form, Input, message } from 'antd'
import { authApi } from '../api'
import { ApiError } from '../api/client'
import { setAuth } from '../auth'
import { BrandLogo } from '../components/BrandLogo'

export default function LoginPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  return (
    <div className="kh-login">
      <Card className="kh-login-card">
        <div className="kh-login-title">
          <BrandLogo size={40} />
          <h1>Knowledge Hub</h1>
          <p>登录后使用文档、检索、问答与图谱</p>
        </div>
        <Form
          layout="vertical"
          initialValues={{ username: 'user', password: '123456' }}
          onFinish={async (values: { username: string; password: string }) => {
            setLoading(true)
            try {
              const result = await authApi.login(values.username, values.password)
              // 先落地本地认证信息再跳转，避免目标页读不到 token
              setAuth({
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                user: result.userInfo,
              })
              navigate('/dashboard', { replace: true })
            } catch (error) {
              message.error(error instanceof ApiError ? error.message : '登录失败')
            } finally {
              setLoading(false)
            }
          }}
        >
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input size="large" placeholder="用户名" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}>
            <Input.Password size="large" placeholder="密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={loading}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  )
}
