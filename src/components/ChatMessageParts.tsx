/**
 * 职责：把一条消息的流式 parts 序列渲染成 UI。流式下「消息」不是字符串，而是一段 parts，
 * 这里按 part.type 分派：text 是正文（打字机效果就是它不断变长）、reasoning 是可折叠的
 * 思考过程、data-status 是阶段进度、data-retrieve 是知识库检索卡、data-sources 是引用
 * 来源、source-document 是来源锚点、source-url 是联网链接；step-start 与 data-session
 * 只是协议标记，不渲染。
 *
 * 依赖：react（useState）；ai（UIMessage / isToolUIPart / getToolName）；@ant-design/icons
 * 的 FileSearchOutlined、SearchOutlined（本文件不直接用 antd 组件）；./SourceCiteList 的
 * AnswerMarkdown（内部是 react-markdown + remark-gfm）与 SourceCiteList；../types 的 ChatSource。
 *
 * 与后端约定：KhUIMessage 里声明的自定义 data part 与后端返回一一对应，后端增删字段
 * 必须同步改这里，否则该 part 匹配不上，界面会静默丢掉内容（不报错，最难查）。
 *
 * 坑 1：data-status 的 retrieve 阶段若已有检索卡就不能再出一行，否则同样内容出现两次；
 * 坑 2：历史消息必须用 historyToUIMessages 造出 parts，直接喂纯文本会话刷新后是空白；
 * 坑 3：任何地方要完整正文都得走 textFromParts 拼接，流式下不存在单一正文字符串；
 * 坑 4：组件本身不判断是否还在流式，引用区由父组件在流式期间传 showSources=false 暂缓。
 */
import { useState, type ReactNode } from 'react';
import { getToolName, isToolUIPart } from 'ai';
import type { UIMessage } from 'ai';
import { FileSearchOutlined, SearchOutlined } from '@ant-design/icons';
import { AnswerMarkdown, SourceCiteList } from './SourceCiteList';
import type { ChatSource } from '../types';

// 检索卡的一行命中：index 与正文里的 [n] 角标对应，引用列表也靠它对上
export type RetrieveHit = {
  index: number;
  documentId: string;
  documentTitle: string;
  heading: string | null;
};

// data part 名 = 下面每个字段名加 data- 前缀（status 对应 data-status），两侧必须同名
export type KhUIMessage = UIMessage<
  unknown,
  {
    status: { stage: string; text: string };
    think: { text: string };
    sources: ChatSource[];
    retrieve: { query: string; items: RetrieveHit[] };
    session: { sessionId: string };
  }
>;

// web_search 的单条结果：snippet、siteName 可能缺，所以都标可选
type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
  siteName?: string;
};

type WebSearchResult = {
  query: string;
  items: WebSearchHit[];
  error?: string;
};

// 每条回答只会有一份 data-sources，取到即返回，没有则视为无引用
export function sourcesFromParts(parts: KhUIMessage['parts']): ChatSource[] {
  for (const part of parts) {
    if (part.type === 'data-sources' && Array.isArray(part.data)) {
      return part.data;
    }
  }
  return [];
}

/** 只保留回答里实际标了 [n] 的资料，避免无关召回也占引用区（列了没用） */
export function citedSources(sources: ChatSource[], answer: string): ChatSource[] {
  const used = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  // 一个角标都没有就直接返回空，调用方据此整块不渲染引用区
  if (!used.size) return [];
  return sources.filter((s) => used.has(s.index));
}

// 正文可能被拆成多个 text part，拼起来才能整体匹配 [n]；别假设 parts[0] 就是全文
export function textFromParts(parts: KhUIMessage['parts']): string {
  return parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

// 后端历史只有 content + sources，这里补成 parts 结构；顺序与流式一致：先来源后正文
// 不转换的后果不是报错而是刷新后历史整段空白：useChat 只认 { role, parts }，
// 拿到 { role, content } 时 parts 为空，渲染出来什么都没有
export function historyToUIMessages(
  rows: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    sources?: ChatSource[] | null;
  }>,
): KhUIMessage[] {
  return rows.map((row) => {
    if (row.role === 'user') {
      return {
        id: row.id,
        role: 'user',
        parts: [{ type: 'text', text: row.content }],
      };
    }
    const parts: KhUIMessage['parts'] = [];
    if (row.sources?.length) {
      parts.push({ type: 'data-sources', data: row.sources });
    }
    parts.push({ type: 'text', text: row.content });
    return { id: row.id, role: 'assistant', parts };
  });
}

