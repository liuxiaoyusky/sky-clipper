# Fin-report-clipper 研报自动化设计

**状态：** 书面审阅稿；对话中的设计已经确认

**日期：** 2026-07-17

**首个实施目标：** 仅阶段 1

## 1. 概述

Fin-report-clipper 将现有浏览器剪藏器扩展为两条相互独立的工作流：

1. **普通网页手动剪藏**：保留现有的预览、编辑和保存流程，也保留目前可选的 Obsidian URI 与 Local REST API 保存目标。
2. **研报自动捕获**：识别白名单内的金融研报页面，将 HTML 正文忠实转换为 Markdown，并原样保存可用的 PDF；本地归档始终写入浏览器的 Downloads 目录。

研报工作流坚持捕获优先。捕获时不总结、不分类、不打标签，也不发布到 Obsidian。上述处理均交给可选的异步处理器，在原始文件安全落盘后单独执行。

首个支持的机构是 BofA Global Research。取得真实样本后，再分别增加 Nomura 和 Citi 的独立站点适配器。

## 2. 目标

- 将产品改名为 **Fin-report-clipper**。
- 在正常、可见的 Chrome 或 Edge 会话中自动识别支持的研报内容页。
- 将 HTML 研报忠实转换为 Markdown，并在存在原始 PDF 时一并保存。
- 接受外部直接传入的 URL，也能从获准的入口页面中发现研报链接。
- 以保守方式顺序处理研报任务。
- 始终将研报归档保存在 `Downloads/Fin-report-clipper Backup/`。
- 使用来源报告 ID 和正文哈希值去重，同时保留机构修订过的报告版本。
- 允许元数据缺失，也允许机构特有字段，不强迫所有研报套用单一股票研报模板。
- 保持原始捕获不可变；标签、标准化、摘要和 Obsidian 发布都由异步处理器完成。
- 改名期间完整保留现有普通剪藏与 Obsidian 功能。

## 3. 不在当前范围内的功能

首期不包括：

- 扫描邮箱或邮件账户。
- 捕获阶段的 AI 摘要、自动分类或自动标签。
- 自动把研报捕获结果发布到 Obsidian。
- 捕获事务中的 OCR。
- 无限翻页、整站爬取或在未获准入口页之外发现链接。
- 无头浏览器、Playwright 页面操控、隐身插件、指纹伪装或验证码绕过。
- 自动登录、绕过访问控制，或在收到 403/429 后持续重试。
- 登录启动项、常驻守护进程或必装的本地文件服务。
- 承诺自动导航不会被网站识别。

## 4. 产品命名与兼容性

面向用户的名称如下：

- 产品与浏览器扩展：`Fin-report-clipper`
- npm 包与 CLI：`fin-report-clipper`
- 发布包：`fin-report-clipper-<browser>.zip`
- 研报备份根目录：`Fin-report-clipper Backup`

改名不能破坏现有用户数据。当前的普通剪藏设置、仓库配置、REST 凭证和网页高亮必须继续可读。

阶段 1 不大规模重命名所有内部标识，以免引入无必要的迁移风险。现有 `zhaoji_clipper_*` 存储记录和兼容的 DOM 标记继续可读；新的研报专用记录使用 `fin_report_clipper_research_*` 前缀。未来可以把旧记录复制到新键，但首版不删除旧记录。

## 5. 架构决策

选定的总体架构是：**浏览器扩展主导捕获，一次性启动器作为可选辅助。**

```text
正常、可见的 Chrome/Edge
        |
        v
Fin-report-clipper 扩展
        |
        +-- 研报内容页识别
        +-- 入口页链接发现
        +-- 持久化 URL 队列
        +-- 机构专属适配器
        +-- PDF 保存与提取
        +-- Downloads 归档写入器

可选的一次性 CLI
        |
        +-- 打开正常浏览器
        +-- 把外部 URL 交给扩展队列
        +-- 交接完成后退出
```

所有页面内识别和提取都由扩展负责，避免手动剪藏和自动捕获逐渐演变为两套不同的解析实现。

