# VibeGo 品牌方案

**版本：** 1.0 · **状态：** Proposed

## 1. 品牌定位

VibeGo 是一个 **local-first、remote-ready 的 Vibe Coding 工作台**：编码 Agent 在自己的开发机上运行，用户通过手机、平板或浏览器随时查看、输入和审批。

一句话定位：

> Vibe Coding，随时随地；你的工作区，始终在手边。

英文定位：

> **Vibe Coding, wherever you are.**

产品不承诺把代码搬到云端，而是把“自己的本地工作区”安全地带到远程设备。因此品牌表达要同时有速度感和信任感，避免像无边界的自动化机器人。

## 2. 名称与品牌性格

`VibeGo` = **Vibe Coding + on the go**。

四个关键词：

- **Flow**：保持上下文和事件流，不因为换设备打断思路。
- **Reach**：从任何设备连接开发机，但不把产品误解成云 IDE。
- **Trust**：审批、沙箱、审计和可恢复是体验的一部分。
- **Lightness**：启动快、资源低、界面不喧宾夺主。

品牌语气应当是：轻快、清楚、有边界。少用“全自动”“替你决定”“无限智能”，多用“连接”“继续”“查看”“确认”“安全执行”。

## 3. Logo 概念

Logo 的核心图形是一条向前的 **V 形路径**：

1. `V` 代表 **Vibe**，也是两个端点（远程设备与本地工作区）汇聚到同一个工作流。
2. 右上方的荧光绿圆点代表 **Go / signal / next step**，表示任务正在向前流动。
3. 外层的深色边界代表 workspace、sandbox 和 approval boundary；路径可以流动，但边界始终可见。

推荐使用：

- 产品标题或启动页：`vibego-logo.svg`
- 深色控制台、README 深色 Banner：`vibego-logo-dark.svg`
- App 图标、空状态、头像：`vibego-mark.svg`
- 16–64 px 浏览器图标：`vibego-favicon.svg`

不要拉伸 Logo、旋转 Logo、给路径增加渐变阴影，或把信号点替换成其他图标。小尺寸下只保留 mark，不使用完整字标。

## 4. 色彩系统

| Token | 色值 | 角色 |
| --- | --- | --- |
| `--vibego-ink` | `#0B1020` | 主背景、深色导航、代码工作台 |
| `--vibego-cyan` | `#5CE1E6` | 连接、在线、起始高光 |
| `--vibego-blue` | `#6B8CFF` | 主品牌过渡色、链接 |
| `--vibego-violet` | `#9A6BFF` | 远程、扩展、沉浸式背景 |
| `--vibego-lime` | `#B8F36C` | Go、下一步、已确认、成功信号 |
| `--vibego-surface` | `#F6F8FC` | 浅色页面背景 |
| `--vibego-text-muted` | `#5E6B85` | 次要说明、时间线元数据 |

主渐变：`#5CE1E6 → #6B8CFF → #9A6BFF`。渐变用于品牌图形、Hero 和关键 CTA，不要把整页文字全部做成渐变。

状态色应与品牌色区分：危险操作继续使用高对比红色，审批待处理使用琥珀色，禁止用荧光绿表示“未执行”。荧光绿只表示已确认、可继续或健康信号。

## 5. 字体与排版

- 英文/数字：Manrope，缺失时回退到 Inter、系统无衬线字体。
- 中文：Noto Sans SC，Windows 回退到 Microsoft YaHei。
- 代码和日志：JetBrains Mono 或系统等宽字体。
- 产品标题建议字重 750–800，正文 400–500，按钮 650–700。
- Banner 标题使用紧字距；正文和审批信息保持较宽行高，优先可读性。

CSS token 已放在 [`brand/tokens.css`](../brand/tokens.css)。

## 6. Banner 与社交图

### README / Hero

使用 [`brand/vibego-banner.svg`](../brand/vibego-banner.svg)，尺寸为 1600 × 520。它适合作为 GitHub README 顶部图或产品落地页 Hero，建议保留完整背景，不要在上面叠加第二套标题。

### Open Graph / 分享卡片

使用 [`brand/vibego-og.svg`](../brand/vibego-og.svg)，尺寸为 1200 × 630。标题和副标题已经内置，分享到聊天工具或社交平台时不依赖外部字体也能保持基本可读性。

## 7. 推荐文案

主标语：

> **Vibe Coding，随时随地。**

辅助文案：

- 连接你的本地工作区，继续未完成的思路。
- 在手机上看进度，在桌面上完成落地。
- 远程可达，执行有边界。
- Your workspace. Anywhere.
- Keep the vibe. Keep the boundary.
- Start on desktop. Continue anywhere.

按钮文案优先使用：`Connect workspace`、`Continue run`、`Review approval`、`View diff`、`Stop safely`。

## 8. 产品界面应用

- **登录/配对页：** 深色背景 + mark + “Connect your workspace”。
- **Run 列表：** 用青蓝表示连接状态，用荧光绿表示已确认/可继续，用琥珀色表示待审批。
- **审批卡片：** 保持深色边界和清晰风险摘要，不能只用绿色按钮制造“无条件通过”的感觉。
- **移动端：** mark 作为顶部识别点，标题保持短句；把“查看状态、批准、拒绝、取消”放在第一屏。
- **空状态：** 使用 mark 的 V 形路径，不要使用机器人头像或夸张的 AI 大脑意象。

## 9. 文件与导出规范

SVG 是源文件。需要位图时建议导出：

- App icon：`512 × 512` PNG
- Favicon：`32 × 32`、`64 × 64` PNG
- README banner：直接使用 SVG，或导出 `1600 × 520` PNG
- OG image：直接使用 SVG，或导出 `1200 × 630` PNG

导出时保留圆角和安全边距，透明背景版本只用于有明确背景色的产品界面；社交卡片和 README Banner 使用自带背景版本。
