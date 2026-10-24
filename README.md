# 自动保存版本

自动保存版本是一个 Chrome 原文保存扩展，支持研报、X 帖子 / Article、微信公众号公开图文及 B站平台字幕。当前版本为 **0.4.2**。它会在用户正常浏览、手动打开 BofA Global Research HTML 研报时自动识别页面，把正文忠实转换为 Markdown，并把页面提供的原始 PDF 一并保存到 Downloads。当前版本还支持由用户主动扫描当前 BofA 列表页，确认候选后用一个可见工作标签页顺序抓取，单批最多 20 篇。

## 当前能力

- 研报分类支持 BofA Global Research HTML 研报；自媒体分类支持 X、微信公众号与 B站。分类与站点开关同时开启才会自动保存。
- X 保存当前具体帖子的原文与图片，不采集回复、时间线或整串；展开前的长文和 Article 卡片不当成全文保存。图片下载失败显示“部分保存”，刷新页面可重试。视频仅保留可见封面，不下载视频。
- X 归档为 `Sky-Clipper Backup/X/<帖子或Article ID>/<正文哈希>/original.md`、`capture.json`、`images/`，同内容去重、修改保留修订。
- Article 自动保存当前加载的正文与图片，并显示“部分保存 / 全文完整性尚待核对”，不冒充完整原文。
- 公众号公开图文打开后自动保存已加载正文与图片：`Sky-Clipper Backup/WeChat/<来源ID>/<内容哈希>/`，包含 `original.md`、`capture.json`、`images/`。正文稳定且图片成功下载才记成功，失败或不支持的媒体显示“部分保存”。不自动处理验证码或付费内容。0.3.0 本地合成测试通过，实站效果待用户验收。
- 自动保存 `original.md`；页面提供 PDF 时保存 `original.pdf`。
- 研报写入 `Downloads/Fin-report-clipper Backup/`，X / 公众号写入 `Downloads/Sky-Clipper Backup/X/` / `WeChat/`。
- 按来源报告 ID 和正文 SHA-256 去重；同一报告正文变化时保留修订版。
- 捕获时不总结、不分类、不打标签、不做 OCR。
- 只扫描当前页面已经加载的 `/r`、`/report` 研报链接，不自动翻页或处理无限滚动。
- 批量抓取必须先由用户确认；并发固定为 1，部分成功、登录验证、失败或 60 秒超时会暂停队列。
- 批量任务只在当前 Chrome 会话内恢复；浏览器退出会清除尚未完成的签名链接。
- 个性化 URL 只用于完成当前下载，不写入 Markdown、归档清单、界面或日志。
- 每次写盘完成或中断后清除对应 Chrome 下载历史；后台启动时补扫固定归档目录的遗留下载记录，但绝不删除已成功落盘的文件。

B站保存当前分P的简介、封面和平台字幕（Markdown / JSON / SRT / TXT），保留时间轴并注明AI字幕；不会下载原视频或自动遍历其他分P。文件位于 `Sky-Clipper Backup/Bilibili/<BV号>-p<分P>/<内容哈希>/`。使用与验收边界见 [B站自动保存](docs/BILIBILI.md)。

## 不包含的功能

普通网页剪藏、网页高亮、Obsidian/飞书保存、外部 URL 导入、自动翻页、自动启动浏览器、PDF 文本提取、Nomura/Citi 和异步标签处理均不属于当前版本。

## 安装与开发

```bash
npm install
npm run dev
```

生产验证：

```bash
npm run verify
```

Chrome 构建产物位于 `.output/chrome-mv3`。在 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，然后选择该目录。

## 使用

1. 研报打开“研报 · 自动捕获”和“BofA Global Research”；X 打开“自媒体 · 自动保存”和对应的“X / Twitter”或“微信公众号”。关闭分类会保留站点选择。旧研报开关与历史原样保留；新站点开关默认开启；原分类关闭时仍不会自动保存。
2. 在正常、可见且已经完成所需登录的 Chrome 中打开 BofA 研报链接。
3. 等待弹窗显示“已保存”“部分保存”或“需要处理”。
4. 批量处理时，先打开已经筛选好的 BofA 列表页，点击“扫描当前 BofA 列表页”，检查候选后再点击“开始抓取”。
5. 扩展会复用一个工作标签页；可以关闭弹窗，重新打开后仍能看到当前会话的进度。“结束并关闭工作页”只关闭扩展为本批次创建的工作标签页。
6. 在 `Downloads/Fin-report-clipper Backup/` 查看归档；若浏览器或下载管理扩展忽略子目录，使用仓库内的 `archive-fin-reports` skill 按需整理 Downloads 根目录文件。

扩展不会关闭用户手动打开的标签页，也不尝试自动登录、绕过验证码或隐藏自动化行为。

## 归档结构

```text
Fin-report-clipper Backup/BofA/<year>/<date-title-id-hash>/
├── original.md
├── original.pdf                 # 页面存在 PDF 时
└── .fin-report-clipper/
    └── capture.json             # 最后写入的完成/部分完成清单
```

## 后续阶段

外部 URL 导入、机构专属入口页规则、一次性启动器、PDF.js、Nomura、Citi、标签/摘要/OCR/Obsidian 发布继续在原始捕获稳定后分阶段实现。

## 许可边界

本仓库保留现有 `LICENSE` 和版权声明。该许可证要求源码修改、衍生与再发布事先获得版权方书面授权；未确认授权时，只能进行获准的本地设计和验证，不能发布或分发安装包。

## 0.2.0 验收边界

自动测试与构建通过不代表已安装到你的 Chrome。安装/重载后首次新增站点权限需本人确认；登录由本人完成。X 依赖可见 DOM，页面结构变化或不完整时停止保存并提示。独立 Article 仅在页面 canonical 来源匹配时保存；不自动滚动、点击登录或调用私有 API。

Article 完整性边界：稳定的页面 DOM 不能证明全文已全部加载。本版自动保存已加载的原文与图片，并对 Article 显示“部分保存 / 全文完整性尚待核对”，不把它标为完整，也不写入成功去重记录。后续完整性规则需实网页面证据验证后启用；普通完整帖子保留原有 saved/duplicate 行为。
