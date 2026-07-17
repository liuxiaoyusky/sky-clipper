# Fin-report-clipper 隐私说明

Fin-report-clipper 不提供开发者云端服务，也不收集或上传研报正文。阶段 1 只在 `https://rsch.baml.com/*` 运行内容脚本。

扩展使用 `chrome.storage.local` 保存自动捕获开关和本机去重历史；键名以 `fin_report_clipper_*` 开头。扩展不读取 ZJ-clipper 数据，也不使用浏览器同步存储。

研报文件通过 Chrome Downloads API 写入 `Downloads/Fin-report-clipper Backup/`。页面原始 URL 和 PDF 下载 URL 可能包含用户邮箱、令牌或签名，只允许在当前未完成事务中短暂使用；归档、Markdown、界面和错误只保留脱敏来源。研报正文明确披露的公开分析师联系方式作为来源内容保留。每次下载完成或中断后，扩展会清除对应 Chrome 下载历史；后台再次启动时会补扫固定归档目录的遗留记录，已经成功落盘的文件不会因此删除。

原始 HTML 不归档。HTML 正文转换为 Markdown；页面提供的 PDF 原样下载。捕获阶段不调用 AI、OCR、Obsidian、飞书或其他远程知识库。

如发现隐私或安全问题，请使用仓库的私密漏洞报告，不要在公开 Issue、PR、日志或测试样本中粘贴真实研报 URL、邮箱、令牌、签名、HTML 或 PDF。