/**
 * 只负责渲染，不判断是否还在流式：父组件对最后一条 assistant 消息在流式期间传
 * showSources=false 暂缓引用区，回答结束再放开，避免引用列表边生成边抖动。
 */
export function ChatMessageParts({
  messageId,
  parts,
  role,
  showSources = true,
}: {
  messageId: string;
  parts: KhUIMessage['parts'];
  role: KhUIMessage['role'];
  showSources?: boolean;
}) {
  // 引用区只展示正文里真的写了 [n] 的资料，召回但没引用的不占位置
  // 只在这里算一次：正文角标判定和底部列表必须用同一份数据，否则会出现点了不高亮
  const sources = citedSources(sourcesFromParts(parts), textFromParts(parts));
  const [activeCite, setActiveCite] = useState<number | null>(null);
  // 空字符串的 text part 也滤掉，避免多包一层空的 kh-bubble-md
  const texts = parts.filter((part) => part.type === 'text' && part.text);

  // 用户消息只有纯文本：不渲染过程卡片和引用，提问不该被套上引用区
  if (role === 'user') {
    return (
      <>
        {texts.map((part, i) =>
          part.type === 'text' ? (
            <div key={i} className='kh-bubble-text'>
              {part.text}
            </div>
          ) : null,
        )}
      </>
    );
  }

  // 先看整条消息有没有检索卡，供下面 data-status 去重判断
  // 过程 parts 统一排在正文之前：流式时先出思考、检索、搜索，正文随后逐字长出来
  const hasRetrieve = parts.some((part) => part.type === 'data-retrieve');

  return (
    <>
      {renderProcessParts(parts, hasRetrieve)}
      {texts.map((part, i) =>
        part.type === 'text' ? (
          <div key={`text-${i}`} className='kh-bubble-md'>
            <AnswerMarkdown
              text={part.text}
              sources={sources}
              scope={messageId}
              onCite={setActiveCite}
            />
          </div>
        ) : null,
      )}
      {showSources && sources.length ? (
        <SourceCiteList
          items={sources}
          scope={messageId}
          activeIndex={activeCite}
          onSelect={setActiveCite}
        />
      ) : null}
    </>
  );
}

// reasoning 多为流式碎片，相邻的合并成一个「思考过程」折叠块；遇到其他 part 先 flush 再继续
function renderProcessParts(parts: KhUIMessage['parts'], hasRetrieve: boolean) {
  const nodes: ReactNode[] = [];
  let reasoningBuf: string[] = [];
  let reasoningStreaming = false;
  let thinkKey = 0;

  const flushReasoning = () => {
    if (!reasoningBuf.length) return;
    nodes.push(
      <ThinkBlock
        key={`think-${thinkKey}`}
        text={reasoningBuf.join('\n\n')}
        streaming={reasoningStreaming}
      />,
    );
    thinkKey += 1;
    reasoningBuf = [];
    reasoningStreaming = false;
  };

  parts.forEach((part, i) => {
    if (part.type === 'reasoning' || part.type === 'data-think') {
      const text = 'text' in part && typeof part.text === 'string' ? part.text : '';
      if (text) reasoningBuf.push(text);
      if ('state' in part && part.state === 'streaming') reasoningStreaming = true;
      return;
    }

    flushReasoning();

    // 这些不单独成块：step-start、data-session 是协议标记，text 由外面渲染正文，
    // data-sources 汇总到引用区，source-document 是来源锚点，出了就是重复卡片
    if (
      part.type === 'step-start' ||
      part.type === 'data-session' ||
      part.type === 'data-sources' ||
      part.type === 'source-document' ||
      part.type === 'text'
    ) {
      return;
    }

    if (part.type === 'data-status') {
      // generate 阶段不单独提示（正文本身就在动）；retrieve 已有卡片时也不再重复一行
      if (part.data.stage === 'generate') return;
      if (part.data.stage === 'retrieve' && hasRetrieve) return;
      nodes.push(
        <div key={i} className='kh-chat-status'>
          {part.data.text}
        </div>,
      );
      return;
    }

    // 检索卡默认收起，流式时只占一行，展开才看命中列表
    if (part.type === 'data-retrieve') {
      nodes.push(<RetrieveCard key={i} query={part.data.query} items={part.data.items} />);
      return;
    }

    // 联网搜索的单条链接：新窗口打开，title 缺失时退回显示原始 URL
    if (part.type === 'source-url') {
      nodes.push(
        <a key={i} className='kh-web-link' href={part.url} target='_blank' rel='noreferrer'>
          {part.title || part.url}
        </a>,
      );
      return;
    }

    // 工具 part 按 state 自己渲染搜索中/失败/已搜到，不在这里再列一遍来源
    if (isToolUIPart(part) && getToolName(part) === 'web_search') {
      nodes.push(<WebSearchCard key={i} part={part} />);
    }
  });

  flushReasoning();
  return nodes;
}