启动器不使用 WebDriver，也不启动无头浏览器。单个 URL 直接交给操作系统用正常浏览器打开；批量 URL 可以通过一个带一次性令牌的临时本机回环页面交给扩展，收到扩展的导入确认后立即退出。它不安装登录启动项，也不留下持续监听的本地服务。

## 6. 研报站点适配器边界

每家机构实现一个物理隔离的适配器：

```ts
interface ResearchSiteAdapter {
  id: string;

  classifyPage(): Promise<
    | 'report-html'
    | 'report-pdf'
    | 'entry-page'
    | 'auth-required'
    | 'unsupported'
  >;

  isPageReady(): Promise<boolean>;
  discoverLinks(): Promise<DiscoveredLink[]>;
  extractOriginal(): Promise<CapturedDocument>;
  findOriginalPdf(): Promise<string | null>;
  getSourceId(): Promise<string | null>;
  canonicalizeUrl(url: string): CanonicalResearchUrl;
}
```

页面选择器、URL 规则、报告 ID、加载完成条件、披露边界和 PDF 链接发现均留在对应机构的适配器中。只有跨机构稳定成立的能力才进入共享模块。

用户提供的 BofA 本地 HTML 样本已经证明：报告页包含完整 HTML 正文、稳定元数据字段、大量段落与表格，并提供独立 PDF 操作。原始样本包含个性化访问参数和第三方扩展注入内容，因此不能直接提交到仓库；实施时必须先生成脱敏测试样本。

## 7. 原始内容优先文档模型

捕获模型允许字段缺失，也允许机构特有字段：

```ts
type MetadataValue = string | number | boolean | string[] | number[];

interface CapturedDocument {
  schema: 'fin-report-clipper/capture-v1';

  provider: string;
  sourceType: 'html' | 'pdf' | 'html+pdf';
  sourceId?: string;
  title?: string;
  publishedAt?: string;

  observedMetadata: Record<string, MetadataValue>;

  originalMarkdown?: string;
  originalPdf?: Blob;
  assets: CapturedAsset[];

  sanitizedSource: string;
  capturedAt: string;
  contentHash: string;
  captureStatus: 'complete' | 'partial';
}
```

规则如下：

- 只写入来源页面明确提供的数据。
- 缺失值直接省略，不输出空字符串。
- 作者、公司、证券和 Ticker 在存在时使用数组。
- 一份报告可以没有 Ticker，也可以有一个或多个 Ticker。
- 宏观、主题、策略和多公司报告不需要满足股票研报专属数据结构。
- 机构特有数据保留在 `observedMetadata`，不丢弃，也不强行猜测成通用字段。
- 捕获模型不包含自动生成的标签、情绪、评级观点或摘要。

## 8. 原始 Markdown

生成 `original.md` 时，只写入最小且有来源依据的 YAML 属性区：

```markdown
---
schema: fin-report-clipper/capture-v1
provider: BofA Global Research
source_id: "provider-report-id"
source_type: html+pdf
captured: 2026-07-17T16:30:00+09:00
capture_status: complete
content_hash: sha256:...
---

# 原始研报标题

忠实转换的研报正文……
```

`published`、`authors`、`companies` 和 `tickers` 等字段，仅在来源明确提供时出现。

正文尽量保留原始顺序、标题、段落、表格、披露、链接和可用图片。捕获层不改写论证、不缩短报告，也不插入解释性内容。

## 9. 归档目录

研报捕获始终写入浏览器 Downloads 下的相对路径：

```text
Downloads/
└── Fin-report-clipper Backup/
    └── BofA/
        └── 2026/
            └── 2026-07-17-report-title-short-id/
                ├── original.md
                ├── original.pdf
                ├── assets/
                ├── derived/
                └── .fin-report-clipper/
                    └── capture.json
```

文件规则：

