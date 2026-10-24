# B站自动保存（0.4.2）

开启「自媒体 · 自动保存」和「B站 / Bilibili」，在正常登录的Chrome中打开具体BV视频页。标题与当前分P稳定后，插件保存简介、封面和可用的平台字幕。无需手动导出。

## 保存内容

目录：`Sky-Clipper Backup/Bilibili/<BV号>-p<分P>/<内容哈希>/`。

- `original.md`：作者、日期、来源、简介、本地封面引用、带时间轴的字幕。
- `subtitles.json`、`subtitles.srt`、`transcript.txt`：有效平台字幕；保留原词，自动字幕明确标注。
- `capture.json`、`images/cover.*`：来源范围、完整性状态、警告与封面。

原视频仅保留播放链接。本版不下载原视频、不遍历其他分P、不采集评论或推荐视频。字幕缺失、错误CID、来源不匹配或下载失败不会冒充完整文字稿；不自动循环重试。改正问题后刷新可重试，已完整保存且内容相同则去重；内容变化另存修订。

## 升级

执行 `npm ci` 与 `npm run build` 后，在Chrome扩展管理页加载 `.output/chrome-mv3`。已有实例应备份并更新原加载目录后重新加载，保留ID和设置；不要卸载原扩展。新增域权限需由使用者确认。

新增精确HTTPS域为 `www.bilibili.com`、`api.bilibili.com`、`aisubtitle.hdslb.com`、`i0/i1/i2.hdslb.com`，不新增cookies或debugger权限。登录和平台访问限制按正常浏览器流程处理，不绕过。

## 验证范围

2026-10-24：240项Vitest、17项Python、类型检查、构建与manifest/ASCII检查通过。真实样本 `BV1CTJ26XE24` P1成功保存六文件及1038条中文AI字幕，时间范围0.08–1841.98秒，无时间轴重叠；刷新后未重复下载或改写文件。

0.4.1的实测在SRT阶段出现文件名不匹配；0.4.2改用 `application/x-subrip` 后同一视频落盘及去重通过。字幕仍未人工逐字听校；平台字幕覆盖范围不等于语音逐字无遗漏，该单例不证明其他视频或分P均可用。
