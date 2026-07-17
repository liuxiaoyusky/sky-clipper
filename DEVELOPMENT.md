# Fin-report-clipper 开发说明

## 产品边界

阶段 1 只做 Chrome + BofA HTML 研报原始归档。任何普通网页提取、知识库发布、AI 处理、浏览器驱动或旧设置迁移都必须留在本项目之外。

## 数据流

`entrypoints/content.ts` → `bofaAdapter` → `FIN_REPORT_CLIPPER_CAPTURE` → `capture-service.ts` → `path/history` → `archive-writer.ts` → `chrome-archive-io.ts` → Downloads。

## 文件职责

- `wxt.config.ts`：Chrome 116、三项扩展权限、唯一 BofA host 和 ASCII 构建约束。
- `entrypoints/content.ts`：BofA 页面观察、自动提取、状态响应；不写文件。
- `entrypoints/background.ts`：接收捕获消息并调用单并发捕获服务。
- `entrypoints/offscreen/`：只创建和释放大文本 Blob URL。
- `entrypoints/popup/`：显示当前研报状态、自动捕获总开关、BofA 开关和固定备份位置。
- `utils/research/types.ts`：共享捕获、归档、历史和状态类型。
- `utils/research/settings.ts`：`fin_report_clipper_settings` 本地配置。
- `utils/research/privacy.ts`：BofA URL、正文链接、访问身份值和错误脱敏，并保留来源公开联系方式。
- `utils/research/hash.ts`：稳定序列化和 SHA-256。
- `utils/research/markdown.ts`：DOM 清理、复杂表格保留、Turndown 和最小 YAML。
- `utils/research/adapters/types.ts`：机构适配器接口和三次稳定性跟踪器。
- `utils/research/adapters/bofa.ts`：BofA 路由、元数据、正文、PDF anchor 和鉴权页判定。
- `utils/research/path.ts`：固定备份根目录、正文哈希目录后缀、重复/修订/部分重试规划。
- `utils/research/history.ts`：`fin_report_clipper_history` 读写。
- `utils/research/archive-writer.ts`：先写 partial Markdown 安全快照，再尝试 PDF；成功时提升 Markdown 为 complete，最后写清单。
- `utils/research/chrome-archive-io.ts`：Downloads 启动、完成监测、错误文件删除、下载历史清理和 Offscreen 生命周期。
- `utils/research/capture-service.ts`：单并发、去重、写盘和清单成功后的历史提交。
- `utils/research/messages.ts`：后台、内容脚本和 Offscreen 消息契约。
- `utils/research/observe.ts`：最多 30 次、每次 1 秒的页面稳定性轮询。
- `utils/research/status.ts`：内部状态到简短用户状态的映射。
- `tests/fixtures/bofa-report.html`：仅含假 ID、假邮箱和假令牌的脱敏 DOM 固定样本。

## 开发命令

```bash
npm run dev
npm test
npm run compile
npm run build
npm run verify
npm run zip
```

## BofA 适配器契约

- 域名必须是 `rsch.baml.com`，候选报告路径只能是 `/r` 或 `/report`。
- 来源字段是 `reportPid`、`reportTitle`、`reportSubTitle`、`reportAuthor`、`reportPublishDate`。
- 正文容器是 `[id$="_Body"]`，PDF anchor 是 `a#print_pdf_anchor[title="PDF"]`。
- `sourceId`、标题和至少 200 个正文字符必须存在；正文长度、表格数和尾部文本连续三次一致才可提取。
- 最多观察 30 次、每次间隔 1 秒；登录、验证码、拒绝访问或频率限制直接进入“需要处理”。

## 隐私规则

原始 URL 和 PDF URL 只存在于当前事务；任何测试样本必须使用假邮箱、假 token 和假报告 ID；禁止提交用户提供的原始 HTML/PDF。

## 变更门

修改适配器、路径、消息、权限或归档事务后必须运行 `npm run verify`；真实页面行为变化必须追加正常可见 Chrome 验收。

## 许可门

不修改现有 `LICENSE`。在发布 zip、Git tag 或 GitHub Release 前，实施者必须确认已经获得该许可证要求的版权方书面授权。