// 命中 0 条也照样出卡：要让用户看到「查了但知识库没料」，否则像卡住了
function RetrieveCard({ query, items }: { query: string; items: RetrieveHit[] }) {
  const count = items.length;
  const label = count ? '已检索知识库' : '未检索到相关资料';

  return (
    <details className='kh-web'>
      <summary>
        <FileSearchOutlined />
        <span className='kh-web-label'>{label}</span>
        {query ? <span className='kh-web-q'>{query}</span> : null}
        {count ? <span className='kh-web-n'>{count}</span> : null}
      </summary>
      {count ? (
        <ul className='kh-web-list'>
          {items.map((hit) => (
            <li key={`${hit.documentId}-${hit.index}`}>
              [{hit.index}] {hit.documentTitle}
              {hit.heading ? ` / ${hit.heading}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

// 默认展开（open）：思考过程是流式阶段唯一的进展反馈，收起反而像卡住
function ThinkBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <details className='kh-think' open>
      <summary>{streaming ? '思考中…' : '思考过程'}</summary>
      <div className='kh-think-body'>{text}</div>
    </details>
  );
}

// 一个卡片承担搜索中、失败、已搜到三种状态：state 会在流式过程中原地变化，
// 拆成不同组件会让整块 DOM 重新挂载，视觉上闪一下
function WebSearchCard({
  part,
}: {
  part: {
    state: string;
    input?: unknown;
    output?: unknown;
    errorText?: string;
  };
}) {
  const input = asRecord(part.input);
  const query = typeof input.query === 'string' ? input.query : '';
  const pending = part.state === 'input-streaming' || part.state === 'input-available';
  const output = asWebSearchResult(part.output);
  const failed = part.state === 'output-error' || Boolean(output?.error);
  const count = output?.items?.length ?? 0;
  const label = pending ? '正在搜索' : failed ? '搜索失败' : '已搜索';

  return (
    <details className={`kh-web${pending ? ' pending' : ''}${failed ? ' failed' : ''}`}>
      <summary>
        <SearchOutlined />
        <span className='kh-web-label'>{label}</span>
        {query ? <span className='kh-web-q'>{query}</span> : null}
        {!pending && count ? <span className='kh-web-n'>{count}</span> : null}
      </summary>
      {failed ? (
        <div className='kh-web-err'>{output?.error || part.errorText}</div>
      ) : count ? (
        <ul className='kh-web-list'>
          {output?.items.map((hit) => (
            <li key={hit.url}>
              <a href={hit.url} target='_blank' rel='noreferrer'>
                {hit.title}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

// 工具的 input/output 都是 unknown，先兜底成空对象，后面取 query 才不会因 null 崩
function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return {};
}

// 只挑渲染要用的三个字段：后端结构变了也不会把多余字段漏进 UI
function asWebSearchResult(value: unknown): WebSearchResult | null {
  const rec = parseToolPayload(value);
  if (!rec) return null;
  return {
    query: typeof rec.query === 'string' ? rec.query : '',
    items: Array.isArray(rec.items) ? (rec.items as WebSearchHit[]) : [],
    error: typeof rec.error === 'string' ? rec.error : undefined,
  };
}

// 解析时 JSON 字符串与 content 嵌套两层都要试
/** LangChain tool 结果经常是 JSON 字符串或带 content 的消息对象 */
function parseToolPayload(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return parseToolPayload(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.content === 'string') {
    const nested = parseToolPayload(rec.content);
    if (nested) return nested;
  }
  return rec;
}
