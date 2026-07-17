# Fin-report-clipper 阶段 1 验收

## 1. 自动验证

```bash
npm ci
npm run verify
```

通过条件：依赖安装不产生仓库 diff；全部 Vitest、TypeScript、Chrome build、ASCII 和 manifest 断言通过。

## 2. 构建产物

| 检查 | 通过条件 |
|---|---|
| 产品身份 | manifest name 为 `Fin-report-clipper`，minimum Chrome 为 116 |
| 权限 | 只有 `downloads`、`offscreen`、`storage` |
| 站点 | host permission 和 content script match 都只有 `https://rsch.baml.com/*` |
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
| 完成标记 | `.fin-report-clipper/capture.json` 存在且状态 complete |
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
| 清单写入失败 | 不提交完成历史；下一次打开可用同一 hash 目录重试 |
| 本地历史写入失败 | 已落盘文件和清单保留，界面显示部分保存；下一次打开仍使用同一 hash 目录 |
