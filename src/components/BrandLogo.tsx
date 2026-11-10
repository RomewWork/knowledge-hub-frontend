/**
 * 品牌标：中心节点向外辐射的 SVG，纯展示组件、无副作用。
 * 关键交互：只接受 size，由调用方按场景传值（导航栏、登录页各用一个尺寸）。
 * 坑 1：根节点带 aria-hidden，放在按钮里时无障碍名称要由外层提供；
 * 坑 2：display:block 加 flexShrink:0，避免在 flex 行内被压扁或出现基线空隙。
 */
/** Knowledge Hub 品牌标：中心节点向外辐射，表示知识汇聚 */
export function BrandLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      style={{ display: 'block', flexShrink: 0 }}
    >
      <rect width="32" height="32" rx="8" fill="#1677ff" />
      <path
        d="M16 12.6V8.6M19.1 17.8l3.9 2.2M12.9 17.8L9 20"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="3.4" fill="#fff" />
      <circle cx="16" cy="7.2" r="2" fill="#69b1ff" />
      <circle cx="24.8" cy="21.2" r="2" fill="#69b1ff" />
      <circle cx="7.2" cy="21.2" r="2" fill="#69b1ff" />
      <circle cx="16" cy="7.2" r="1.15" fill="#fff" />
      <circle cx="24.8" cy="21.2" r="1.15" fill="#fff" />
      <circle cx="7.2" cy="21.2" r="1.15" fill="#fff" />
    </svg>
  )
}
