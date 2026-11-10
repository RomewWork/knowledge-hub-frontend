/**
 * 职责：应用入口，把 ConfigProvider、AntdApp、BrowserRouter 依次套在 App 外层后挂到 #root。
 * 依赖：App.tsx、全局样式 index.css、antd 的 zh_CN 语言包。
 * 坑：
 * 1. ConfigProvider 必须在 AntdApp 外层，App 内用到的 message/modal 才能继承主题和中文文案；
 * 2. BrowserRouter 要在 App 外层，否则页面的路由 hook 拿不到上下文；
 * 3. root 用了非空断言，index.html 里一旦没有 #root 会在启动时直接抛错。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider, App as AntdApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 6,
        },
      }}
    >
      <AntdApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
)
