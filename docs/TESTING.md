# Fin-report-clipper 捕获与保守批量验收

## 1. 自动验证

```bash
npm ci
npm run verify
```

通过条件：依赖安装不产生仓库 diff；全部 Vitest、TypeScript、Chrome build、ASCII 和 manifest 断言通过。

## 2. 构建产物

| 检查 | 通过条件 |
|---|---|
| 产品身份 | manifest name 为 `自动保存版本`，minimum Chrome 为 116 |
| 权限 | 只有 `alarms`、`downloads`、`offscreen`、`storage` |
| 站点 | 精确站点白名单见 `wxt.config.ts` 与 `scripts/check-manifest.mjs`，覆盖研报、X、公众号及B站限定来源 |
| 产品边界 | 没有 options 页、`<all_urls>`、identity、contextMenus、旧剪藏快捷键、普通剪藏或知识库入口 |
| 编码 | `content-scripts/content.js` 每个字节都不大于 127 |

## 3. 脱敏固定样本

| 场景 | 通过条件 |
|---|---|
| 标准报告 | 读取 ID、标题、副标题、多作者、发布日期、正文和 PDF anchor |
| 可选字段缺失 | YAML 不出现空 authors/published/companies/tickers |
| 复杂表格 | colspan/rowspan 使用清理后的原始 HTML 保留 |
| 披露 | 正文尾部披露仍存在 |
| 隐私 | 访问 URL query、其中的用户邮箱、token、signature 不出现在 Markdown/错误/清单；来源正文的公开分析师邮箱仍保留 |
| 稳定性 | 同一正文不同捕获时间得到相同 contentHash |

## 4. 正常可见 Chrome

| 场景 | 通过条件 |
|---|---|
| 首次打开真实 BofA 报告 | 自动创建 hash 后缀目录和 `original.md` |
| 页面提供 PDF | `original.pdf` MIME 为 `application/pdf` |
| 完成标记 | 原生 Chrome 下载保留 `.fin-report-clipper/capture.json`；外部下载管理器阻止清单时，由归档 skill 重建 |
| 再次打开相同报告 | 显示已保存/重复，不新增完整目录 |
| 用户标签页 | 捕获后仍保持打开 |
| 普通网页 | 不注入内容脚本、不下载，弹窗显示不支持 |

## 5. 异常路径

| 场景 | 通过条件 |
|---|---|
| 登录或验证页面 | 不提取，显示需要处理 |
| 30 秒内未稳定 | 不提取，显示需要处理 |
| PDF 中断或 MIME 非 PDF | 删除错误下载，保留 Markdown，清单状态 partial |
| 下载历史 | 完成、中断和后台重启补扫后均不保留带签名的 BofA 下载条目；落盘文件仍存在 |
| Markdown 写入失败 | 不写完成清单、不提交完成历史 |
| 清单写入失败 | 完整 Markdown/PDF 保留并提交完成历史；下一次打开判定重复，归档 skill 重建清单 |
| 本地历史写入失败 | 已落盘文件和清单保留，界面显示部分保存；下一次打开仍使用同一 hash 目录 |

## 6. 当前入口页批量抓取

| 场景 | 通过条件 |
|---|---|
| 扫描 | 只发现当前 DOM 中 BofA HTTPS 的 `/r`、`/report` 链接；当前研报自身、站外、PDF 和脚本链接排除，最多 20 篇 |
| 用户确认 | 扫描本身不创建标签页；只有确认后的候选进入队列 |
| 顺序执行 | 始终只有一个扩展创建的工作标签页；`saved`、`duplicate` 后才打开下一篇 |
| 保守暂停 | `partial`、登录验证、失败、工作标签页关闭或 60 秒 watchdog 到期后暂停，不自动重试 |
| 用户控制 | 暂停或结束意图即使与上一项完成同时到达，也不能打开下一篇；结束会关闭扩展创建的工作标签页 |
| 弹窗生命周期 | 关闭并重新打开弹窗后，当前 Chrome 会话的草稿和队列状态仍可见 |
| 消息竞态 | 旧 documentId、错误 tab 或重复终态消息不能推进下一任务；同一 document 的设置重启或报告 ID 延迟补全仍保留导航 token |
| 隐私 | Popup 状态、错误和测试输出中不出现入口签名 URL；完成或取消后 session 中删除原始 URL |

## B站真实验收（0.4.2）

已验证 `BV1CTJ26XE24` 当前P1：平台AI中文字幕1038条，六文件落盘齐全；MD/TXT/SRT/JSON条目一致、时间轴无重叠，封面可解码。刷新显示重复，文件哈希、大小与修改时间不变。未人工逐字听校，未下载原视频，不代表所有视频均可用。详见 [B站自动保存](BILIBILI.md)。
