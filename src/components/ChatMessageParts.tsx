/**
 * 流式回答的渲染层：把 useChat 产出的 parts 序列翻译成「过程轨迹 + Markdown 正文 + 引用区」。
 * 关键交互：parts 是按事件先后排列的数组，这里按 part.type 分派——data-status / data-intent /
 * data-eval / data-retrieve / data-think 等 data part 进 kh-trace 时间线（由 TraceItem 画节点），
 * text 与 reasoning 走正文和思考块，tool part（retrieve_knowledge / rewrite_query / web_search）
 * 按 state 渲染 pending / failed / 完成三态。v17 新增的 data-intent（意图路由）与 data-eval（切题评估）
 * 就是原来那两句纯文本进度提示升级成的结构化卡片。
 *
 * 坑 1：同一阶段后端会同时发 data-status{stage:'intent'} 和 data-intent，渲染时必须有 data-intent
 *       就跳过 status，否则时间线里同一件事出现两次（retrieve/rewrite 同理，见 renderProcessParts）。
 * 坑 2：评估、改写、路由模型的中间 JSON（{relevant,reason} / {query} / {intent,standalone_query}）
 *       会混进 text part，得靠 stripInternalToolJson 兜底剔除；那是后端 invokeIsolated 之外的
 *       第二道防线，不能因为后端改了就删。
 * 坑 3：历史消息的 content 是纯字符串，必须先经 historyToUIMessages 转成 parts 再喂给 useChat，
 *       否则刷新页面后气泡整片空白。
 * 坑 4：节点颜色是 kh-trace-{kind} 加 tone（pending/warn/failed/ok）两个类名拼出来的，
 *       新增 kind 或 tone 要同步补样式，不然节点会退化成默认灰点。
 * 坑 5：推理流是连续多个 part，要先用 reasoningBuf 攒起来再 flush，逐段渲染会碎成一堆小卡片。
 */
import { useState, type ReactNode } from 'react';
import { getToolName, isToolUIPart } from 'ai';
import type { UIMessage } from 'ai';
import { AnswerMarkdown, SourceCiteList } from './SourceCiteList';
import type { ChatSource } from '../types';

/** 检索命中的单条文档片段；index 与回答里的 [n] 引用编号对齐 */
export type RetrieveHit = {
  index: number;
  documentId: string;
  documentTitle: string;
  heading: string | null;
};

/** 与后端 ChatIntent 一致；kb = 知识库 */
export type ChatIntent =
  | 'chitchat' // 闲聊，不检索
  | 'profile' // 个人偏好，不检索
  | 'kb' // 知识库
  | 'web' // 联网
  | 'kb_then_web'; // 先知识库，不足再联网

/** data-intent：本轮路由，决定是否展示知识库/联网范围 */
export type IntentPart = {
  intent: ChatIntent;
  label: string;
  query: string;
  allowRetrieve: boolean;
  allowWeb: boolean;
};

/** data-eval：ok 表示资料切题，不是「有召回条数」 */
export type EvalPart = {
  ok: boolean;
  reason:
    | 'ok' // 首轮检索切题
    | 'retried_ok' // 改写后再查切题
    | 'empty' // 首轮无命中
    | 'retried_empty' // 改写后再查仍无命中
    | 'irrelevant' // 首轮有命中但不切题
    | 'retried_irrelevant' // 改写后再查仍不切题
    | 'error'; // 检索接口失败
  text: string;
  retried: boolean;
  query: string;
  retryQuery?: string;
};

/** 消息类型：第二个泛型参数登记后端下发的全部 data part，新增 part 要先在这里补声明才拿得到类型 */
export type KhUIMessage = UIMessage<
  unknown,
  {
    status: { stage: string; text: string };
    think: { text: string };
    sources: ChatSource[];
    retrieve: { query: string; items: RetrieveHit[] };
    intent: IntentPart;
    eval: EvalPart;
    session: { sessionId: string };
  }
>;

/** 联网搜索的单条结果，siteName 只用于展示 */
type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
  siteName?: string;
};

/** web_search 输出的规整结构：一次查询对应多条命中，失败时用 error 承载原因 */
type WebSearchResult = {
  query: string;
  items: WebSearchHit[];
  error?: string;
};

