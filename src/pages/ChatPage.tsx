/**
 * 问答页：左侧会话列表 + 右侧流式对话区。
 * 关键交互：useChat + DefaultChatTransport 直连 /api/ai/chat/stream，流式期间发送按钮换成「停止」；
 * 新建、切换、删除会话都以 URL 上的 ?session= 为准，刷新后能直接恢复现场。
 * 坑 1：headers 必须写成函数，token 刷新后每次请求才能取到新值；
 * 坑 2：历史消息要经 historyToUIMessages 转成 parts，直接喂纯文本刷新后会整片空白。
 * 坑 3：钉底状态用 ref（pinBottomRef）而不是 state——流式每个 token 都会触发滚动，
 *       用 state 会形成 render → 滚动 → setState 的回环；
 * 坑 4：程序滚动期间必须切 autoScrollingRef，否则给 scrollTop 赋值触发的 onScroll 会被误判成
 *       用户离开底部，钉底当场失效。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, TouchEvent, WheelEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { DeleteOutlined, DownOutlined, PlusOutlined } from '@ant-design/icons';
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

const CHAT_ID = 'kh-chat'; // useChat 会话键，切页面时复用同一条流

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
  /** true 时流式输出自动滚到底；用户上滑后解开，避免抢滚动 */
  const pinBottomRef = useRef(true);
  /** 程序滚动时忽略 onScroll，避免误判为用户离开底部 */
  const autoScrollingRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const touchYRef = useRef<number | null>(null);
  const [showJump, setShowJump] = useState(false);
  // 保存当前会话 id 的 ref 版本：onData 比较新旧 id 时不受闭包里旧值的干扰
  sessionIdRef.current = sessionId;

  // headers 写成函数而不是常量对象，每次请求现取 token，token 刷新后才不会继续用过期的
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
      // 后端用 data-session 回传新会话 id，这里把地址栏同步过去；replace 不留历史，后退不会退回无参页
      if (part.type !== 'data-session') return;
      const nextId = part.data.sessionId;
      if (!nextId || nextId === sessionIdRef.current) return;
      loadedSessionRef.current = nextId;
      navigate(`/chat?session=${nextId}`, { replace: true });
    },
    onFinish: () => {
      // 流结束后刷新左侧列表，标题与更新时间才是最新的
      void loadSessions();
    },
    onError: (err) => {
      // 弹出提示的同时，error 也会在日志区末尾渲染一条，方便回看失败原因
      message.error(err.message || '请求失败');
    },
  });

  // submitted 是「已提交、还没收到首个 token」，同样算流式中，发送与增删会话都要禁用
  const streaming = status === 'submitted' || status === 'streaming';
  const busy = streaming;

  /** 会话列表失败不阻断问答，所以这里吞掉异常 */
  async function loadSessions() {
    try {
      const res = await aiApi.sessions();
      setSessions(res.items);
    } catch {
      /* 列表失败不挡问答 */
    }
  }

  // 只在挂载时拉一次，之后靠 onFinish 与增删会话后手动刷新
  useEffect(() => {
    void loadSessions();
  }, []);

  /**
   * 按 URL 上的 ?session= 恢复历史：只有「当前没在流式」且「这个会话还没加载过」时才拉消息。
   * 用 loadedSessionRef 记住已加载的 id，避免 onData 改写 URL 触发重复请求，
   * 也避免切换会话时把刚收到的流式消息覆盖掉；卸载或换会话时用 cancelled 丢弃迟到的响应。
   */
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

  /** 滚动位置到内容底部的距离，钉底判定统一以它为准 */
  function gapToBottom(el: HTMLElement) {
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }

  /** 回到底部按钮的显隐：未钉底、且内容确实溢出（>8px）才显示，避免尺寸抖动时按钮闪烁 */
  function syncJumpButton() {
    const el = logRef.current;
    const overflow = !!el && el.scrollHeight - el.clientHeight > 8;
    const next = !pinBottomRef.current && overflow;
    setShowJump((prev) => (prev === next ? prev : next));
  }

  /** 唯一的钉底开关：改 ref、顺手取消排队中的滚动帧，再同步按钮显隐 */
  function setPinned(next: boolean) {
    pinBottomRef.current = next;
    if (!next && scrollRafRef.current != null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    syncJumpButton();
  }

  /** 真正执行滚动的那一步；只有钉底时才动，autoScrollingRef 在下一帧清除，让 onScroll 忽略这次程序滚动 */
  function scrollToBottom() {
    const el = logRef.current;
    if (!el || !pinBottomRef.current) return;
    autoScrollingRef.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      autoScrollingRef.current = false;
    });
  }

  /** 用户滚动：距底 48px 以内视为贴底；程序滚动期间直接返回，不参与判定 */
  function onLogScroll() {
    if (autoScrollingRef.current) return;
    const el = logRef.current;
    if (!el) return;
    setPinned(gapToBottom(el) < 48);
  }

  /** 滚轮向上立刻取消钉底；向下接近底部再钉回 */
  function onLogWheel(e: WheelEvent<HTMLDivElement>) {
    if (e.deltaY < 0) {
      setPinned(false);
      return;
    }
    const el = logRef.current;
    if (el && gapToBottom(el) - e.deltaY < 48) setPinned(true);
  }

  /** 移动端没有 wheel 事件，用触点位移补偿：按下时记下起点 */
  function onLogTouchStart(e: TouchEvent<HTMLDivElement>) {
    touchYRef.current = e.touches[0]?.clientY ?? null;
  }

  /** 手指下移超过 6px（即内容向上翻）就解锁钉底；阈值留点容差，避免轻微抖动误触 */
  function onLogTouchMove(e: TouchEvent<HTMLDivElement>) {
    const y = e.touches[0]?.clientY;
    if (touchYRef.current != null && y != null && y > touchYRef.current + 6) {
      setPinned(false);
    }
    touchYRef.current = y ?? null;
  }

  /** 点「回到底部」：先钉底再滚，顺序反了会被 scrollToBottom 里的钉底判断直接拦下 */
  function jumpToBottom() {
    setPinned(true);
    scrollToBottom();
  }

  /**
   * 流式内容变化时滚动：每个 token 都会改 messages/status，所以把滚动推迟到下一帧，
   * 且同一帧内只排一次（先取消旧帧），避免每个 token 都触发一次重排；
   * 依赖变化或卸载时取消未执行的帧，防止回调打到已卸载的节点上。
   */
  useEffect(() => {
    if (!pinBottomRef.current) return;
    if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      scrollToBottom();
    });
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [messages, status]);

  /** 发送前先钉底：用户可能正停在历史位置看内容，主动提问时应该回到最新一条 */
  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setPinned(true);
    await sendMessage({ text }, { body: { sessionId } });
  }

  /** 流式期间禁止切换会话，否则旧流后续的 chunk 会落到新会话的消息上 */
  function switchSession(id?: string) {
    if (busy) {
      message.warning('请等待当前回答结束再切换会话');
      return;
    }
    navigate(id ? `/chat?session=${id}` : '/chat');
  }

  /** 新建会话：先把 loadedSessionRef 指向新 id，避免上面的恢复 effect 再把历史拉一遍 */
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

  /** 删除会话：点击要 stopPropagation，否则会连带触发整行的切换会话 */
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
          // 删掉的正是当前会话，就清空现场并回到无参地址
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
          只会检索你有权限的文档（公开、所在团队、自己写的）。先识别意图再检索；资料不切题时由助手改写问题再查，仍不足才按需联网。
        </Typography.Paragraph>
        <div className='kh-chat-log-wrap'>
          <div
            className='kh-chat-log'
            ref={logRef}
            onScroll={onLogScroll}
            onWheel={onLogWheel}
            onTouchStart={onLogTouchStart}
            onTouchMove={onLogTouchMove}
          >
            {messages.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='输入问题开始一段对话' />
            ) : (
              messages.map((m, i) => {
                // 只有「正在流式的最后一条 assistant」隐藏引用区：正文里的 [n] 可能还没输出完，先列引用会来回跳
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
          {/* 未钉底且有溢出时的快捷入口，定位由 kh-chat-jump 的绝对定位负责 */}
          {showJump ? (
            <Button
              className='kh-chat-jump'
              size='small'
              icon={<DownOutlined />}
              onClick={jumpToBottom}
            >
              回到底部
            </Button>
          ) : null}
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
