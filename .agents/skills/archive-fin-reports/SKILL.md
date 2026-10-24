---
name: archive-fin-reports
description: 按需把 Downloads 根目录中由 Fin-report-clipper 下载的研报 Markdown 与 PDF 安全归档到固定备份目录。仅在用户明确要求“归档刚下载的研报”、整理下载原件或预览归档时使用；不用于普通网页剪藏、内容摘要、标签整理或后台监控。
---

# 按需归档研报

将浏览器已经下载成功的研报原件整理到 `~/Downloads/Fin-report-clipper Backup/`。保持原文优先，只做文件识别、配对、移动和本地清单生成。

## 安全边界

- 仅响应用户当次明确的归档请求。不要创建常驻进程、定时任务、登录项或浏览器自动化。
- 默认先预览。用户只要求检查时，不要传入 `--apply`。
- 只识别带有 `schema: fin-report-clipper/capture-v1` 的 Markdown；不要整理普通下载文件。
- 配对不唯一、PDF 来源不可信或目标目录已被其他内容占用时，停止并保留所有原文件。
- 不丢弃文件，不覆盖已有归档，不把下载来源中的签名参数、邮箱或带凭证的完整 URL 写入日志或 `capture.json`。
- 执行归档时先在目标侧复制并校验全部文件，原子提交成功后才移除 Downloads 中对应的源副本；提交前失败时源文件保持原位。
- 不改写 `original.md`。若其 `source` 字段仍含 query、fragment 或账号信息，停止归档并原地保留。
- 不在此流程中摘要、打标签或写入 Obsidian；这些属于后续可选处理。

## 操作流程

1. 解析本 Skill 所在目录，以该目录下的 `scripts/archive_downloads.py` 为唯一执行脚本。
2. 先运行预览：

   ```bash
   python3 <skill-dir>/scripts/archive_downloads.py
   ```

3. 检查 JSON 结果：
   - `ready`：已找到唯一的一组文件，可以归档。
   - `no-match`：没有完整、足够新的 Fin-report-clipper 下载。
   - `ambiguous`：存在多个同样可信的 PDF；不要猜选，向用户说明需要指定 Markdown 或清理歧义。
   - `partial`：批量任务中只有部分组可安全处理；检查 `counts` 与 `items`，歧义组仍保留在 Downloads。
   - `already-archived` / `target-exists`：不要覆盖目标。
4. 如果用户已明确要求执行归档，且预览状态为 `ready`，运行：

   ```bash
   python3 <skill-dir>/scripts/archive_downloads.py --apply
   ```

5. 确认结果为 `archived`，并检查目标内至少存在 `original.md`、所需的 `original.pdf` 和 `.fin-report-clipper/capture.json`。

## 精确指定

默认只处理最新一份完整 Markdown。需要处理较早的一份时，先列出候选文件名让用户确认，再传入 Downloads 根目录中的确切 Markdown：

```bash
python3 <skill-dir>/scripts/archive_downloads.py --markdown '<exact-file.md>'
python3 <skill-dir>/scripts/archive_downloads.py --markdown '<exact-file.md>' --apply
```

不要用 `--markdown` 绕过 PDF 歧义保护。测试或特殊下载目录可使用 `--downloads-dir` 与 `--archive-root`；真实归档保持默认路径。

## 按本地日期批量归档

只处理本机今天捕获的全部 BofA 完整研报，先预览：

```bash
python3 <skill-dir>/scripts/archive_downloads.py --today
```

处理指定本地日期，使用 `YYYY-MM-DD`：

```bash
python3 <skill-dir>/scripts/archive_downloads.py --date 2026-07-21
```

日期以 Markdown 的 `captured` 时间转换到本机时区后判断，不以文件名或文件修改日期猜测；目标目录中的日期也使用同一套本地日期语义。批量 JSON 包含 `scope`、`total`、`counts` 和逐组 `items`。

只有用户明确要求正式归档时才追加 `--apply`：

```bash
python3 <skill-dir>/scripts/archive_downloads.py --today --apply
```

批量应用会先为全部候选建立计划并检查交叉冲突，再逐组执行原有的复制、哈希校验和原子提交。同一个 PDF、阶段 Markdown 或目标目录被多组认领时，相关组都标记为 `ambiguous`，不移动相关源文件；PDF 竞争检查还会考虑 Downloads 中其他本地日期的完整研报，避免午夜附近误拿相邻日期的原件。其他互不相关且可安全配对的组仍可完成归档。只要存在 `no-match`、`ambiguous` 或 `error`，整体状态为 `partial` 并返回非零退出码，必须向用户逐项说明，不能把它描述为全部成功。

## 归档结果

当前 BofA 目录格式为：

```text
Fin-report-clipper Backup/BofA/<year>/<capture-date>-<title>-<source-id>-<hash>/
├── original.md
├── original.pdf
└── .fin-report-clipper/
    ├── capture.json
    └── staging-partial.md  # 仅在唯一匹配到下载阶段副本时保留
```

`capture.json` 只记录清洗后的研报元数据、归档文件及哈希，不记录带凭证的下载 URL。