/** 按先后顺序取第一个 data-sources；历史回放时由 historyToUIMessages 注入，没有就返回空数组 */
export function sourcesFromParts(parts: KhUIMessage['parts']): ChatSource[] {
  for (const part of parts) {
    if (part.type === 'data-sources' && Array.isArray(part.data)) {
      return part.data;
    }
  }
  return [];
}

/** 只保留回答里实际标了 [n] 的资料，避免无关召回也占引用区 */
export function citedSources(sources: ChatSource[], answer: string): ChatSource[] {
  const used = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  if (!used.size) return [];
  return sources.filter((s) => used.has(s.index));
}

/**
 * 正文纯文本：把所有 text part 拼起来，每段都先过 stripInternalToolJson。
 * 引用筛选、复制、Markdown 渲染都以它为准，所以过滤必须落在这一层，上层拿到的就是干净文本。
 */
export function textFromParts(parts: KhUIMessage['parts']): string {
  return parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => stripInternalToolJson(part.text))
    .filter(Boolean)
    .join('');
}

/**
 * 评估/改写模型的 JSON 不应出现在回答里。
 * 后端已用 invokeIsolated 把内部调用隔离掉，这里是前端第二道防线：逐行判定、命中整行删，
 * 再压掉多余空行，避免回答中间露出机器字段。
 */