- HTML 报告始终尝试生成 `original.md`；纯 PDF 报告只有在能可靠提取文本时才生成该文件。
- 机构提供可下载 PDF 时写入 `original.pdf`。
- 能可靠保存的图片进入 `assets/`。
- `derived/` 专供可选异步处理结果使用。
- `.fin-report-clipper/capture.json` 保存来源元数据、适配器版本、校验值、警告和文件清单。
- 默认不归档未经脱敏的完整网页 HTML，因为其中可能包含个性化 URL、其他扩展注入内容和可执行站点脚本。

`capture.json` 最后写入，作为整个归档完成的确认标记。没有完整归档清单的目录可以恢复，但不能被视为已经完整保存。

浏览器 Downloads API 只能写入 Downloads 根目录之下；默认相对备份根目录是 `Fin-report-clipper Backup/`。

## 10. URL 隐私与规范化

系统必须区分“打开未完成任务所需的原始 URL”和“可以安全归档的来源身份”。

- 原始 URL 只保存在本机未完成任务记录中。
- 导出的 Markdown、归档清单、日志和界面移除邮箱、访问令牌、签名及不必要的查询参数。
- 任务完成后删除原始 URL，只保留机构、来源 ID、脱敏域名/路径和正文哈希值。
- 每个机构的适配器明确列出允许保留的安全且必要的查询参数。
- 错误信息不显示完整原始 URL。

## 11. 去重与修订版

去重分三层执行：

1. **打开前**：使用规范化链接键检查等待队列和完成历史。
2. **页面就绪后**：优先读取机构提供的稳定报告 ID。
3. **提取完成后**：对规范化后的原始 Markdown 计算 SHA-256。

身份判定优先级如下：

1. 机构 + 稳定报告/文档 ID。
2. 机构 PDF/Document ID。
3. 机构 + 规范化标题 + 发布日期 + 来源明确提供的作者。
4. 规范化 Markdown 正文哈希值。

来源 ID 与正文哈希值都相同时，任务属于重复项，不再次下载。同一个来源 ID 对应新的正文哈希值时，视为机构修订版本，保留新版本而不覆盖旧归档。

## 12. 页面识别与任务状态机

扩展只观察已经在研报白名单中明确启用的机构域名。

```text
observing
  -> unsupported
  -> auth-paused
  -> discovering（入口页）
  -> waiting-ready（研报内容页）

queued -> opening -> waiting-ready -> extracting -> saving
       -> duplicate
       -> completed
       -> partial
       -> paused-auth
       -> failed
```

页面加载完成不依赖单一固定等待时间，而使用适配器证据：

- 报告标题或稳定来源 ID 已经出现。
- 预期正文容器已经出现。
- 正文长度在连续观察中保持稳定。
- PDF 链接已经出现，或者适配器确认该报告没有 PDF。
- 当前页面不是登录、拒绝访问、验证码或临时错误页面。

持久化队列保存在 `chrome.storage.local`。浏览器在中间状态退出时，`opening`、`waiting-ready`、`extracting` 和 `saving` 任务在恢复后退回 `queued`。

任务完成、判定重复或被用户明确丢弃后，删除其中的原始 URL。

## 13. URL 输入方式

### 13.1 外部 URL 直接导入

研报任务面板接受一个或多个粘贴 URL，完成机构识别、规范化和去重后，将支持的 URL 加入队列。

### 13.2 入口页面发现

获准的入口页面可以提供当前已经加载在 DOM 中的研报链接。

首期边界：

- 只发现符合已启用机构规则的链接。
- 不抓取同站内其他任意链接。
- 不自动翻页，也不自动处理无限滚动。
- 默认每次最多加入 20 份新报告。
- 必须存在明确注册的入口页规则，或由用户主动点击扫描当前页面。

只有真实入口页样本证明分页不可避免时，才为对应机构单独增加分页能力。

## 14. 保守执行与机器人识别边界

一次性启动器使用普通、可见的浏览器，不使用 WebDriver、Playwright 页面控制、无头模式、CDP 注入或隐身工具，因此不会主动引入典型的自动化浏览器标记。

