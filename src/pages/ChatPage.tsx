/**
 * 问答页：左侧会话列表 + 右侧流式对话区。
 * 关键交互：useChat + DefaultChatTransport 直连 /api/ai/chat/stream，流式期间发送按钮换成「停止」；
 * 新建、切换、删除会话都以 URL 上的 ?session= 为准，刷新后能直接恢复现场。
 * 坑 1：headers 必须写成函数，token 刷新后每次请求才能取到新值；
 * 坑 2：历史消息要经 historyToUIMessages 转成 parts，直接喂纯文本刷新后会整片空白。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Empty, Input, Space, Typography, message } from 'antd';
import { aiApi } from '../api';
import { ApiError } from '../api/client';
import { getAccessToken } from '../auth';
import {
  ChatMessageParts,
  historyToUIMessages,
  type KhUIMessage,
} from '../components/ChatMessageParts';
import type { ChatMessage, ChatSession } from '../types';
import { formatTime } from '../utils';

const CHAT_ID = 'kh-chat';

export default function ChatPage() {
  const navigate = useNavigate();
  const { modal } = App.useApp();
  const [params] = useSearchParams();
  const sessionId = params.get('session') || undefined;

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [input, setInput] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef(sessionId);
  const loadedSessionRef = useRef<string | undefined>(undefined);
  const pinBottomRef = useRef(true);
  sessionIdRef.current = sessionId;

  // transport 只建一次：每次渲染都 new 会重置内部状态，正在流式的回答会被打断
  const transport = useMemo(
    () =>
      new DefaultChatTransport<KhUIMessage>({
        api: '/api/ai/chat/stream',
        headers: () => {
          const token = getAccessToken();
          const headers: Record<string, string> = {};
          if (token) headers.Authorization = `Bearer ${token}`;
          return headers;
        },
      }),
    [],
  );

  const { messages, sendMessage, setMessages, status, stop, error } = useChat<KhUIMessage>({
    id: CHAT_ID,
    transport,
    onData: (part) => {
      // 后端在第一帧回 data-session；拿到会话 id 后立刻改 URL，用 replace 避免污染浏览器历史
      if (part.type !== 'data-session') return;
      const nextId = part.data.sessionId;
      if (!nextId || nextId === sessionIdRef.current) return;
      loadedSessionRef.current = nextId;
      navigate(`/chat?session=${nextId}`, { replace: true });
    },
    onFinish: () => {
      void loadSessions();
    },
    onError: (err) => {
      message.error(err.message || '请求失败');
    },
  });

  // status 除了 streaming 还有 submitted（请求已发出、首帧未到），两者都算“进行中”
  const streaming = status === 'submitted' || status === 'streaming';
  const busy = streaming;

  // 会话列表只是辅助信息，失败时保持上一次的内容，不弹错打断问答
  async function loadSessions() {
    try {
      const res = await aiApi.sessions();
      setSessions(res.items);
    } catch {
      /* 列表失败不挡问答 */
    }
  }

  // 首屏拉一次会话列表
  useEffect(() => {
    void loadSessions();
  }, []);

  // 按 URL 的 session 拉历史；streaming 时跳过，避免覆盖正在生成的回答
  useEffect(() => {
    if (streaming) return;
    if (!sessionId) {
      if (loadedSessionRef.current) {
        loadedSessionRef.current = undefined;
        setMessages([]);
      }
      return;
    }
    if (loadedSessionRef.current === sessionId) return;
    let cancelled = false;
    loadedSessionRef.current = sessionId;
    aiApi
      .messages(sessionId)
      .then((rows: ChatMessage[]) => {
        if (cancelled) return;
        // 接口只给 content 文本，必须补成 parts 结构，否则 ChatMessageParts 无可渲染内容
        setMessages(historyToUIMessages(rows));
      })
      .catch((err) => {
        if (!cancelled) {
          loadedSessionRef.current = undefined;
          message.error(err instanceof ApiError ? err.message : '加载会话失败');
          navigate('/chat', { replace: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, streaming, navigate, setMessages]);

  // 记录用户是否还贴着底部：上滑查看历史时不要被新内容强行拽下去
  function onLogScroll() {
    const el = logRef.current;
    if (!el) return;
    pinBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  // 流式时每帧都会更新 messages，这里在下一帧贴底，避免和布局计算抢时序
  useEffect(() => {
    if (!pinBottomRef.current) return;
    requestAnimationFrame(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    });
  }, [messages, status]);

  // 发送前先清空输入并强制贴底；sessionId 放在 body 里，由后端决定新建还是续聊
  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    pinBottomRef.current = true;
    await sendMessage({ text }, { body: { sessionId } });
  }

  function switchSession(id?: string) {
    if (busy) {
      message.warning('请等待当前回答结束再切换会话');
      return;
    }
    navigate(id ? `/chat?session=${id}` : '/chat');
  }

  async function onNew() {
    if (busy) {
      message.warning('请等待当前回答结束再开新对话');
      return;
    }
    try {
      const created = await aiApi.createSession();
      loadedSessionRef.current = created.id;
      setMessages([]);
      navigate(`/chat?session=${created.id}`);
      void loadSessions();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '创建失败');
    }
  }

  function onRemove(id: string, e: MouseEvent) {
    e.stopPropagation();
    if (busy) {
      message.warning('请等待当前回答结束再删除');
      return;
    }
    modal.confirm({
      title: '确定删除对话？',
      content: '删除后，聊天记录将不可恢复。',
      okText: '删除',
      cancelText: '取消',
      okType: 'danger',
      centered: true,
      onOk: async () => {
        try {
          await aiApi.removeSession(id);
          if (sessionId === id) {
            loadedSessionRef.current = undefined;
            setMessages([]);
            navigate('/chat');
          }
          void loadSessions();
        } catch (err) {
          message.error(err instanceof ApiError ? err.message : '删除失败');
          throw err;
        }
      },
    });
  }

  return (
    <div className='kh-page kh-chat-layout'>
      <aside className='kh-chat-sessions'>
        <Button
          type='primary'
          icon={<PlusOutlined />}
          block
          disabled={busy}
          onClick={() => void onNew()}
        >
          新对话
        </Button>
        <div className='kh-chat-session-list'>
          {sessions.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='还没有会话' />
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                className={`kh-chat-session-item${sessionId === s.id ? ' active' : ''}${busy ? ' disabled' : ''}`}
                onClick={() => switchSession(s.id)}
              >
                <div className='kh-chat-session-title'>{s.title}</div>
                <div className='kh-chat-session-meta'>
                  <span>{formatTime(s.updatedAt)}</span>
                  <DeleteOutlined onClick={(e) => onRemove(s.id, e)} />
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
      <div className='kh-chat-main'>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          知识问答
        </Typography.Title>
        <Typography.Paragraph type='secondary'>
          只会检索你有权限的文档（公开、所在团队、自己写的）。流式回答会展示检索、思考与联网搜索过程，并写入左侧会话。
        </Typography.Paragraph>
        <div className='kh-chat-log' ref={logRef} onScroll={onLogScroll}>
          {messages.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='输入问题开始一段对话' />
          ) : (
            messages.map((m, i) => {
              // 最后一条回答还在流式时不展示引用区，等结束再出现，避免卡片闪动
              const liveAssistant =
                streaming && m.role === 'assistant' && i === messages.length - 1;
              return (
                <div key={m.id} className={`kh-bubble ${m.role}`}>
                  <ChatMessageParts
                    messageId={m.id}
                    parts={m.parts}
                    role={m.role}
                    showSources={!liveAssistant}
                  />
                </div>
              );
            })
          )}
          {error ? <div className='kh-chat-error'>{error.message}</div> : null}
        </div>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            size='large'
            placeholder='例如：上线前如何做金丝雀验证？'
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={() => void send()}
          />
          {streaming ? (
            // 流式中把「发送」换成 stop()，同时上面的输入框和新建/切换都被 busy 禁用
            <Button size='large' onClick={() => void stop()}>
              停止
            </Button>
          ) : (
            <Button type='primary' size='large' onClick={() => void send()}>
              发送
            </Button>
          )}
        </Space.Compact>
      </div>
    </div>
  );
}