function stripInternalToolJson(text: string): string {
  return text
    .split('\n')
    .filter((line) => !isInternalToolJson(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 只认三种已知泄漏形状：{relevant,reason} 评估、仅含 query 的改写、{intent,standalone_query} 路由 */
function isInternalToolJson(text: string): boolean {
  if (!text.startsWith('{')) return false;
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return false;
    const keys = Object.keys(obj);
    if (keys.includes('relevant') && keys.includes('reason')) return true;
    if (keys.length === 1 && keys[0] === 'query') return true;
    if (keys.includes('intent') && keys.includes('standalone_query')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * 把后端历史记录（纯 content 字符串）还原成 parts 序列。
 * 不转换直接塞给 useChat 的话，气泡里根本没有 text part，刷新后整段回答会空白；
 * 有 sources 时先放 data-sources 再追加正文，顺序与流式期间保持一致。
 */
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
 * 单条消息的渲染入口：user 只出文本，assistant 出「过程轨迹 + Markdown 正文 + 引用区」。
 * 引用数只算正文里真正标了 [n] 的条目，所以必须先拿到过滤过内部 JSON 的文本。
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
  const sources = citedSources(sourcesFromParts(parts), textFromParts(parts));
  const [activeCite, setActiveCite] = useState<number | null>(null);
  // 先筛出有内容的 text part：被内部 JSON 过滤后为空的片段不再渲染，否则会多出一个空气泡
  const texts = parts.filter((part) => {
    if (part.type !== 'text' || !part.text) return false;
    return Boolean(stripInternalToolJson(part.text));
  });

  // 用户气泡只渲染纯文本；过程轨迹、Markdown 和引用区都只属于 assistant
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

  // 同一阶段可能既收到 status 文本、又收到结构化 data part 或 tool part，这几个标记用来决定谁留下
  const hasRetrieve = parts.some(
    (part) =>
      part.type === 'data-retrieve' ||
      (isToolUIPart(part) && getToolName(part) === 'retrieve_knowledge'),
  );
  const hasIntent = parts.some((part) => part.type === 'data-intent');
  const hasRewrite = parts.some(
    (part) => isToolUIPart(part) && getToolName(part) === 'rewrite_query',
  );

  return (
    <>
      {renderProcessParts(parts, hasRetrieve, hasIntent, hasRewrite)}
      {texts.map((part, i) =>
        part.type === 'text' ? (
          <div key={`text-${i}`} className='kh-bubble-md'>
            <AnswerMarkdown
              text={stripInternalToolJson(part.text)}
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

/**
 * 回答正文前的过程条：意图 → 检索 → 评估 → 改写 → 再检索 → 联网 → 思考。
 * 返回一个 kh-trace 容器，内部每个节点由 TraceItem 画出时间线的圆点与连接线。
 * 去重集中在这里：某阶段已经有结构化 part（hasIntent / hasRetrieve / hasRewrite）时，
 * 对应的 data-status 直接丢掉，只留信息更全的卡片；generate 阶段的 status 属于正文提示，也不需要。
 */
function renderProcessParts(
  parts: KhUIMessage['parts'],
  hasRetrieve: boolean,
  hasIntent: boolean,
  hasRewrite: boolean,
) {
  // 推理片段常是连续多个 part，先攒进 reasoningBuf，遇到其他 part 或结束时统一 flush
  const nodes: ReactNode[] = [];
  let reasoningBuf: string[] = [];
  let reasoningStreaming = false;
  let thinkKey = 0;

  /** 把攒下的推理片段合并成一个思考块；流式还没结束就打上 pending 标记 */
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

    // 这些 part 不进时间线：step-start / data-session 是控制信息，data-sources、source-document 和正文交给引用区
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
      // 有结构化 part 时 status 只是同一事件的文本版，跳过，否则时间线会重复
      if (part.data.stage === 'generate') return;
      if (part.data.stage === 'retrieve' && hasRetrieve) return;
      if (part.data.stage === 'intent' && hasIntent) return;
      if (part.data.stage === 'rewrite' && hasRewrite) return;
      nodes.push(
        <TraceItem key={i} kind='status' tone='pending'>
          <div className='kh-trace-status'>{part.data.text}</div>
        </TraceItem>,
      );
      return;
    }

    if (part.type === 'data-intent') {
      // v17：意图路由单独成卡，替代原来只有一行文本的 status
      nodes.push(<IntentCard key={i} data={part.data} />);
      return;
    }

    if (part.type === 'data-eval') {
      // v17：切题评估卡，ok 表示资料切题，与召回条数无关
      nodes.push(<EvalCard key={i} data={part.data} />);
      return;
    }

    if (part.type === 'data-retrieve') {
      nodes.push(<RetrieveCard key={i} query={part.data.query} items={part.data.items} />);
      return;
    }

    if (isToolUIPart(part) && getToolName(part) === 'retrieve_knowledge') {
      nodes.push(<RetrieveToolCard key={i} part={part} />);
      return;
    }

    if (isToolUIPart(part) && getToolName(part) === 'rewrite_query') {
      nodes.push(<RewriteToolCard key={i} part={part} />);
      return;
    }

    if (part.type === 'source-url') {
      nodes.push(
        <a key={i} className='kh-web-link' href={part.url} target='_blank' rel='noreferrer'>
          {part.title || part.url}
        </a>,
      );
      return;
    }

    if (isToolUIPart(part) && getToolName(part) === 'web_search') {
      nodes.push(<WebSearchCard key={i} part={part} />);
    }
  });

  flushReasoning();
  if (!nodes.length) return null;
  return <div className='kh-trace'>{nodes}</div>;
}

/**
 * 时间线单节点：左侧圆点由 kh-trace-{kind} 上色，右侧卡片承载内容。
 * tone 只表达状态（pending/warn/failed/ok），与 kind 叠加成最终样式，两者都不能省。
 */
function TraceItem({ kind, tone, children }: { kind: string; tone?: string; children: ReactNode }) {
  return (
    <div className={`kh-trace-item kh-trace-${kind}${tone ? ` ${tone}` : ''}`}>
      <span className='kh-trace-node' aria-hidden />
      <div className='kh-trace-card'>{children}</div>
    </div>
  );
}

/** 意图卡：展示识别出的意图标签、建议检索词，以及知识库/联网两条通路是否放行（on/off 即范围） */
function IntentCard({ data }: { data: IntentPart }) {
  return (
    <TraceItem kind='intent'>
      <div className='kh-panel'>
        <div className='kh-panel-head'>
          <span className='kh-panel-type'>意图识别</span>
          <span className='kh-panel-title'>{data.label}</span>
        </div>
        <dl className='kh-meta'>
          {data.query ? (
            <div>
              <dt>建议检索词</dt>
              <dd>{data.query}</dd>
            </div>
          ) : null}
          <div>
            <dt>范围</dt>
            <dd>
              <span className={data.allowRetrieve ? 'on' : 'off'}>知识库</span>
              <span className={data.allowWeb ? 'on' : 'off'}>联网</span>
            </dd>
          </div>
        </dl>
      </div>
    </TraceItem>
  );
}

/**
 * 评估卡：三档状态——failed（资料不足或不切题）、warn（改写后才切题）、ok（首轮就切题）。
 * 注意 ok 的判据是「切题」而不是「有召回」，空召回同样落到 failed。
 */
function EvalCard({ data }: { data: EvalPart }) {
  const tone = !data.ok ? 'failed' : data.retried ? 'warn' : 'ok';
  const stamp = !data.ok ? '不足' : data.retried ? '已改写' : '切题';
  return (
    <TraceItem kind='eval' tone={tone}>
      <div className='kh-panel'>
        <div className='kh-panel-head'>
          <span className='kh-panel-type'>检索评估</span>
          <span className={`kh-badge ${tone}`}>{stamp}</span>
          <span className='kh-panel-title'>{data.text}</span>
        </div>
        {data.query || data.retryQuery ? (
          <dl className='kh-meta'>
            {data.query ? (
              <div>
                <dt>检索词</dt>
                <dd>{data.query}</dd>
              </div>
            ) : null}
            {data.retryQuery ? (
              <div>
                <dt>改写词</dt>
                <dd>{data.retryQuery}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>
    </TraceItem>
  );
}

/** 命中清单：序号补成两位，与回复正文里的 [n] 引用编号对齐，方便用户对照 */
function RetrieveHits({ items }: { items: RetrieveHit[] }) {
  return (
    <ol className='kh-sheet-docs'>
      {items.map((hit) => (
        <li key={`${hit.documentId}-${hit.index}`}>
          <em>{String(hit.index).padStart(2, '0')}</em>
          <span>
            {hit.documentTitle}
            {hit.heading ? <small>{hit.heading}</small> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** data-retrieve 的静态卡片（服务端一次性下发的结果），没有 pending 态，只按有无命中分成功/失败 */
function RetrieveCard({ query, items }: { query: string; items: RetrieveHit[] }) {
  const count = items.length;
  return (
    <KbPanel
      pending={false}
      failed={!count}
      label={count ? '已检索可见文档' : '未检索到相关资料'}
      query={query}
      count={count}
    >
      {count ? <RetrieveHits items={items} /> : null}
    </KbPanel>
  );
}

/** 思考块：默认展开；streaming 为真时走 pending 色并显示「思考中…」 */
function ThinkBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <TraceItem kind='think' tone={streaming ? 'pending' : undefined}>
      <details className='kh-note' open>
        <summary className='kh-panel-head'>
          <span className='kh-panel-type'>思考过程</span>
          <span className='kh-panel-title'>{streaming ? '思考中…' : '已完成'}</span>
        </summary>
        <p className='kh-note-body'>{text}</p>
      </details>
    </TraceItem>
  );
}

/**
 * 知识库面板外壳：把 pending / failed / ok 三态折算成 tone，统一「类型 + 标题 + 检索词 + 条数」的头部版式。
 * 有 error 时正文位置换成错误条，children（命中清单）不渲染。
 */
function KbPanel({
  pending,
  failed,
  label,
  query,
  count,
  error,
  children,
}: {
  pending: boolean;
  failed: boolean;
  label: string;
  query?: string;
  count?: number;
  error?: string;
  children?: ReactNode;
}) {
  const tone = pending ? 'pending' : failed ? 'failed' : 'ok';
  return (
    <TraceItem kind='kb' tone={tone}>
      <details className='kh-sheet' open>
        <summary className='kh-panel-head'>
          <span className='kh-panel-type'>知识库</span>
          <span className='kh-panel-title'>{label}</span>
          {query ? <span className='kh-panel-sub'>{query}</span> : null}
          {count ? <b className='kh-panel-n'>{count}</b> : null}
        </summary>
        {error ? <div className='kh-step-err'>{error}</div> : children}
      </details>
    </TraceItem>
  );
}

/**
 * retrieve_knowledge 工具调用卡：pending 由 tool part 的 state 推出（input 还在流或已就绪但没输出）。
 * 输出既可能是 JSON 字符串，也可能是带 content 的消息对象，统一交给 parseToolPayload 拆。
 */
function RetrieveToolCard({
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
  const pending = part.state === 'input-streaming' || part.state === 'input-available';
  const rec = parseToolPayload(part.output);
  const query =
    (typeof rec?.query === 'string' && rec.query) ||
    (typeof input.query === 'string' ? input.query : '');
  const items = Array.isArray(rec?.items) ? (rec.items as RetrieveHit[]) : [];
  const failed = part.state === 'output-error' || typeof rec?.error === 'string';
  const label = pending
    ? '正在检索知识库'
    : failed
      ? '检索失败'
      : items.length
        ? '已检索可见文档'
        : '未检索到相关资料';

  return (
    <KbPanel
      pending={pending}
      failed={failed || !items.length}
      label={label}
      query={query}
      count={!pending && items.length ? items.length : undefined}
      error={failed ? String(rec?.error || part.errorText || '检索失败') : undefined}
    >
      {!failed && items.length ? <RetrieveHits items={items} /> : null}
    </KbPanel>
  );
}

/** rewrite_query 工具调用卡：并列展示改写前后的检索词，失败时只留错误信息 */
function RewriteToolCard({
  part,
}: {
  part: {
    state: string;
    input?: unknown;
    output?: unknown;
    errorText?: string;
  };
}) {
  const rec = parseToolPayload(part.output);
  const pending = part.state === 'input-streaming' || part.state === 'input-available';
  const failed = part.state === 'output-error' || typeof rec?.error === 'string';
  const query = typeof rec?.query === 'string' ? rec.query : '';
  const previous = typeof rec?.previousQuery === 'string' ? rec.previousQuery : '';
  const tone = pending ? 'pending' : failed ? 'failed' : 'ok';
  const title = pending ? '正在改写检索词' : failed ? '改写失败' : '已改写检索词';

  return (
    <TraceItem kind='rewrite' tone={tone}>
      <div className='kh-panel'>
        <div className='kh-panel-head'>
          <span className='kh-panel-type'>改写</span>
          <span className='kh-panel-title'>{title}</span>
        </div>
        {failed ? (
          <div className='kh-step-err'>{String(rec?.error || part.errorText || '改写失败')}</div>
        ) : previous || query ? (
          <dl className='kh-meta'>
            {previous ? (
              <div>
                <dt>上次</dt>
                <dd>{previous}</dd>
              </div>
            ) : null}
            {query ? (
              <div>
                <dt>新检索词</dt>
                <dd>{query}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>
    </TraceItem>
  );
}

/**
 * web_search 工具调用卡：命中按域名渲染成链接磁贴，host 由 hostOf 提取。
 * 无命中或失败时保持展开，免得用户以为没搜；有命中则收起，链接正文里还有引用可点。
 */
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
  const label = pending ? '正在搜索公开信息' : failed ? '搜索失败' : '已搜索公开信息';
  const tone = pending ? 'pending' : failed ? 'failed' : count ? 'ok' : undefined;

  return (
    <TraceItem kind='web' tone={tone}>
      <details className='kh-links' open={pending || failed || !count}>
        <summary className='kh-panel-head'>
          <span className='kh-panel-type'>联网</span>
          <span className='kh-panel-title'>{label}</span>
          {query ? <span className='kh-panel-sub'>{query}</span> : null}
          {!pending && count ? <b className='kh-panel-n'>{count}</b> : null}
        </summary>
        {failed ? (
          <div className='kh-step-err'>{output?.error || part.errorText}</div>
        ) : count ? (
          <div className='kh-link-grid'>
            {output?.items.map((hit) => {
              const host = hostOf(hit.url);
              return (
                <a
                  key={hit.url}
                  className='kh-link-tile'
                  href={hit.url}
                  target='_blank'
                  rel='noreferrer'
                >
                  <span className='kh-link-fav'>{host.slice(0, 1).toUpperCase()}</span>
                  <span className='kh-link-title'>{hit.title}</span>
                  <span className='kh-link-host'>{host}</span>
                </a>
              );
            })}
          </div>
        ) : null}
      </details>
    </TraceItem>
  );
}

/** 取域名并去掉 www. 前缀；解析失败就原样返回，仅用于展示，不参与跳转 */
function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** tool input 的宽松取值：不是对象就当作空对象，省得每个调用点都写一遍类型判断 */
function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return {};
}

/** 把 web_search 的输出规整成固定结构，字段缺失时给安全默认值 */
function asWebSearchResult(value: unknown): WebSearchResult | null {
  const rec = parseToolPayload(value);
  if (!rec) return null;
  return {
    query: typeof rec.query === 'string' ? rec.query : '',
    items: Array.isArray(rec.items) ? (rec.items as WebSearchHit[]) : [],
    error: typeof rec.error === 'string' ? rec.error : undefined,
  };
}

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