但这并不意味着整个流程不可识别。研报网站仍然可能通过访问频率、重复导航、下载数量、会话变化或账户策略信号发现异常行为。

因此产品强制使用保守默认值：

- 并发始终为 1。
- 一份报告完整保存后才打开下一份。
- 默认单次最多处理 20 份新报告。
- 普通临时错误最多重试一次。
- 登录页面、验证码、403 和 429 会暂停整个队列，等待人工处理。
- 自动打开的标签页可以在确认保存后关闭。
- 用户手动打开的标签页绝不由自动化关闭。
- 不加入为了模仿人类而设计的随机操作。
- 不尝试绕过访问控制或验证码。

产品必须将该能力准确描述为“保守浏览器自动化”，不能宣传为“不会被识别的自动化”。

## 15. PDF 处理

PDF 同样遵循原始内容优先原则：

1. 一旦获得原始 PDF，先保存文件。
2. 文本提取作为后续步骤单独尝试。

对于文本型 PDF，扩展使用基于 PDF.js 的离屏任务生成按页排序的 Markdown，并明确保留页码边界。证据不足时，不猜测标题层级或表格结构。

对于扫描版或难以提取的 PDF，保留原始 PDF，并把捕获标记为 `partial`。OCR 是可选异步处理器，不属于捕获事务。

直接 PDF URL 和内嵌 PDF 阅读器需要机构专属 URL 识别，因为浏览器内置 PDF 阅读器不是可靠的内容脚本执行面。

## 16. 异步处理器契约

标签、标准化、摘要或 Obsidian 发布都不能阻塞捕获成功。

可选处理器读取原始归档，只写入 `derived/` 或用户明确选择的下游目标。

```ts
interface ProcessingJob {
  documentPath: string;
  inputHash: string;
  processor: string;
  processorVersion: string;
}

interface ProcessingResult {
  inputHash: string;
  processor: string;
  status: 'completed' | 'failed' | 'skipped';
  outputFiles: string[];
  generatedAt: string;
  error?: string;
}
```

候选处理器包括：

- 研报标签生成。
- 元数据标准化。
- 研究笔记生成。
- OCR 与表格恢复。
- 将整理后的工作副本发布到 Obsidian。

默认规则是：处理器不修改 `original.md` 或 `original.pdf`。

## 17. 用户界面

现有扩展弹窗继续承载普通网页手动剪藏流程。

新增独立的研报任务面板，提供：

- 研报自动捕获总开关。
- 每家机构的独立开关。
- 多行外部 URL 导入。
- 扫描当前入口页面。
- 暂停/恢复队列。
- 等待、处理中、已保存、部分保存和需要处理的数量。
- 单条任务重试与打开归档操作。
- 脱敏错误详情和适配器版本。

面向用户只显示三种简单状态：

- **已保存**：原始归档完整。
- **部分保存**：至少保留了一个原始文件，但 Markdown 或资源不完整。
- **需要处理**：登录、验证码、访问限制或存储失败，需要用户介入。

内部队列状态不作为面向用户的产品术语。

## 18. 错误处理

| 情况 | 行为 |
|---|---|
| 登录过期或出现验证码 | 暂停整个队列，等待用户处理 |
| HTTP 403 或 429 | 暂停且不自动重试 |
| 临时页面/网络错误 | 当前任务最多重试一次 |
| HTML 提取失败但存在 PDF | 保存 PDF，并标记为部分保存 |
| PDF 文本提取失败 | 保留 PDF，并标记为部分保存 |
| 下载中断 | 任务保持可恢复，不写入完整归档清单 |
| 完全重复 | 记录为重复项，不再次下载 |
| 同一来源 ID 的内容发生变化 | 保存为修订版 |

## 19. 实施阶段

### 阶段 1：改名、捕获基础与 BofA HTML

