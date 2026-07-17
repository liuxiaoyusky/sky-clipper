# Fin-report-clipper

Fin-report-clipper 是一个 Chrome 研报归档扩展。阶段 1 会在用户正常浏览、手动打开 BofA Global Research HTML 研报时自动识别页面，把正文忠实转换为 Markdown，并把页面提供的原始 PDF 一并保存到 Downloads。

## 阶段 1 能力

- 只支持 BofA Global Research HTML 研报。
- 自动保存 `original.md`；页面提供 PDF 时保存 `original.pdf`。
- 固定写入 `Downloads/Fin-report-clipper Backup/`。
- 按来源报告 ID 和正文 SHA-256 去重；同一报告正文变化时保留修订版。
- 捕获时不总结、不分类、不打标签、不做 OCR。
- 个性化 URL 只用于完成当前下载，不写入 Markdown、归档清单、界面或日志。
- 每次写盘完成或中断后清除对应 Chrome 下载历史；后台启动时补扫固定归档目录的遗留下载记录，但绝不删除已成功落盘的文件。

## 不包含的功能

普通网页剪藏、网页高亮、Obsidian/飞书保存、外部 URL 队列、入口页发现、自动启动浏览器、PDF 文本提取、Nomura/Citi 和异步标签处理均不属于阶段 1。

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

1. 保持扩展弹窗中的“自动捕获”和“BofA Global Research”开关开启。
2. 在正常、可见且已经完成所需登录的 Chrome 中打开 BofA 研报链接。
3. 等待弹窗显示“已保存”“部分保存”或“需要处理”。
4. 在 `Downloads/Fin-report-clipper Backup/` 查看归档。

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

任务队列、外部 URL、入口页发现、一次性启动器、PDF.js、Nomura、Citi、标签/摘要/OCR/Obsidian 发布都在原始捕获稳定后分阶段实现。

## 许可边界

本仓库保留现有 `LICENSE` 和版权声明。该许可证要求源码修改、衍生与再发布事先获得版权方书面授权；未确认授权时，只能进行获准的本地设计和验证，不能发布或分发安装包。
