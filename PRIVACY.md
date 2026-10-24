# 自动保存版本 隐私说明

Fin-report-clipper 不提供开发者云端服务，也不收集或上传研报正文。内容脚本只运行于 BofA 研报、Markets 当日搜索入口、x.com / twitter.com 以及 mp.weixin.qq.com 的 /s 文章路径。X 仅在具体帖子或 Article URL 读取正文，图片仅从 pbs.twimg.com 下载；公众号读取页面已加载的正文、作者、日期及图片地址，仅从 mmbiz.qpic.cn / mmbiz.qlogo.cn 下载图片；来源链接仅保留文章身份参数。不会批量枚举公众号文章。

不读取 Cookie、不使用隐藏接口、不向其他服务上传内容。

扩展使用 `chrome.storage.local` 保存自动捕获开关和本机去重历史；研报键名以 `fin_report_clipper_*` 开头，X 使用独立 `auto_save_x_history`，公众号使用 `auto_save_wechat_history` 保存来源 ID 与内容哈希及相对归档路径。批量扫描草稿、未完成队列和其中的原始签名 URL 只保存在 `chrome.storage.session`，用于弹窗关闭或扩展后台休眠后的当前会话恢复；单项完成、判定重复、取消任务或退出浏览器后即删除。弹窗只能读取不含 URL 的安全状态投影。扩展不读取 ZJ-clipper 数据，也不使用浏览器同步存储。

研报文件通过 Chrome Downloads API 请求写入 `Downloads/Fin-report-clipper Backup/`；浏览器或其他下载管理扩展可能把文件留在 Downloads 根目录，后续本地归档 skill 只处理带有 Fin-report-clipper schema 的文件。页面原始 URL 和 PDF 下载 URL 可能包含用户邮箱、令牌或签名，只允许在当前未完成事务或批量会话中短暂使用；归档、Markdown、界面和错误只保留脱敏来源。研报正文明确披露的公开分析师联系方式作为来源内容保留。每次下载完成或中断后，扩展会清除对应 Chrome 下载历史；后台再次启动时会补扫固定归档目录的遗留记录，已经成功落盘的文件不会因此删除。

X / 公众号文件分别写入 `Downloads/Sky-Clipper Backup/X/` 和 `WeChat/`，成功记录保留来源 ID、内容哈希与路径；不把下载失败记为成功。

原始 HTML 不归档。HTML 正文转换为 Markdown；页面提供的 PDF 原样下载。捕获阶段不调用 AI、OCR、Obsidian、飞书或其他远程知识库。

如发现隐私或安全问题，请使用仓库的私密漏洞报告，不要在公开 Issue、PR、日志或测试样本中粘贴真实研报 URL、邮箱、令牌、签名、HTML 或 PDF。

## B站支持（0.4.2）

内容脚本仅在 `https://www.bilibili.com/video/*` 的具体BV页面读取当前视频标题与分P。后台通过 `api.bilibili.com` 获取视频元数据及当前CID字幕清单，使用浏览器正常登录会话，不读取或导出Cookie。字幕和封面只从 `aisubtitle.hdslb.com`、`i0/i1/i2.hdslb.com` 的限定路径下载；字幕签名URL只在当前读取过程中短暂使用，不写入文件或日志。

本地使用 `auto_save_bilibili_history` 保存来源ID、内容哈希和相对归档路径。文件保存到 `Sky-Clipper Backup/Bilibili/`。不会扫描评论、推荐视频或账号历史，不下载原视频，不向其他服务上传；字幕缺失或失败不登记为完整保存。