- 面向用户改名为 Fin-report-clipper。
- 保留普通网页剪藏和现有 Obsidian 行为。
- 增加研报类型、BofA 适配器、脱敏 URL 身份、正文哈希值和 Downloads 归档写入器。
- 自动识别用户手动打开的 BofA HTML 研报。
- 保存忠实的 `original.md` 和页面暴露的 PDF。
- 使用脱敏本地测试样本和真实登录浏览器会话验证。

### 阶段 2：任务队列与入口页发现

- 持久化任务队列。
- 批量外部 URL 导入。
- 获准入口页链接发现。
- 顺序管理标签页生命周期。
- 暂停、恢复、异常恢复和任务面板。

### 阶段 3：一次性启动器

- `fin-report-clipper run <url>`。
- `fin-report-clipper run <file>`。
- 启动正常、可见的 Chrome/Edge，并临时交接 URL。
- 不安装守护进程、登录启动项或浏览器驱动框架。

### 阶段 4：PDF 提取

- 使用 PDF.js 离屏任务提取文本型 PDF。
- 保留页码边界与部分成功状态。
- 扫描版 PDF 只保存原文件，不同步执行 OCR。

### 阶段 5：Nomura 与 Citi

- 每家机构各自实现独立适配器。
- 开发前必须取得真实 HTML、PDF 和入口页样本。
- 每家机构分别执行真实浏览器验收。

### 阶段 6：可选异步处理器

- 标签生成。
- 元数据标准化。
- 研究笔记生成。
- OCR/表格恢复。
- Obsidian 发布。

每个阶段都有独立实施计划和验证门槛。首个实施计划只覆盖阶段 1。

## 20. 验证策略

### 20.1 单元测试与固定样本测试

- 敏感查询参数移除与安全 URL 规范化。
- 缺失元数据不输出空字段。
- 多作者、多公司和多 Ticker。
- 稳定目录命名。
- 来源 ID 与正文哈希值去重。
- 修订版保存行为。
- 队列状态转换与恢复。
- 所需下载全部完成后才写入归档清单。
- 使用脱敏 BofA 固定样本验证提取结果。

### 20.2 浏览器集成测试

- 手动打开支持的 BofA 研报并完成一次捕获。
- 再次打开同一报告，识别为重复项且不生成新文件。
- 保存同一来源 ID 的更新版本，不覆盖旧版本。
- 确认导出文件和界面不包含个性化 URL 参数。
- 确认用户手动打开的标签页保持打开。
- 确认登录页、403 和 429 会暂停队列。
- 确认浏览器重启后能恢复未完成任务。
- 在 Chrome 与 Edge 中确认备份路径和文件名。

### 20.3 PDF 测试

- 文本型 PDF 同时生成原始 PDF 和按页 Markdown。
- 扫描版 PDF 保留原文件并报告部分成功。
- PDF 文本提取失败不删除或破坏原始 PDF。

### 20.4 旧功能回归

- 现有普通网页通用剪藏继续工作。
- 现有站点适配器继续工作。
- 现有 Obsidian URI 与 Local REST API 手动保存继续工作。
- 现有设置、仓库档、密钥和高亮继续可读。
- TypeScript 编译以及 Chrome/Edge 生产构建通过。
- 生成的内容脚本继续满足纯 ASCII 约束。

## 21. 阶段 1 验收标准

阶段 1 只有在以下条件全部满足后才算完成：

1. 扩展显示 Fin-report-clipper 名称，且现有手动剪藏设置没有丢失。
2. 只在满足已批准页面契约的 BofA HTML 研报上触发自动识别。
3. `original.md` 忠实保留报告结构和来源明确提供的元数据，不生成标签或摘要。
4. 页面存在原始 PDF 时，PDF 与 Markdown 一起下载。
5. 归档创建在 `Downloads/Fin-report-clipper Backup/` 下。
6. 敏感 URL 参数不出现在导出文件、界面或错误日志中。
7. 再次打开同一报告不会创建重复归档。
8. 同一个来源 ID 的内容发生变化时，保存为修订版。
9. 现有普通剪藏和手动 Obsidian 保存通过回归测试。
10. Chrome/Edge 生产构建和针对性的真实浏览器验收通过。
