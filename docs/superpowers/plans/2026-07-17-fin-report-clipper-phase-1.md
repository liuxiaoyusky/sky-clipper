# Fin-report-clipper 阶段 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前 ZJ-clipper 代码库改造成独立、Chrome 优先、只面向研报的 Fin-report-clipper，并在用户手动打开受支持的 BofA HTML 研报后，自动把忠实 Markdown 和页面提供的 PDF 保存到固定 Downloads 归档目录。

**Architecture:** 内容脚本只注入 `https://rsch.baml.com/*`，BofA 适配器负责页面判定、稳定性证据、脱敏和正文提取；后台服务工作线程串行执行去重、修订判定和归档事务。大体积 Markdown 通过 Chrome Offscreen Document 生成 Blob URL，再交给 Downloads API 写入 Downloads；PDF 使用页面原始下载 URL，但该 URL 只在未完成事务内短暂存在，永不进入 Markdown、归档清单、界面或日志。

**Tech Stack:** WXT 0.19、Manifest V3、Chrome 116+、React 18、TypeScript 5.7、Turndown + GFM、Vitest + jsdom、`chrome.downloads`、`chrome.offscreen`、`chrome.storage.local`。

**设计依据:** [Fin-report-clipper 研报自动化设计](../specs/2026-07-17-fin-report-clipper-research-automation-design.md)

## Global Constraints

- 产品与浏览器扩展的精确名称是 `Fin-report-clipper`；npm 包名是 `fin-report-clipper`；固定发布别名是 `fin-report-clipper-chrome.zip`。
- 研报备份根目录固定为 `Downloads/Fin-report-clipper Backup/`，扩展只能写 Downloads 根目录之下的相对路径。
- 阶段 1 只发布和验收 Chrome；Edge、Firefox 和其他浏览器不在范围内。
- 阶段 1 只支持用户手动打开的 BofA HTML 研报，以及该页面明确暴露的原始 PDF 下载链接。
- 普通网页手动剪藏、选区剪藏、网页高亮、通用提取器、Obsidian、飞书、旧设置迁移和非研报站点适配器都不属于 Fin-report-clipper。
- 不复用 ZJ-clipper 的名称、logo、扩展图标或社交预览；阶段 1 使用文字产品名和 Chrome 默认图标，新品牌视觉另行设计。
- Fin-report-clipper 只使用 `fin_report_clipper_*` 存储键，不读取、不迁移、不覆盖 `zhaoji_clipper_*` 或 `jicun_*` 数据。
- 捕获层只保存来源内容；不总结、不分类、不生成标签、不做 OCR，也不在扩展中发布到 Obsidian。
- 原始 HTML 页面不作为文件归档；HTML 正文忠实转换为 `original.md`，机构 PDF 原文件保存为 `original.pdf`。
- 原始 URL 仅允许存在于未完成捕获事务中；访问链接携带的用户邮箱、令牌、签名和不必要查询参数不得出现在输出、界面、错误或日志中。研报正文明确提供的公开联系方式属于来源内容，不做无差别删除。
- 捕获并发固定为 1；用户手动打开的标签页绝不由扩展关闭。
- 不使用无头浏览器、WebDriver、Playwright 页面控制、CDP 注入、隐身插件、指纹伪装或验证码绕过。
- 阶段 1 不实现外部 URL 批量导入、入口页发现、持久化任务队列、一次性启动器、PDF 文本提取、Nomura/Citi 适配器或异步处理器。
- 用户提供的 BofA 原始 HTML 含个性化参数和第三方注入，绝不复制进仓库；测试只使用人工缩减并完全脱敏的固定样本。
- 内容脚本构建产物必须保持纯 ASCII；正则字面量只使用 ASCII，中文文案交给 esbuild 转义。
- 当前 `LICENSE` 明确限制源码修改、衍生和再发布；除非版权方已经书面授权，否则只允许完成本地设计/验证，不能发布或分发 Fin-report-clipper 安装包，并且实施不得擅自改写 `LICENSE`。
- Task 1–8 的提交只是本地可回退检查点，期间新旧入口可能短暂不一致；只允许本地测试/构建，不得作为可用版本交给最终用户或发布。只有 Task 9 的全部自动验证和真实 Chrome 验收通过后才形成候选版本。

## 实施边界与已确定假设

- 这是独立产品的首个可验证版本，`package.json` 版本重置为 `0.1.0`；ZJ-clipper 的历史仍由其原项目维护。
- 阶段 1 的内联图片只保留经过脱敏的远程引用，不下载到 `assets/`；后续取得更多真实图片样本后再扩展资源归档。
- BofA 报告正文容器使用样本已验证的 `[id$="_Body"]`，元数据优先读取 `reportPid`、`reportTitle`、`reportSubTitle`、`reportAuthor`、`reportPublishDate`。
- BofA PDF 使用样本已验证的 `a#print_pdf_anchor[title="PDF"]`；Downloads API 的 HTTP(S) 请求会使用该主机现有 Cookie。
- `contentHash` 对“来源明确元数据 + 规范化正文 Markdown”计算，不包含 `capturedAt`，从而避免捕获时间造成假修订，也避免把哈希写入自身后形成循环。
- 每个归档目录都包含正文哈希前 16 位；即使扩展本地历史丢失，不同正文版本发生路径碰撞的概率也足够低。完整 SHA-256 仍写入 Markdown、清单和本地历史。
- Chrome 最低版本固定为 116：Offscreen API 自 Chrome 109 可用，而本实现使用 Chrome 116 的 `runtime.getContexts()` 管理唯一离屏文档。

## 官方实现依据

- [Chrome Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)：`filename` 必须是 Downloads 下的相对路径；HTTP(S) 下载自动携带目标主机已有 Cookie；通过 `onChanged` 观察完成或中断；`erase()` 只清除浏览器下载历史而不删除已经落盘的文件。
- [Chrome Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)：使用 `offscreen` 权限和 `BLOBS` 原因在隐藏扩展页面中调用 `URL.createObjectURL()`。
- [WXT Entrypoints](https://wxt.dev/guide/essentials/entrypoints)：`entrypoints/offscreen/index.html` 作为未列入 manifest 的扩展页面构建为 `/offscreen.html`。

## 文件结构冻结

| 文件 | 操作 | 单一职责 |
|---|---|---|
| `package.json`, `package-lock.json` | 修改 | 独立包名、Chrome-only 命令、Vitest 依赖 |
| `wxt.config.ts` | 修改 | Fin-report-clipper manifest、最小权限、BofA host 权限 |
| `vitest.config.ts` | 新建 | `@` 别名与 jsdom 测试环境 |
| `tests/setup.ts` | 新建 | 为 jsdom 测试提供 Web Crypto |
| `utils/research/types.ts` | 新建 | 捕获、适配器、消息、状态、历史的共享类型 |
| `utils/research/settings.ts` | 新建 | 独立本地设置键与默认值 |
| `utils/research/privacy.ts` | 新建 | BofA URL 规范化、正文链接脱敏、错误脱敏 |
| `utils/research/hash.ts` | 新建 | 稳定 JSON 与 SHA-256 |
| `utils/research/markdown.ts` | 新建 | 研报专用 HTML 清理、Turndown 转换、最小 YAML |
| `utils/research/adapters/types.ts` | 新建 | 机构适配器接口与稳定性跟踪器 |
| `utils/research/adapters/bofa.ts` | 新建 | BofA 页面判定、字段读取、正文与 PDF 发现 |
| `utils/research/path.ts` | 新建 | 固定归档根目录与安全相对路径 |
| `utils/research/history.ts` | 新建 | 去重、修订和部分捕获重试历史 |
| `utils/research/archive-writer.ts` | 新建 | Markdown 安全快照、PDF、最终状态和最后清单的事务顺序 |
| `utils/research/chrome-archive-io.ts` | 新建 | Offscreen Blob 与 Downloads API 的 Chrome 实现 |
| `utils/research/capture-service.ts` | 新建 | 串行捕获、去重、写盘、历史提交 |
| `utils/research/messages.ts` | 新建 | 消息类型守卫 |
| `utils/research/observe.ts` | 新建 | 有界页面稳定性轮询 |
| `utils/research/status.ts` | 新建 | 内部状态到用户状态的映射 |
| `entrypoints/offscreen/index.html`, `main.ts` | 新建 | Blob URL 创建与释放 |
| `entrypoints/background.ts` | 替换 | 只保留研报捕获消息与串行服务 |
| `entrypoints/content.ts` | 替换 | 只在 BofA 白名单页自动识别和提交 |
| `entrypoints/popup/*` | 替换 | 研报状态、总开关、BofA 开关、固定备份位置 |
| `entrypoints/options/*` | 删除 | 不保留旧通用剪藏设置页 |
| `utils/extractors/*` 与旧 Obsidian/飞书/高亮模块 | 删除 | 不保留普通剪藏产品实现 |
| `public/logo.png`, `public/icon/*`, `.github/assets/social-preview.*` | 删除 | 不复用 ZJ 品牌资产 |
| `tests/fixtures/bofa-report.html` | 新建 | 完全脱敏、最小但有代表性的 BofA HTML |
| `tests/research/*.test.ts` | 新建 | 纯逻辑、DOM 固定样本、事务顺序、产品边界 |
| `scripts/check-content-ascii.mjs`, `scripts/check-manifest.mjs` | 新建 | 构建后编码、权限、host 与产品边界断言 |
| `README.md`, `DEVELOPMENT.md`, `PRIVACY.md`, `SECURITY.md`, `CHANGELOG.md`, `docs/TESTING.md` | 重写/更新 | 中文产品与验收说明 |
| `.github/workflows/*.yml`, `.github/pull_request_template.md`, `.github/dependabot.yml` | 修改 | Chrome-only CI/发布和新回归门 |

---

### Task 1: 独立产品骨架、共享类型与测试门

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `wxt.config.ts`
- Modify: `entrypoints/popup/index.html`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `utils/research/types.ts`
- Create: `utils/research/settings.ts`
- Create: `tests/research/settings.test.ts`
- Create: `tests/research/product-config.test.ts`

**Interfaces:**
- Consumes: 当前 WXT/React/TypeScript 项目。
- Produces: `ResearchSettings`、`DEFAULT_RESEARCH_SETTINGS`、`loadResearchSettings()`、`saveResearchSettings()`、所有后续任务共用的捕获/历史/状态类型。

- [ ] **Step 1: 先建立可运行的测试门，不改变产品行为**

Run: `npm install --save-dev vitest jsdom @types/node`

只在当前 `package.json` scripts 中增加：

```json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Expected: `package-lock.json` 新增 Vitest/jsdom/@types/node，旧产品名和运行逻辑此时仍保持不变。

- [ ] **Step 2: 写设置和产品配置失败测试**

```ts
// tests/research/settings.test.ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESEARCH_SETTINGS,
  normalizeResearchSettings,
} from '@/utils/research/settings';

describe('research settings', () => {
  it('默认自动捕获并启用 BofA', () => {
    expect(normalizeResearchSettings(undefined)).toEqual(DEFAULT_RESEARCH_SETTINGS);
  });

  it('只合并独立研报字段，不接受旧 ZJ 设置形状', () => {
    expect(
      normalizeResearchSettings({
        autoCapture: false,
        providers: { bofa: false },
        vaultName: 'legacy-vault',
      }),
    ).toEqual({ autoCapture: false, providers: { bofa: false } });
  });
});
```

```ts
// tests/research/product-config.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('product identity', () => {
  it('uses the independent Fin-report-clipper package identity', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      name: string;
      displayName: string;
      version: string;
      scripts: Record<string, string>;
    };
    expect(pkg.name).toBe('fin-report-clipper');
    expect(pkg.displayName).toBe('Fin-report-clipper');
    expect(pkg.version).toBe('0.1.0');
    expect(Object.keys(pkg.scripts)).not.toContain('build:edge');
    expect(Object.keys(pkg.scripts)).not.toContain('build:firefox');
  });

  it('uses only the Chrome research permissions and BofA host', () => {
    const config = readFileSync('wxt.config.ts', 'utf8');
    expect(config).toContain("name: 'Fin-report-clipper'");
    expect(config).toContain("minimum_chrome_version: '116'");
    expect(config).toContain("'downloads'");
    expect(config).toContain("'offscreen'");
    expect(config).toContain("'storage'");
    expect(config).toContain("'https://rsch.baml.com/*'");
    expect(config).not.toContain("'<all_urls>'");
    expect(config).not.toContain("'activeTab'");
    expect(config).not.toContain("'identity'");
    expect(config).not.toContain("'contextMenus'");
    expect(config).not.toContain('commands:');
  });
});
```

- [ ] **Step 3: 运行测试并确认因新模块和旧产品身份失败**

Run: `npm test -- tests/research/settings.test.ts tests/research/product-config.test.ts`

Expected: FAIL；报告 `Cannot find module '@/utils/research/settings'`。创建该模块后再次运行时，旧包名和旧 manifest 权限断言仍然失败。

- [ ] **Step 4: 更新独立产品身份和最终脚本**

然后把 `package.json` 的身份和 scripts 改成以下精确值；保留 React、Turndown、WXT 等现有版本，`defuddle` 在 Task 7 删除：

```json
{
  "name": "fin-report-clipper",
  "displayName": "Fin-report-clipper",
  "description": "在 Chrome 中自动识别并归档受支持的金融研报",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "compile": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "postinstall": "wxt prepare"
  }
}
```

Run: `npm install --package-lock-only --ignore-scripts`

Expected: `package-lock.json` 的根包名和版本对应更新；Task 1 Step 1 安装的测试依赖保持锁定。

- [ ] **Step 5: 增加 Vitest 配置**

```ts
// vitest.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    clearMocks: true,
    setupFiles: ['tests/setup.ts'],
  },
});
```

- [ ] **Step 6: 为 jsdom 测试补齐与 Chrome 一致的 Web Crypto**

```ts
// tests/setup.ts
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
}
```

- [ ] **Step 7: 建立后续任务唯一共享的最终类型名**

```ts
// utils/research/types.ts
export type ProviderId = 'bofa';
export type MetadataValue = string | number | boolean | string[] | number[];
export type PageKind =
  | 'report-html'
  | 'auth-required'
  | 'unsupported';

export interface CanonicalResearchUrl {
  provider: ProviderId;
  sanitized: string;
}

export interface CapturedDocument {
  schema: 'fin-report-clipper/capture-v1';
  provider: 'BofA Global Research';
  sourceType: 'html' | 'html+pdf';
  sourceId?: string;
  title?: string;
  publishedAt?: string;
  authors?: string[];
  companies?: string[];
  tickers?: string[];
  observedMetadata: Record<string, MetadataValue>;
  originalMarkdown: string;
  sanitizedSource: string;
  capturedAt: string;
  contentHash: string;
  captureStatus: 'complete' | 'partial';
}

export interface CaptureSubmission {
  adapterVersion: 'bofa-html-v1';
  document: CapturedDocument;
  /** 只在未完成事务中使用；禁止写入存储、界面、日志或归档。 */
  transientPdfUrl?: string;
}

export interface ReadinessEvidence {
  kind: PageKind;
  sourceId?: string;
  title?: string;
  bodyTextLength: number;
  tableCount: number;
  tailText: string;
}

export type CaptureResult =
  | { status: 'saved'; archivePath: string }
  | { status: 'duplicate'; archivePath: string }
  | { status: 'partial'; archivePath: string; warnings: string[] }
  | { status: 'failed'; reason: string };

export type PageStatusCode =
  | 'observing'
  | 'waiting-ready'
  | 'extracting'
  | 'saving'
  | 'saved'
  | 'duplicate'
  | 'partial'
  | 'needs-action'
  | 'failed'
  | 'disabled'
  | 'unsupported';

export interface PageStatus {
  code: PageStatusCode;
  message: string;
  title?: string;
  archivePath?: string;
  updatedAt: string;
}

export interface CaptureHistoryEntry {
  identityKey: string;
  contentHash: string;
  archivePath: string;
  status: 'complete' | 'partial';
  capturedAt: string;
}

export interface ArchivePlan {
  identityKey: string;
  archiveDir: string;
  originalMarkdownPath: string;
  originalPdfPath?: string;
  manifestPath: string;
  revision: boolean;
  retryPartial: boolean;
}
```

- [ ] **Step 8: 实现独立本地设置，不包含迁移逻辑**

```ts
// utils/research/settings.ts
export interface ResearchSettings {
  autoCapture: boolean;
  providers: { bofa: boolean };
}

export const RESEARCH_SETTINGS_KEY = 'fin_report_clipper_settings';

export const DEFAULT_RESEARCH_SETTINGS: ResearchSettings = {
  autoCapture: true,
  providers: { bofa: true },
};

export function normalizeResearchSettings(value: unknown): ResearchSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const providers =
    raw.providers && typeof raw.providers === 'object'
      ? (raw.providers as Record<string, unknown>)
      : {};
  return {
    autoCapture:
      typeof raw.autoCapture === 'boolean'
        ? raw.autoCapture
        : DEFAULT_RESEARCH_SETTINGS.autoCapture,
    providers: {
      bofa:
        typeof providers.bofa === 'boolean'
          ? providers.bofa
          : DEFAULT_RESEARCH_SETTINGS.providers.bofa,
    },
  };
}

export async function loadResearchSettings(): Promise<ResearchSettings> {
  const result = await chrome.storage.local.get(RESEARCH_SETTINGS_KEY);
  return normalizeResearchSettings(result[RESEARCH_SETTINGS_KEY]);
}

export async function saveResearchSettings(settings: ResearchSettings): Promise<void> {
  await chrome.storage.local.set({
    [RESEARCH_SETTINGS_KEY]: normalizeResearchSettings(settings),
  });
}

export function isBofaAutoCaptureEnabled(settings: ResearchSettings): boolean {
  return settings.autoCapture && settings.providers.bofa;
}
```

- [ ] **Step 9: 收紧 WXT manifest 并改弹窗标题**

```ts
// wxt.config.ts
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    esbuild: { charset: 'ascii' },
  }),
  manifest: {
    name: 'Fin-report-clipper',
    description: '自动识别并归档受支持的金融研报',
    default_locale: undefined,
    minimum_chrome_version: '116',
    permissions: ['downloads', 'offscreen', 'storage'],
    host_permissions: ['https://rsch.baml.com/*'],
    action: {
      default_title: 'Fin-report-clipper：研报捕获状态',
    },
  },
});
```

```html
<!-- entrypoints/popup/index.html -->
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Fin-report-clipper</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 10: 运行测试、类型检查和 Chrome 构建**

Run: `npm test -- tests/research/settings.test.ts tests/research/product-config.test.ts`

Expected: PASS，4 tests passed。

Run: `npm run compile && npm run build`

Expected: 两个命令退出码均为 0，`.output/chrome-mv3/manifest.json` 生成。

- [ ] **Step 11: 提交独立产品骨架**

```bash
git add package.json package-lock.json wxt.config.ts vitest.config.ts entrypoints/popup/index.html utils/research/types.ts utils/research/settings.ts tests/setup.ts tests/research/settings.test.ts tests/research/product-config.test.ts
git commit -m "chore: establish Fin-report-clipper foundation"
```

---

### Task 2: URL 隐私、稳定序列化与正文哈希

**Files:**
- Create: `utils/research/privacy.ts`
- Create: `utils/research/hash.ts`
- Create: `tests/research/privacy.test.ts`
- Create: `tests/research/hash.test.ts`

**Interfaces:**
- Consumes: `CanonicalResearchUrl`, `CapturedDocument` from Task 1。
- Produces: `canonicalizeBofaUrl(rawUrl)`、`sanitizeEmbeddedUrl(rawUrl, baseUrl)`、`redactError(error)`、`sha256Text(text)`、`buildContentHash(input)`。

- [ ] **Step 1: 写 URL 脱敏和错误脱敏失败测试**

```ts
// tests/research/privacy.test.ts
import { describe, expect, it } from 'vitest';
import {
  canonicalizeBofaUrl,
  redactError,
  sanitizeEmbeddedUrl,
  sanitizeTextContent,
} from '@/utils/research/privacy';

describe('research URL privacy', () => {
  const privateUrl =
    'https://rsch.baml.com/r?q=fake-report&e=analyst%40example.com&h=fake-signature';

  it('removes every BofA query parameter from archived identity', () => {
    expect(canonicalizeBofaUrl(privateUrl)).toEqual({
      provider: 'bofa',
      sanitized: 'https://rsch.baml.com/r',
    });
  });

  it('removes BofA credentials from embedded links and keeps safe public params elsewhere', () => {
    expect(sanitizeEmbeddedUrl(privateUrl, privateUrl)).toBe('https://rsch.baml.com/r');
    expect(
      sanitizeEmbeddedUrl(
        'https://cdn.example.com/chart.png?q=semiconductors&width=1200&token=secret',
        privateUrl,
      ),
    ).toBe('https://cdn.example.com/chart.png?q=semiconductors&width=1200');
  });

  it('never returns a URL or email from an error', () => {
    const message = redactError(
      new Error(`download failed for analyst@example.com at ${privateUrl}`),
    );
    expect(message).not.toContain('fake-report');
    expect(message).not.toContain('analyst@example.com');
    expect(message).toContain('[redacted-url]');
  });

  it('sanitizes URLs and emails that appear as visible report text', () => {
    expect(
      sanitizeTextContent(
        `Reader analyst@example.com; public contact public.analyst@bofa.example; read ${privateUrl}`,
        privateUrl,
      ),
    ).toBe(
      'Reader [redacted-email]; public contact public.analyst@bofa.example; read https://rsch.baml.com/r',
    );
  });

  it('rejects non-BofA URLs as BofA identities', () => {
    expect(() => canonicalizeBofaUrl('https://example.com/r?q=x')).toThrow(
      'Unsupported BofA URL',
    );
  });
});
```

- [ ] **Step 2: 写稳定哈希失败测试**

```ts
// tests/research/hash.test.ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildContentHash, sha256Text } from '@/utils/research/hash';

describe('research content hash', () => {
  it('implements SHA-256 with the required prefix', async () => {
    await expect(sha256Text('abc')).resolves.toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is stable across object key order and excludes capture time', async () => {
    const left = await buildContentHash({
      provider: 'BofA Global Research',
      sourceId: 'BOFA-1',
      title: 'Semiconductor update',
      publishedAt: '2026-07-16',
      authors: ['Analyst A'],
      observedMetadata: { subtitle: 'Update', language: 'English' },
      bodyMarkdown: '## Thesis\n\nBody',
    });
    const right = await buildContentHash({
      provider: 'BofA Global Research',
      sourceId: 'BOFA-1',
      title: 'Semiconductor update',
      publishedAt: '2026-07-16',
      authors: ['Analyst A'],
      observedMetadata: { language: 'English', subtitle: 'Update' },
      bodyMarkdown: '## Thesis\n\nBody',
    });
    expect(left).toBe(right);
  });
});
```

- [ ] **Step 3: 运行测试并确认新函数不存在**

Run: `npm test -- tests/research/privacy.test.ts tests/research/hash.test.ts`

Expected: FAIL with `Cannot find module '@/utils/research/privacy'` 或 `hash`。

- [ ] **Step 4: 实现 URL 规范化和错误脱敏**

```ts
// utils/research/privacy.ts
import type { CanonicalResearchUrl } from './types';

const ACCESS_QUERY_KEYS = new Set([
  'auth',
  'e',
  'email',
  'h',
  'key',
  'q',
  'sig',
  'signature',
  'token',
]);
const GENERIC_SENSITIVE_QUERY_KEYS = new Set([
  'auth',
  'email',
  'key',
  'sig',
  'signature',
  'token',
]);

const HTTP_URL_RE = /https?:\/\/[^\s"'<>),]+/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const EMAIL_VALUE_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export function canonicalizeBofaUrl(rawUrl: string): CanonicalResearchUrl {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'rsch.baml.com') {
    throw new Error('Unsupported BofA URL');
  }
  const sanitized = `${url.origin}${url.pathname}`;
  return {
    provider: 'bofa',
    sanitized,
  };
}

export function sanitizeEmbeddedUrl(rawUrl: string, baseUrl: string): string {
  if (!rawUrl || rawUrl.startsWith('#')) return rawUrl;
  if (/^(data|blob|javascript):/i.test(rawUrl)) return '';
  try {
    const url = new URL(rawUrl, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.username = '';
    url.password = '';
    url.hash = '';
    if (url.hostname === 'rsch.baml.com') {
      url.search = '';
    } else {
      for (const key of [...url.searchParams.keys()]) {
        if (GENERIC_SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
          url.searchParams.delete(key);
        }
      }
    }
    return url.toString();
  } catch {
    return '';
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactPrivateUrlValues(text: string, baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const values = [...url.searchParams.entries()]
      .filter(([key, value]) => ACCESS_QUERY_KEYS.has(key.toLowerCase()) && value.length >= 3)
      .map(([, value]) => value)
      .sort((left, right) => right.length - left.length);
    return values.reduce((result, value) => {
      const label = EMAIL_VALUE_RE.test(value) ? '[redacted-email]' : '[redacted-value]';
      return result.replace(new RegExp(escapeRegExp(value), 'gi'), label);
    }, text);
  } catch {
    return text;
  }
}

export function sanitizeTextContent(text: string, baseUrl: string): string {
  const urlsSanitized = text.replace(HTTP_URL_RE, (rawUrl) => {
    return sanitizeEmbeddedUrl(rawUrl, baseUrl) || '[redacted-url]';
  });
  return redactPrivateUrlValues(urlsSanitized, baseUrl);
}

export function redactError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(HTTP_URL_RE, '[redacted-url]')
    .replace(EMAIL_RE, '[redacted-email]')
    .slice(0, 240);
}
```

- [ ] **Step 5: 实现稳定 JSON 与 SHA-256**

```ts
// utils/research/hash.ts
import type { MetadataValue } from './types';

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export async function sha256Text(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text.replace(/\r\n?/g, '\n'));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

export interface ContentHashInput {
  provider: string;
  sourceId?: string;
  title?: string;
  publishedAt?: string;
  authors?: string[];
  observedMetadata: Record<string, MetadataValue>;
  bodyMarkdown: string;
}

export function buildContentHash(input: ContentHashInput): Promise<string> {
  return sha256Text(stableJson(input));
}
```

- [ ] **Step 6: 运行隐私与哈希测试**

Run: `npm test -- tests/research/privacy.test.ts tests/research/hash.test.ts`

Expected: PASS，7 tests passed。

Run: `npm run compile`

Expected: exit 0。

- [ ] **Step 7: 提交隐私与哈希基础**

```bash
git add utils/research/privacy.ts utils/research/hash.ts tests/research/privacy.test.ts tests/research/hash.test.ts
git commit -m "feat: add research URL privacy and hashing"
```

---

### Task 3: 脱敏 BofA 固定样本、适配器与忠实 Markdown

**Files:**
- Create: `tests/fixtures/bofa-report.html`
- Create: `utils/research/adapters/types.ts`
- Create: `utils/research/adapters/bofa.ts`
- Create: `utils/research/markdown.ts`
- Create: `tests/research/bofa.test.ts`

**Interfaces:**
- Consumes: Task 1 的捕获类型，Task 2 的 `canonicalizeBofaUrl()`、`sanitizeEmbeddedUrl()`、`buildContentHash()`。
- Produces: `ResearchSiteAdapter`、`StableReadinessTracker`、`bofaAdapter`、`htmlToResearchMarkdown()`、`renderOriginalMarkdown()`。

- [ ] **Step 1: 创建完全脱敏的最小 BofA HTML 固定样本**

```html
<!-- tests/fixtures/bofa-report.html -->
<!doctype html>
<html lang="en">
  <head><title>Sanitized BofA report fixture</title></head>
  <body class="report">
    <input id="reportPid" value="BOFA-TEST-001" />
    <input id="reportTitle" value="Taiwan Semiconductor Manufacturing Co." />
    <input id="reportSubTitle" value="Quarterly sales and margin update for analyst@example.com" />
    <input id="reportAuthor" value="Analyst One; Analyst Two" />
    <input id="reportPublishDate" value="16 July 2026 02:00PM EDT" />
    <a
      id="print_pdf_anchor"
      title="PDF"
      href="https://rsch.baml.com/r?q=fake-report&amp;e=analyst%40example.com&amp;h=fake-signature"
    >PDF</a>
    <main id="report-center-container">
      <div id="Fixture_HtmlComponent_Body">
        <h2>Investment rationale</h2>
        <p>
          Demand remains supported by high-performance computing. This paragraph is deliberately
          long enough to represent a real report body without copying any proprietary user sample.
        </p>
        <p>
          The report preserves source order, prose, exhibits, links and disclosures. It does not
          add a generated summary, category or tag during capture.
        </p>
        <table>
          <caption>Exhibit 1: Estimate comparison</caption>
          <thead><tr><th>Metric</th><th colspan="2">2027E</th></tr></thead>
          <tbody><tr><td>Revenue</td><td>BofAe</td><td>Street</td></tr></tbody>
        </table>
        <img
          src="https://cdn.example.com/chart.png?width=1200&amp;token=fake-image-token"
          alt="Chart prepared for analyst@example.com"
        />
        <p><a href="https://rsch.baml.com/r?q=another&amp;e=reader%40example.com">Related report</a></p>
        <p>Public analyst contact: public.analyst@bofa.example</p>
        <h2>Disclosures</h2>
        <p>Important source disclosure text remains part of the captured report.</p>
      </div>
    </main>
  </body>
</html>
```

检查样本中只能出现明确的假值：

Run: `rg -n "xiaoyuliu|skyliu|vp.com.hk|exoT7g|5nZKy" tests/fixtures/bofa-report.html`

Expected: no matches，退出码 1。

- [ ] **Step 2: 写 BofA DOM、隐私、Markdown 和稳定性失败测试**

```ts
// tests/research/bofa.test.ts
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { bofaAdapter } from '@/utils/research/adapters/bofa';
import { StableReadinessTracker } from '@/utils/research/adapters/types';

const fixture = readFileSync('tests/fixtures/bofa-report.html', 'utf8');
const privateUrl =
  'https://rsch.baml.com/r?q=fake-report&e=analyst%40example.com&h=fake-signature';

describe('BofA adapter', () => {
  beforeEach(() => {
    document.open();
    document.write(fixture);
    document.close();
  });

  it('classifies only approved BofA report routes', () => {
    expect(bofaAdapter.classifyPage(document, new URL(privateUrl))).toBe('report-html');
    expect(
      bofaAdapter.classifyPage(document, new URL('https://rsch.baml.com/home')),
    ).toBe('unsupported');
  });

  it('detects explicit auth pages without treating report prose as an auth failure', () => {
    document.querySelector('[id$="_Body"]')?.append(' Access denied is discussed as a scenario.');
    expect(bofaAdapter.classifyPage(document, new URL(privateUrl))).toBe('report-html');
    document.body.innerHTML = '<input type="password"><p>Access denied</p>';
    expect(bofaAdapter.classifyPage(document, new URL(privateUrl))).toBe('auth-required');
  });

  it('extracts source metadata, faithful body and a transient PDF URL', async () => {
    const result = await bofaAdapter.extractOriginal(
      document,
      privateUrl,
      '2026-07-17T16:30:00+09:00',
    );
    expect(result.document.sourceId).toBe('BOFA-TEST-001');
    expect(result.document.authors).toEqual(['Analyst One', 'Analyst Two']);
    expect(result.document.sourceType).toBe('html+pdf');
    expect(result.document.sanitizedSource).toBe('https://rsch.baml.com/r');
    expect(result.transientPdfUrl).toBe(privateUrl);
    expect(result.document.originalMarkdown).toContain('# Taiwan Semiconductor Manufacturing Co.');
    expect(result.document.originalMarkdown).toContain(
      '> Quarterly sales and margin update for [redacted-email]',
    );
    expect(result.document.originalMarkdown).toContain('## Investment rationale');
    expect(result.document.originalMarkdown).toContain('<table>');
    expect(result.document.originalMarkdown).toContain('colspan="2"');
    expect(result.document.originalMarkdown).toContain('## Disclosures');
    expect(result.document.originalMarkdown).toContain('public.analyst@bofa.example');
    expect(result.document.originalMarkdown).not.toContain('analyst@example.com');
    expect(result.document.originalMarkdown).not.toContain('fake-image-token');
    expect(result.document.originalMarkdown).not.toContain('fake-signature');
    expect(JSON.stringify(result.document.observedMetadata)).not.toContain(
      'analyst@example.com',
    );
    expect(result.document.originalMarkdown).not.toContain('tags:');
    expect(result.document.originalMarkdown).not.toContain('summary:');
  });

  it('omits absent optional metadata rather than writing empty fields', async () => {
    document.querySelector('#reportAuthor')?.remove();
    document.querySelector('#reportPublishDate')?.remove();
    const result = await bofaAdapter.extractOriginal(
      document,
      privateUrl,
      '2026-07-17T16:30:00+09:00',
    );
    expect(result.document.authors).toBeUndefined();
    expect(result.document.publishedAt).toBeUndefined();
    expect(result.document.originalMarkdown).not.toContain('authors:');
    expect(result.document.originalMarkdown).not.toContain('published:');
  });

  it('requires three identical ready observations', () => {
    const tracker = new StableReadinessTracker(3);
    const evidence = bofaAdapter.readinessEvidence(document, new URL(privateUrl));
    expect(tracker.observe(evidence)).toBe(false);
    expect(tracker.observe(evidence)).toBe(false);
    expect(tracker.observe(evidence)).toBe(true);
  });
});
```

- [ ] **Step 3: 运行 BofA 测试并确认适配器不存在**

Run: `npm test -- tests/research/bofa.test.ts`

Expected: FAIL with `Cannot find module '@/utils/research/adapters/bofa'`。

- [ ] **Step 4: 定义机构适配器接口与稳定性跟踪器**

```ts
// utils/research/adapters/types.ts
import type {
  CaptureSubmission,
  PageKind,
  ReadinessEvidence,
} from '../types';

export interface ResearchSiteAdapter {
  id: 'bofa';
  classifyPage(document: Document, url: URL): PageKind;
  readinessEvidence(document: Document, url: URL): ReadinessEvidence;
  extractOriginal(
    document: Document,
    rawUrl: string,
    capturedAt: string,
  ): Promise<CaptureSubmission>;
  findOriginalPdf(document: Document): string | null;
  getSourceId(document: Document): string | null;
}

function evidenceSignature(evidence: ReadinessEvidence): string {
  return JSON.stringify([
    evidence.kind,
    evidence.sourceId,
    evidence.title,
    evidence.bodyTextLength,
    evidence.tableCount,
    evidence.tailText,
  ]);
}

export class StableReadinessTracker {
  private previous = '';
  private stableCount = 0;

  constructor(private readonly requiredPasses = 3) {}

  observe(evidence: ReadinessEvidence): boolean {
    if (
      evidence.kind !== 'report-html' ||
      !evidence.sourceId ||
      !evidence.title ||
      evidence.bodyTextLength < 200
    ) {
      this.previous = '';
      this.stableCount = 0;
      return false;
    }
    const current = evidenceSignature(evidence);
    this.stableCount = current === this.previous ? this.stableCount + 1 : 1;
    this.previous = current;
    return this.stableCount >= this.requiredPasses;
  }
}
```

- [ ] **Step 5: 实现研报专用 Markdown 转换与最小 YAML**

```ts
// utils/research/markdown.ts
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import type { CapturedDocument } from './types';
import { sanitizeEmbeddedUrl, sanitizeTextContent } from './privacy';

const SAFE_ATTRIBUTES = new Set([
  'alt',
  'colspan',
  'height',
  'href',
  'rowspan',
  'scope',
  'src',
  'title',
  'width',
]);

function cleanClone(root: HTMLElement, baseUrl: string): HTMLElement {
  const clone = root.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll('script, style, noscript, form, input, button, iframe, canvas, svg, [hidden], [aria-hidden="true"]')
    .forEach((node) => node.remove());
  clone.querySelectorAll<HTMLElement>('*').forEach((element) => {
    if (/display\s*:\s*none/i.test(element.getAttribute('style') || '')) {
      element.remove();
      return;
    }
    const anchorHref = element instanceof HTMLAnchorElement
      ? element.getAttribute('href') || ''
      : '';
    const imageSrc = element instanceof HTMLImageElement
      ? element.getAttribute('data-src') ||
        element.getAttribute('data-original') ||
        element.getAttribute('src') ||
        ''
      : '';
    for (const attribute of [...element.attributes]) {
      if (!SAFE_ATTRIBUTES.has(attribute.name.toLowerCase())) element.removeAttribute(attribute.name);
    }
    for (const attributeName of ['alt', 'title']) {
      const value = element.getAttribute(attributeName);
      if (value) element.setAttribute(attributeName, sanitizeTextContent(value, baseUrl));
    }
    if (element instanceof HTMLAnchorElement) {
      const href = sanitizeEmbeddedUrl(anchorHref, baseUrl);
      href ? element.setAttribute('href', href) : element.removeAttribute('href');
    }
    if (element instanceof HTMLImageElement) {
      const src = sanitizeEmbeddedUrl(imageSrc, baseUrl);
      src ? element.setAttribute('src', src) : element.remove();
    }
  });
  const walker = clone.ownerDocument.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode) {
    textNode.nodeValue = sanitizeTextContent(textNode.nodeValue || '', baseUrl);
    textNode = walker.nextNode();
  }
  return clone;
}

export function htmlToResearchMarkdown(root: HTMLElement, baseUrl: string): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  turndown.use(gfm);
  turndown.addRule('complexResearchTable', {
    filter: (node) =>
      node.nodeName === 'TABLE' && Boolean((node as HTMLElement).querySelector('[rowspan], [colspan]')),
    replacement: (_content, node) => `\n\n${(node as HTMLElement).outerHTML}\n\n`,
  });
  return turndown
    .turndown(cleanClone(root, baseUrl))
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlList(key: string, values: string[] | undefined): string[] {
  return values?.length ? [`${key}:`, ...values.map((value) => `  - ${yamlString(value)}`)] : [];
}

export function renderOriginalMarkdown(
  document: Omit<CapturedDocument, 'originalMarkdown'>,
  bodyMarkdown: string,
): string {
  const frontmatter = [
    '---',
    'schema: fin-report-clipper/capture-v1',
    `provider: ${yamlString(document.provider)}`,
    ...(document.sourceId ? [`source_id: ${yamlString(document.sourceId)}`] : []),
    `source_type: ${document.sourceType}`,
    `source: ${yamlString(document.sanitizedSource)}`,
    ...(document.publishedAt ? [`published: ${yamlString(document.publishedAt)}`] : []),
    ...yamlList('authors', document.authors),
    ...yamlList('companies', document.companies),
    ...yamlList('tickers', document.tickers),
    `captured: ${yamlString(document.capturedAt)}`,
    `capture_status: ${document.captureStatus}`,
    `content_hash: ${document.contentHash}`,
    '---',
  ];
  const title = document.title
    ? `# ${document.title.replace(/\s+/g, ' ').trim()}\n\n`
    : '';
  const subtitleValue = document.observedMetadata.subtitle;
  const subtitle =
    typeof subtitleValue === 'string'
      ? `> ${subtitleValue.replace(/\s+/g, ' ').trim()}\n\n`
      : '';
  return `${frontmatter.join('\n')}\n\n${title}${subtitle}${bodyMarkdown.trim()}\n`;
}
```

- [ ] **Step 6: 实现 BofA 适配器，不把原始页面 URL写入文档**

```ts
// utils/research/adapters/bofa.ts
import type { ResearchSiteAdapter } from './types';
import type { MetadataValue, PageKind, ReadinessEvidence } from '../types';
import { buildContentHash } from '../hash';
import { htmlToResearchMarkdown, renderOriginalMarkdown } from '../markdown';
import { canonicalizeBofaUrl, sanitizeTextContent } from '../privacy';

const REPORT_PATHS = new Set(['/r', '/report']);
const BODY_SELECTOR = '[id$="_Body"]';
const AUTH_TEXT = ['access denied', 'too many requests', 'verify you are human', 'captcha'];

function inputValue(document: Document, id: string, baseUrl?: string): string | undefined {
  const raw = (document.getElementById(id) as HTMLInputElement | null)?.value || '';
  const value = (baseUrl ? sanitizeTextContent(raw, baseUrl) : raw)
    .replace(/\s+/g, ' ')
    .trim();
  return value || undefined;
}

function splitSourceList(value: string | undefined): string[] | undefined {
  const values = value
    ?.split(/[;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return values?.length ? values : undefined;
}

function hasAuthBlock(document: Document): boolean {
  if (document.querySelector('input[type="password"]')) return true;
  if (
    document.querySelector(BODY_SELECTOR) &&
    (inputValue(document, 'reportPid') || inputValue(document, 'reportTitle'))
  ) {
    return false;
  }
  const text = document.body?.textContent?.toLowerCase().slice(0, 12000) || '';
  return AUTH_TEXT.some((marker) => text.includes(marker));
}

function classifyBofaPage(document: Document, url: URL): PageKind {
  if (url.protocol !== 'https:' || url.hostname !== 'rsch.baml.com') return 'unsupported';
  if (!REPORT_PATHS.has(url.pathname)) return 'unsupported';
  return hasAuthBlock(document) ? 'auth-required' : 'report-html';
}

function getSourceId(document: Document): string | null {
  return inputValue(document, 'reportPid') || null;
}

function findOriginalPdf(document: Document): string | null {
  const href = document
    .querySelector<HTMLAnchorElement>('a#print_pdf_anchor[title="PDF"]')
    ?.href?.trim();
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && url.hostname === 'rsch.baml.com' ? href : null;
  } catch {
    return null;
  }
}

function reportBody(document: Document): HTMLElement {
  const body = document.querySelector<HTMLElement>(BODY_SELECTOR);
  if (!body) throw new Error('BofA report body is unavailable');
  return body;
}

export const bofaAdapter: ResearchSiteAdapter = {
  id: 'bofa',

  classifyPage(document, url) {
    return classifyBofaPage(document, url);
  },

  readinessEvidence(document, url): ReadinessEvidence {
    const body = document.querySelector<HTMLElement>(BODY_SELECTOR);
    const normalized = body?.textContent?.replace(/\s+/g, ' ').trim() || '';
    return {
      kind: classifyBofaPage(document, url),
      sourceId: getSourceId(document) || undefined,
      title: inputValue(document, 'reportTitle'),
      bodyTextLength: normalized.length,
      tableCount: body?.querySelectorAll('table').length || 0,
      tailText: normalized.slice(-160),
    };
  },

  findOriginalPdf(document) {
    return findOriginalPdf(document);
  },

  getSourceId(document) {
    return getSourceId(document);
  },

  async extractOriginal(document, rawUrl, capturedAt) {
    const canonical = canonicalizeBofaUrl(rawUrl);
    const sourceId = inputValue(document, 'reportPid');
    const title = inputValue(document, 'reportTitle', rawUrl);
    const subtitle = inputValue(document, 'reportSubTitle', rawUrl);
    const publishedAt = inputValue(document, 'reportPublishDate', rawUrl);
    const authors = splitSourceList(inputValue(document, 'reportAuthor', rawUrl));
    const transientPdfUrl = findOriginalPdf(document) || undefined;
    const observedMetadata: Record<string, MetadataValue> = {};
    if (subtitle) observedMetadata.subtitle = subtitle;
    if (authors) observedMetadata.authors = authors;
    if (publishedAt) observedMetadata.publishedAt = publishedAt;

    const bodyMarkdown = htmlToResearchMarkdown(reportBody(document), rawUrl);
    const contentHash = await buildContentHash({
      provider: 'BofA Global Research',
      sourceId,
      title,
      publishedAt,
      authors,
      observedMetadata,
      bodyMarkdown,
    });
    const captured = {
      schema: 'fin-report-clipper/capture-v1' as const,
      provider: 'BofA Global Research' as const,
      sourceType: transientPdfUrl ? ('html+pdf' as const) : ('html' as const),
      ...(sourceId ? { sourceId } : {}),
      ...(title ? { title } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      ...(authors ? { authors } : {}),
      observedMetadata,
      sanitizedSource: canonical.sanitized,
      capturedAt,
      contentHash,
      captureStatus: 'complete' as const,
    };
    return {
      adapterVersion: 'bofa-html-v1',
      document: {
        ...captured,
        originalMarkdown: renderOriginalMarkdown(captured, bodyMarkdown),
      },
      ...(transientPdfUrl ? { transientPdfUrl } : {}),
    };
  },
};
```

- [ ] **Step 7: 运行 BofA 固定样本测试和隐私回归**

Run: `npm test -- tests/research/bofa.test.ts tests/research/privacy.test.ts tests/research/hash.test.ts`

Expected: PASS，所有断言通过；测试输出不打印固定样本正文或 URL。

Run: `npm run compile`

Expected: exit 0。

- [ ] **Step 8: 提交首个机构适配器**

```bash
git add tests/fixtures/bofa-report.html tests/research/bofa.test.ts utils/research/adapters/types.ts utils/research/adapters/bofa.ts utils/research/markdown.ts
git commit -m "feat: extract BofA research reports"
```

---

### Task 4: 安全归档路径、去重与修订历史

**Files:**
- Create: `utils/research/path.ts`
- Create: `utils/research/history.ts`
- Create: `tests/research/archive-plan.test.ts`
- Create: `tests/research/history.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `CapturedDocument`、`CaptureHistoryEntry`、`ArchivePlan`，Task 2 的 `sha256Text()`。
- Produces: `BACKUP_ROOT`、`safePathSegment()`、`buildIdentityKey()`、`resolveArchivePlan()`、`HistoryRepository`、`createHistoryRepository()`。

- [ ] **Step 1: 写首次捕获、重复、修订和部分重试失败测试**

```ts
// tests/research/archive-plan.test.ts
import { describe, expect, it } from 'vitest';
import { resolveArchivePlan } from '@/utils/research/path';
import type { CaptureHistoryEntry, CapturedDocument } from '@/utils/research/types';

const document: CapturedDocument = {
  schema: 'fin-report-clipper/capture-v1',
  provider: 'BofA Global Research',
  sourceType: 'html+pdf',
  sourceId: 'BOFA-TEST-001',
  title: 'Taiwan Semiconductor Manufacturing Co.',
  observedMetadata: {},
  originalMarkdown: '# Report\n',
  sanitizedSource: 'https://rsch.baml.com/r',
  capturedAt: '2026-07-17T16:30:00+09:00',
  contentHash: `sha256:${'a'.repeat(64)}`,
  captureStatus: 'complete',
};

describe('archive planning', () => {
  it('creates the fixed Downloads-relative path for a first capture', async () => {
    const resolution = await resolveArchivePlan(document, []);
    expect(resolution).toEqual({
      kind: 'write',
      plan: {
        identityKey: 'bofa:id:BOFA-TEST-001',
        archiveDir:
          'Fin-report-clipper Backup/BofA/2026/2026-07-17-Taiwan Semiconductor Manufacturing Co-BOFA-TEST-001-aaaaaaaaaaaaaaaa',
        originalMarkdownPath:
          'Fin-report-clipper Backup/BofA/2026/2026-07-17-Taiwan Semiconductor Manufacturing Co-BOFA-TEST-001-aaaaaaaaaaaaaaaa/original.md',
        originalPdfPath:
          'Fin-report-clipper Backup/BofA/2026/2026-07-17-Taiwan Semiconductor Manufacturing Co-BOFA-TEST-001-aaaaaaaaaaaaaaaa/original.pdf',
        manifestPath:
          'Fin-report-clipper Backup/BofA/2026/2026-07-17-Taiwan Semiconductor Manufacturing Co-BOFA-TEST-001-aaaaaaaaaaaaaaaa/.fin-report-clipper/capture.json',
        revision: false,
        retryPartial: false,
      },
    });
  });

  it('returns duplicate for the same identity and content hash after a complete save', async () => {
    const entry: CaptureHistoryEntry = {
      identityKey: 'bofa:id:BOFA-TEST-001',
      contentHash: document.contentHash,
      archivePath: 'Fin-report-clipper Backup/BofA/2026/existing',
      status: 'complete',
      capturedAt: document.capturedAt,
    };
    await expect(resolveArchivePlan(document, [entry])).resolves.toEqual({
      kind: 'duplicate',
      entry,
    });
  });

  it('reuses the same folder when retrying an identical partial capture', async () => {
    const partial: CaptureHistoryEntry = {
      identityKey: 'bofa:id:BOFA-TEST-001',
      contentHash: document.contentHash,
      archivePath: 'Fin-report-clipper Backup/BofA/2026/partial-report',
      status: 'partial',
      capturedAt: document.capturedAt,
    };
    const resolution = await resolveArchivePlan(document, [partial]);
    expect(resolution.kind).toBe('write');
    if (resolution.kind === 'write') {
      expect(resolution.plan.archiveDir).toBe(partial.archivePath);
      expect(resolution.plan.retryPartial).toBe(true);
    }
  });

  it('keeps a changed report as a revision instead of overwriting it', async () => {
    const previous: CaptureHistoryEntry = {
      identityKey: 'bofa:id:BOFA-TEST-001',
      contentHash: `sha256:${'b'.repeat(64)}`,
      archivePath: 'Fin-report-clipper Backup/BofA/2026/old-report',
      status: 'complete',
      capturedAt: '2026-07-16T16:30:00+09:00',
    };
    const resolution = await resolveArchivePlan(document, [previous]);
    expect(resolution.kind).toBe('write');
    if (resolution.kind === 'write') {
      expect(resolution.plan.revision).toBe(true);
      expect(resolution.plan.archiveDir).toMatch(/-rev-aaaaaaaaaaaaaaaa$/);
    }
  });

  it('rejects an invalid capture timestamp instead of creating a misleading path', async () => {
    await expect(
      resolveArchivePlan({ ...document, capturedAt: '2026-99-99' }, []),
    ).rejects.toThrow('Invalid capturedAt timestamp');
  });
});
```

- [ ] **Step 2: 写仅使用独立 storage key 的历史仓库失败测试**

```ts
// tests/research/history.test.ts
import { describe, expect, it } from 'vitest';
import {
  HISTORY_KEY,
  createHistoryRepository,
  normalizeHistory,
} from '@/utils/research/history';
import type { CaptureHistoryEntry } from '@/utils/research/types';

describe('capture history', () => {
  it('drops malformed history entries', () => {
    expect(
      normalizeHistory([
        { identityKey: 'x' },
        {
          identityKey: 'bofa:id:BOFA-1',
          contentHash: `sha256:${'a'.repeat(64)}`,
          archivePath: '../outside-downloads',
          status: 'complete',
          capturedAt: '2026-07-17T16:30:00Z',
        },
        null,
        'legacy',
      ]),
    ).toEqual([]);
  });

  it('upserts by identity and content hash under one independent local key', async () => {
    const state: Record<string, unknown> = {};
    const storage = {
      async get(key: string) {
        return { [key]: state[key] };
      },
      async set(items: Record<string, unknown>) {
        Object.assign(state, items);
      },
    };
    const repository = createHistoryRepository(storage);
    const entry: CaptureHistoryEntry = {
      identityKey: 'bofa:id:BOFA-TEST-001',
      contentHash: `sha256:${'a'.repeat(64)}`,
      archivePath: 'Fin-report-clipper Backup/BofA/2026/report',
      status: 'partial',
      capturedAt: '2026-07-17T16:30:00+09:00',
    };
    await repository.upsert(entry);
    await repository.upsert({ ...entry, status: 'complete' });
    expect(await repository.load()).toEqual([{ ...entry, status: 'complete' }]);
    expect(Object.keys(state)).toEqual([HISTORY_KEY]);
    expect(HISTORY_KEY).toBe('fin_report_clipper_history');
  });
});
```

- [ ] **Step 3: 运行测试并确认归档模块不存在**

Run: `npm test -- tests/research/archive-plan.test.ts tests/research/history.test.ts`

Expected: FAIL with missing `path` 或 `history` modules。

- [ ] **Step 4: 实现安全相对路径和归档判定**

```ts
// utils/research/path.ts
import { sha256Text, stableJson } from './hash';
import type {
  ArchivePlan,
  CaptureHistoryEntry,
  CapturedDocument,
} from './types';

export const BACKUP_ROOT = 'Fin-report-clipper Backup';

export type ArchiveResolution =
  | { kind: 'duplicate'; entry: CaptureHistoryEntry }
  | { kind: 'write'; plan: ArchivePlan };

export function safePathSegment(value: string, fallback = 'untitled'): string {
  const clean = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|#\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 80);
  return clean || fallback;
}

export async function buildIdentityKey(document: CapturedDocument): Promise<string> {
  if (document.sourceId) return `bofa:id:${document.sourceId}`;
  const metadataHash = await sha256Text(
    stableJson({
      provider: document.provider,
      title: document.title,
      publishedAt: document.publishedAt,
      authors: document.authors,
    }),
  );
  return `bofa:metadata:${metadataHash.slice('sha256:'.length, 'sha256:'.length + 24)}`;
}

function pathFor(archiveDir: string, filename: string): string {
  return `${archiveDir}/${filename}`;
}

export async function resolveArchivePlan(
  document: CapturedDocument,
  history: CaptureHistoryEntry[],
): Promise<ArchiveResolution> {
  const identityKey = await buildIdentityKey(document);
  const sameIdentity = history.filter((entry) => entry.identityKey === identityKey);
  const sameHash = sameIdentity.find((entry) => entry.contentHash === document.contentHash);
  if (sameHash?.status === 'complete') return { kind: 'duplicate', entry: sameHash };

  if (sameHash?.status === 'partial') {
    const archiveDir = sameHash.archivePath;
    return {
      kind: 'write',
      plan: {
        identityKey,
        archiveDir,
        originalMarkdownPath: pathFor(archiveDir, 'original.md'),
        ...(document.sourceType === 'html+pdf'
          ? { originalPdfPath: pathFor(archiveDir, 'original.pdf') }
          : {}),
        manifestPath: pathFor(archiveDir, '.fin-report-clipper/capture.json'),
        revision: false,
        retryPartial: true,
      },
    };
  }

  const date = /^\d{4}-\d{2}-\d{2}/.exec(document.capturedAt)?.[0];
  if (!date || Number.isNaN(Date.parse(document.capturedAt))) {
    throw new Error('Invalid capturedAt timestamp');
  }
  const year = date.slice(0, 4);
  const title = safePathSegment(document.title || 'untitled-report');
  const shortId = safePathSegment(
    document.sourceId || document.contentHash.slice('sha256:'.length, 'sha256:'.length + 8),
  ).slice(0, 16);
  const revision = sameIdentity.length > 0;
  const hashSuffix = document.contentHash.slice('sha256:'.length, 'sha256:'.length + 16);
  const versionSuffix = revision ? `-rev-${hashSuffix}` : `-${hashSuffix}`;
  const archiveDir = `${BACKUP_ROOT}/BofA/${year}/${date}-${title}-${shortId}${versionSuffix}`;
  return {
    kind: 'write',
    plan: {
      identityKey,
      archiveDir,
      originalMarkdownPath: pathFor(archiveDir, 'original.md'),
      ...(document.sourceType === 'html+pdf'
        ? { originalPdfPath: pathFor(archiveDir, 'original.pdf') }
        : {}),
      manifestPath: pathFor(archiveDir, '.fin-report-clipper/capture.json'),
      revision,
      retryPartial: false,
    },
  };
}
```

- [ ] **Step 5: 实现本地历史仓库，拒绝旧键迁移**

```ts
// utils/research/history.ts
import type { CaptureHistoryEntry } from './types';

export const HISTORY_KEY = 'fin_report_clipper_history';

export interface LocalStoragePort {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface HistoryRepository {
  load(): Promise<CaptureHistoryEntry[]>;
  upsert(entry: CaptureHistoryEntry): Promise<void>;
}

function isHistoryEntry(value: unknown): value is CaptureHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.identityKey === 'string' &&
    item.identityKey.startsWith('bofa:') &&
    typeof item.contentHash === 'string' &&
    /^sha256:[a-f0-9]{64}$/.test(item.contentHash) &&
    typeof item.archivePath === 'string' &&
    item.archivePath.startsWith('Fin-report-clipper Backup/BofA/') &&
    (item.status === 'complete' || item.status === 'partial') &&
    typeof item.capturedAt === 'string' &&
    !Number.isNaN(Date.parse(item.capturedAt))
  );
}

export function normalizeHistory(value: unknown): CaptureHistoryEntry[] {
  return Array.isArray(value) ? value.filter(isHistoryEntry) : [];
}

export function createHistoryRepository(
  storage: LocalStoragePort = chrome.storage.local,
): HistoryRepository {
  const load = async (): Promise<CaptureHistoryEntry[]> => {
    const result = await storage.get(HISTORY_KEY);
    return normalizeHistory(result[HISTORY_KEY]);
  };
  return {
    load,
    async upsert(entry) {
      const current = await load();
      const next = current.filter(
        (item) =>
          item.identityKey !== entry.identityKey || item.contentHash !== entry.contentHash,
      );
      next.push(entry);
      await storage.set({ [HISTORY_KEY]: next });
    },
  };
}
```

- [ ] **Step 6: 运行归档与历史测试**

Run: `npm test -- tests/research/archive-plan.test.ts tests/research/history.test.ts`

Expected: PASS，7 tests passed。

Run: `npm run compile`

Expected: exit 0。

- [ ] **Step 7: 提交去重与修订规划**

```bash
git add utils/research/path.ts utils/research/history.ts tests/research/archive-plan.test.ts tests/research/history.test.ts
git commit -m "feat: plan report archives and dedupe history"
```

---

### Task 5: Offscreen Blob、Downloads API 与最后清单事务

**Files:**
- Create: `utils/research/messages.ts`
- Create: `utils/research/archive-writer.ts`
- Create: `utils/research/chrome-archive-io.ts`
- Create: `entrypoints/offscreen/index.html`
- Create: `entrypoints/offscreen/main.ts`
- Create: `tests/research/archive-writer.test.ts`
- Create: `tests/research/chrome-archive-io.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `CaptureSubmission`/`ArchivePlan`，Task 2 的 `sha256Text()`/`redactError()`。
- Produces: `ArchiveIo`、`writeArchive()`、`createChromeArchiveIo()`、`eraseArchiveDownloadHistory()`、`CaptureRequest`/`GetPageStatusRequest`/Offscreen 消息类型。

- [ ] **Step 1: 写归档顺序、部分成功和隐私失败测试**

```ts
// tests/research/archive-writer.test.ts
import { describe, expect, it } from 'vitest';
import { writeArchive, type ArchiveIo } from '@/utils/research/archive-writer';
import type { ArchivePlan, CaptureSubmission } from '@/utils/research/types';

const plan: ArchivePlan = {
  identityKey: 'bofa:id:BOFA-TEST-001',
  archiveDir: 'Fin-report-clipper Backup/BofA/2026/report',
  originalMarkdownPath: 'Fin-report-clipper Backup/BofA/2026/report/original.md',
  originalPdfPath: 'Fin-report-clipper Backup/BofA/2026/report/original.pdf',
  manifestPath:
    'Fin-report-clipper Backup/BofA/2026/report/.fin-report-clipper/capture.json',
  revision: false,
  retryPartial: false,
};

const submission: CaptureSubmission = {
  adapterVersion: 'bofa-html-v1',
  transientPdfUrl:
    'https://rsch.baml.com/r?q=fake-report&e=analyst%40example.com&h=fake-signature',
  document: {
    schema: 'fin-report-clipper/capture-v1',
    provider: 'BofA Global Research',
    sourceType: 'html+pdf',
    sourceId: 'BOFA-TEST-001',
    title: 'Semiconductor update',
    observedMetadata: { subtitle: 'Quarterly update' },
    originalMarkdown:
      '---\nschema: fin-report-clipper/capture-v1\ncapture_status: complete\n---\n\n# Semiconductor update\n\nBody\n',
    sanitizedSource: 'https://rsch.baml.com/r',
    capturedAt: '2026-07-17T16:30:00+09:00',
    contentHash: `sha256:${'a'.repeat(64)}`,
    captureStatus: 'complete',
  },
};

function fakeIo(failPdf = false) {
  const calls: Array<{ kind: 'text' | 'url'; path: string; content?: string }> = [];
  const io: ArchiveIo = {
    async writeText(path, content) {
      calls.push({ kind: 'text', path, content });
    },
    async downloadUrl(path) {
      calls.push({ kind: 'url', path });
      if (failPdf) throw new Error(`SERVER_FORBIDDEN ${submission.transientPdfUrl}`);
    },
    async close() {},
  };
  return { io, calls };
}

describe('archive writer', () => {
  it('writes a Markdown safety snapshot, saves PDF, promotes Markdown, then writes capture.json', async () => {
    const { io, calls } = fakeIo();
    const result = await writeArchive(plan, submission, io);
    expect(calls.map((call) => call.path)).toEqual([
      plan.originalMarkdownPath,
      plan.originalPdfPath,
      plan.originalMarkdownPath,
      plan.manifestPath,
    ]);
    expect(result.status).toBe('complete');
    expect(calls[0].content).toContain('capture_status: partial');
    expect(calls[2].content).toContain('capture_status: complete');
    const manifest = calls.at(-1)?.content || '';
    expect(manifest).toContain('"capture_status": "complete"');
    expect(manifest).not.toContain('analyst@example.com');
    expect(manifest).not.toContain('fake-signature');
    expect(manifest).not.toContain('transientPdfUrl');
  });

  it('keeps Markdown and writes a partial manifest when PDF fails', async () => {
    const { io, calls } = fakeIo(true);
    const result = await writeArchive(plan, submission, io);
    expect(result.status).toBe('partial');
    expect(result.warnings[0]).toContain('SERVER_FORBIDDEN');
    expect(result.warnings[0]).not.toContain('rsch.baml.com');
    expect(calls.map((call) => call.path)).toEqual([
      plan.originalMarkdownPath,
      plan.originalPdfPath,
      plan.manifestPath,
    ]);
    const markdown = calls.find((call) => call.path === plan.originalMarkdownPath)?.content;
    expect(markdown).toContain('capture_status: partial');
    expect(calls.at(-1)?.content).toContain('"capture_status": "partial"');
  });

  it('writes an HTML-only report once and marks it complete', async () => {
    const { originalPdfPath: _pdfPath, ...htmlPlan } = plan;
    const { transientPdfUrl: _pdfUrl, ...submissionWithoutPdf } = submission;
    const htmlSubmission: CaptureSubmission = {
      ...submissionWithoutPdf,
      document: { ...submission.document, sourceType: 'html' },
    };
    const { io, calls } = fakeIo();
    const result = await writeArchive(htmlPlan, htmlSubmission, io);
    expect(result.status).toBe('complete');
    expect(calls.map((call) => call.path)).toEqual([
      plan.originalMarkdownPath,
      plan.manifestPath,
    ]);
    expect(calls[0].content).toContain('capture_status: complete');
  });
});
```

- [ ] **Step 2: 写 Downloads 完成、错误文件删除和历史清理失败测试**

```ts
// tests/research/chrome-archive-io.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createChromeArchiveIo,
  eraseArchiveDownloadHistory,
} from '@/utils/research/chrome-archive-io';

interface SimulatedDownload {
  state: 'complete' | 'interrupted';
  mime?: string;
  error?: string;
}

function installDownloads(item: SimulatedDownload) {
  const download = vi.fn(async () => 42);
  const search = vi.fn(async () => [{ id: 42, ...item }]);
  const removeFile = vi.fn(async () => undefined);
  const erase = vi.fn(async () => [42]);
  vi.stubGlobal('chrome', {
    downloads: {
      download,
      search,
      removeFile,
      erase,
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  });
  return { download, removeFile, erase };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Chrome archive downloads', () => {
  it('keeps a valid PDF file but erases its signed download-history entry', async () => {
    const mocks = installDownloads({ state: 'complete', mime: 'application/pdf' });
    await createChromeArchiveIo().downloadUrl(
      'Fin-report-clipper Backup/BofA/2026/report/original.pdf',
      'https://rsch.baml.com/r?q=fake&e=fake%40example.com&h=fake-signature',
      'application/pdf',
    );
    expect(mocks.removeFile).not.toHaveBeenCalled();
    expect(mocks.erase).toHaveBeenCalledWith({ id: 42 });
  });

  it('removes a non-PDF response and still erases its history entry', async () => {
    const mocks = installDownloads({ state: 'complete', mime: 'text/html' });
    await expect(
      createChromeArchiveIo().downloadUrl(
        'Fin-report-clipper Backup/BofA/2026/report/original.pdf',
        'https://rsch.baml.com/r?q=fake',
        'application/pdf',
      ),
    ).rejects.toThrow('Unexpected download MIME');
    expect(mocks.removeFile).toHaveBeenCalledWith(42);
    expect(mocks.erase).toHaveBeenCalledWith({ id: 42 });
  });

  it('removes an interrupted partial file and erases its history entry', async () => {
    const mocks = installDownloads({
      state: 'interrupted',
      error: 'SERVER_FORBIDDEN',
    });
    await expect(
      createChromeArchiveIo().downloadUrl(
        'Fin-report-clipper Backup/BofA/2026/report/original.pdf',
        'https://rsch.baml.com/r?q=fake',
        'application/pdf',
      ),
    ).rejects.toThrow('SERVER_FORBIDDEN');
    expect(mocks.removeFile).toHaveBeenCalledWith(42);
    expect(mocks.erase).toHaveBeenCalledWith({ id: 42 });
  });

  it('sweeps stale archive download history on background startup', async () => {
    const mocks = installDownloads({ state: 'complete', mime: 'application/pdf' });
    await eraseArchiveDownloadHistory();
    expect(mocks.erase).toHaveBeenCalledWith({
      filenameRegex: expect.stringContaining('Fin-report-clipper Backup'),
    });
  });
});
```

- [ ] **Step 3: 运行测试并确认归档写入器和 Chrome IO 不存在**

Run: `npm test -- tests/research/archive-writer.test.ts tests/research/chrome-archive-io.test.ts`

Expected: FAIL with missing `archive-writer` 或 `chrome-archive-io` module。

- [ ] **Step 4: 定义捕获、状态和 Offscreen 消息契约**

```ts
// utils/research/messages.ts
import type { CaptureSubmission, PageStatus } from './types';

export interface CaptureRequest {
  target: 'background';
  type: 'FIN_REPORT_CLIPPER_CAPTURE';
  submission: CaptureSubmission;
}

export interface GetPageStatusRequest {
  target: 'content';
  type: 'FIN_REPORT_CLIPPER_GET_PAGE_STATUS';
}

export interface GetPageStatusResponse {
  ok: true;
  status: PageStatus;
}

export interface CreateBlobRequest {
  target: 'offscreen';
  type: 'FIN_REPORT_CLIPPER_CREATE_BLOB';
  requestId: string;
  content: string;
  mime: string;
}

export interface RevokeBlobRequest {
  target: 'offscreen';
  type: 'FIN_REPORT_CLIPPER_REVOKE_BLOB';
  url: string;
}

export function isCaptureRequest(message: unknown): message is CaptureRequest {
  if (!message || typeof message !== 'object') return false;
  const value = message as Partial<CaptureRequest>;
  return (
    value.target === 'background' &&
    value.type === 'FIN_REPORT_CLIPPER_CAPTURE' &&
    Boolean(value.submission?.document)
  );
}

export function isGetPageStatusRequest(message: unknown): message is GetPageStatusRequest {
  if (!message || typeof message !== 'object') return false;
  const value = message as Partial<GetPageStatusRequest>;
  return (
    value.target === 'content' && value.type === 'FIN_REPORT_CLIPPER_GET_PAGE_STATUS'
  );
}
```

- [ ] **Step 5: 实现“清单最后写入”的纯归档事务**

```ts
// utils/research/archive-writer.ts
import { sha256Text } from './hash';
import { redactError } from './privacy';
import type { ArchivePlan, CaptureSubmission } from './types';

export interface ArchiveIo {
  writeText(path: string, content: string, mime: string): Promise<void>;
  downloadUrl(path: string, url: string, expectedMimePrefix?: string): Promise<void>;
  close(): Promise<void>;
}

export interface ArchiveWriteResult {
  status: 'complete' | 'partial';
  warnings: string[];
  files: string[];
}

function withCaptureStatus(
  markdown: string,
  status: ArchiveWriteResult['status'],
): string {
  const pattern = /^capture_status: (complete|partial)$/m;
  if (!pattern.test(markdown)) throw new Error('Markdown capture_status field is missing');
  return markdown.replace(pattern, `capture_status: ${status}`);
}

export async function writeArchive(
  plan: ArchivePlan,
  submission: CaptureSubmission,
  io: ArchiveIo,
): Promise<ArchiveWriteResult> {
  const markdown = submission.document.originalMarkdown;
  if (!markdown) throw new Error('HTML report has no original Markdown');

  const warnings: string[] = [];
  const expectsPdf = Boolean(plan.originalPdfPath);
  const files: Array<{
    path: string;
    role: 'original-markdown' | 'original-pdf';
    sha256?: string;
  }> = [];

  if (expectsPdf) {
    await io.writeText(
      plan.originalMarkdownPath,
      withCaptureStatus(markdown, 'partial'),
      'text/markdown;charset=utf-8',
    );
  }

  if (plan.originalPdfPath && submission.transientPdfUrl) {
    try {
      await io.downloadUrl(
        plan.originalPdfPath,
        submission.transientPdfUrl,
        'application/pdf',
      );
      files.push({ path: plan.originalPdfPath, role: 'original-pdf' });
    } catch (error) {
      warnings.push(`PDF download failed: ${redactError(error)}`);
    }
  } else if (plan.originalPdfPath) {
    warnings.push('PDF download failed: provider URL is unavailable');
  }

  const status = warnings.length ? 'partial' : 'complete';
  const finalMarkdown = withCaptureStatus(markdown, status);
  if (!expectsPdf || status === 'complete') {
    await io.writeText(
      plan.originalMarkdownPath,
      finalMarkdown,
      'text/markdown;charset=utf-8',
    );
  }
  files.unshift({
    path: plan.originalMarkdownPath,
    role: 'original-markdown',
    sha256: await sha256Text(finalMarkdown),
  });
  const manifest = {
    schema: 'fin-report-clipper/capture-v1',
    provider: submission.document.provider,
    ...(submission.document.sourceId ? { source_id: submission.document.sourceId } : {}),
    source_type: submission.document.sourceType,
    adapter_version: submission.adapterVersion,
    sanitized_source: submission.document.sanitizedSource,
    captured_at: submission.document.capturedAt,
    content_hash: submission.document.contentHash,
    capture_status: status,
    observed_metadata: submission.document.observedMetadata,
    files,
    warnings,
  };
  await io.writeText(
    plan.manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'application/json;charset=utf-8',
  );
  return { status, warnings, files: files.map((file) => file.path) };
}
```

- [ ] **Step 6: 创建 Offscreen 页面并只允许 Blob 创建/释放消息**

```html
<!-- entrypoints/offscreen/index.html -->
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Fin-report-clipper offscreen</title></head>
  <body><script type="module" src="./main.ts"></script></body>
</html>
```

```ts
// entrypoints/offscreen/main.ts
import type { CreateBlobRequest, RevokeBlobRequest } from '@/utils/research/messages';

const ownedUrls = new Set<string>();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;
  if (message.type === 'FIN_REPORT_CLIPPER_CREATE_BLOB') {
    const request = message as CreateBlobRequest;
    const url = URL.createObjectURL(new Blob([request.content], { type: request.mime }));
    ownedUrls.add(url);
    sendResponse({ ok: true, requestId: request.requestId, url });
    return false;
  }
  if (message.type === 'FIN_REPORT_CLIPPER_REVOKE_BLOB') {
    const request = message as RevokeBlobRequest;
    if (ownedUrls.delete(request.url)) URL.revokeObjectURL(request.url);
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
```

- [ ] **Step 7: 实现 Chrome Downloads IO，等待完成后才返回**

```ts
// utils/research/chrome-archive-io.ts
import type {
  CreateBlobRequest,
  RevokeBlobRequest,
} from './messages';
import type { ArchiveIo } from './archive-writer';

const OFFSCREEN_PATH = 'offscreen.html';
const ARCHIVE_FILENAME_RE = 'Fin-report-clipper Backup';
let creatingOffscreen: Promise<void> | null = null;

export async function eraseArchiveDownloadHistory(): Promise<void> {
  await chrome.downloads.erase({ filenameRegex: ARCHIVE_FILENAME_RE });
}

async function hasOffscreenDocument(): Promise<boolean> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [url],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['BLOBS'],
        justification: 'Create Blob URLs for large research Markdown downloads',
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

function interruptedReason(item: chrome.downloads.DownloadItem): string {
  return item.error || 'UNKNOWN_DOWNLOAD_ERROR';
}

async function waitForDownload(downloadId: number): Promise<chrome.downloads.DownloadItem> {
  return new Promise<chrome.downloads.DownloadItem>((resolve, reject) => {
    let settled = false;
    const finish = (item?: chrome.downloads.DownloadItem, error?: Error) => {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      if (error) reject(error);
      else if (item) resolve(item);
      else reject(new Error('Download item unavailable'));
    };
    const inspect = async () => {
      const [item] = await chrome.downloads.search({ id: downloadId });
      if (!item) return finish(undefined, new Error('Download item unavailable'));
      if (item.state === 'complete') return finish(item);
      if (item.state === 'interrupted') {
        return finish(undefined, new Error(`Download interrupted: ${interruptedReason(item)}`));
      }
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== downloadId || !delta.state?.current) return;
      void inspect().catch((error) =>
        finish(undefined, error instanceof Error ? error : new Error(String(error))),
      );
    };
    chrome.downloads.onChanged.addListener(onChanged);
    void inspect().catch((error) =>
      finish(undefined, error instanceof Error ? error : new Error(String(error))),
    );
  });
}

async function download(
  path: string,
  url: string,
  expectedMimePrefix?: string,
): Promise<void> {
  const downloadId = await chrome.downloads.download({
    url,
    filename: path,
    conflictAction: 'overwrite',
    saveAs: false,
  });
  try {
    const item = await waitForDownload(downloadId);
    if (
      expectedMimePrefix &&
      !item.mime?.toLowerCase().startsWith(expectedMimePrefix.toLowerCase())
    ) {
      throw new Error(`Unexpected download MIME: ${item.mime || 'unknown'}`);
    }
  } catch (error) {
    // 中断文件或错误登录页不得留在固定归档目录。
    await chrome.downloads.removeFile(downloadId).catch(() => {});
    throw error;
  } finally {
    // 清除 raw provider URL 的浏览器下载历史；文件本身保留在固定归档目录。
    await chrome.downloads.erase({ id: downloadId }).catch(() => {});
  }
}

async function createBlobUrl(content: string, mime: string): Promise<string> {
  await ensureOffscreenDocument();
  const request: CreateBlobRequest = {
    target: 'offscreen',
    type: 'FIN_REPORT_CLIPPER_CREATE_BLOB',
    requestId: crypto.randomUUID(),
    content,
    mime,
  };
  const response = (await chrome.runtime.sendMessage(request)) as
    | { ok: true; requestId: string; url: string }
    | undefined;
  if (!response?.ok || response.requestId !== request.requestId) {
    throw new Error('Offscreen Blob creation failed');
  }
  return response.url;
}

async function revokeBlobUrl(url: string): Promise<void> {
  const request: RevokeBlobRequest = {
    target: 'offscreen',
    type: 'FIN_REPORT_CLIPPER_REVOKE_BLOB',
    url,
  };
  await chrome.runtime.sendMessage(request);
}

export function createChromeArchiveIo(): ArchiveIo {
  return {
    async writeText(path, content, mime) {
      const url = await createBlobUrl(content, mime);
      try {
        await download(path, url);
      } finally {
        await revokeBlobUrl(url).catch(() => {});
      }
    },
    async downloadUrl(path, url, expectedMimePrefix) {
      await download(path, url, expectedMimePrefix);
    },
    async close() {
      if (await hasOffscreenDocument()) await chrome.offscreen.closeDocument();
    },
  };
}
```

- [ ] **Step 8: 运行归档事务与 Chrome IO 测试、类型检查和构建**

Run: `npm test -- tests/research/archive-writer.test.ts tests/research/chrome-archive-io.test.ts`

Expected: PASS，7 tests passed；Markdown 安全快照先落盘，有效 PDF 保留，非 PDF/中断文件删除，每个下载历史条目均清理，HTML-only 只写一次 Markdown，清单最后写入。

Run: `npm run compile && npm run build`

Expected: exit 0；`.output/chrome-mv3/offscreen.html` 存在，manifest 含 `offscreen` 与 `downloads` 权限。

- [ ] **Step 9: 提交 Downloads 归档基础**

```bash
git add utils/research/messages.ts utils/research/archive-writer.ts utils/research/chrome-archive-io.ts entrypoints/offscreen/index.html entrypoints/offscreen/main.ts tests/research/archive-writer.test.ts tests/research/chrome-archive-io.test.ts
git commit -m "feat: write research archives through Chrome downloads"
```

---

### Task 6: 串行捕获服务与 BofA 页面自动检测

**Files:**
- Create: `utils/research/capture-service.ts`
- Create: `utils/research/observe.ts`
- Create: `utils/research/status.ts`
- Replace: `entrypoints/background.ts`
- Replace: `entrypoints/content.ts`
- Create: `tests/research/capture-service.test.ts`
- Create: `tests/research/observe.test.ts`
- Create: `tests/research/status.test.ts`

**Interfaces:**
- Consumes: `resolveArchivePlan()`、`HistoryRepository`、`writeArchive()`、`createChromeArchiveIo()`、`bofaAdapter`、Task 5 消息类型。
- Produces: `createCaptureService()`、`waitForStablePage()`、`presentPageStatus()`，以及唯一的后台/内容脚本主流程。

- [ ] **Step 1: 写重复短路和全局串行捕获失败测试**

```ts
// tests/research/capture-service.test.ts
import { describe, expect, it } from 'vitest';
import { createCaptureService } from '@/utils/research/capture-service';
import type { CaptureSubmission } from '@/utils/research/types';

function submission(sourceId: string, hashChar: string): CaptureSubmission {
  return {
    adapterVersion: 'bofa-html-v1',
    document: {
      schema: 'fin-report-clipper/capture-v1',
      provider: 'BofA Global Research',
      sourceType: 'html',
      sourceId,
      title: sourceId,
      observedMetadata: {},
      originalMarkdown: `# ${sourceId}\n`,
      sanitizedSource: 'https://rsch.baml.com/r',
      capturedAt: '2026-07-17T16:30:00+09:00',
      contentHash: `sha256:${hashChar.repeat(64)}`,
      captureStatus: 'complete',
    },
  };
}

describe('capture service', () => {
  it('returns duplicate without constructing archive IO', async () => {
    const existing = submission('BOFA-1', 'a');
    let ioCreated = false;
    const history = {
      async load() {
        return [{
          identityKey: 'bofa:id:BOFA-1',
          contentHash: existing.document.contentHash,
          archivePath: 'Fin-report-clipper Backup/BofA/2026/existing',
          status: 'complete' as const,
          capturedAt: existing.document.capturedAt,
        }];
      },
      async upsert() {},
    };
    const service = createCaptureService({
      history,
      createIo() {
        ioCreated = true;
        throw new Error('must not create IO');
      },
    });
    await expect(service.submit(existing)).resolves.toEqual({
      status: 'duplicate',
      archivePath: 'Fin-report-clipper Backup/BofA/2026/existing',
    });
    expect(ioCreated).toBe(false);
  });

  it('does not overlap two capture writes', async () => {
    const events: string[] = [];
    const entries: any[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const service = createCaptureService({
      history: {
        async load() { return entries; },
        async upsert(entry) { entries.push(entry); },
      },
      createIo() {
        return { async writeText() {}, async downloadUrl() {}, async close() {} };
      },
      async write(plan, item) {
        events.push(`start:${item.document.sourceId}`);
        if (item.document.sourceId === 'BOFA-1') {
          markFirstStarted();
          await firstBlocked;
        }
        events.push(`end:${item.document.sourceId}`);
        return { status: 'complete' as const, warnings: [], files: [plan.originalMarkdownPath] };
      },
    });
    const first = service.submit(submission('BOFA-1', 'a'));
    const second = service.submit(submission('BOFA-2', 'b'));
    await firstStarted;
    expect(events).toEqual(['start:BOFA-1']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['start:BOFA-1', 'end:BOFA-1', 'start:BOFA-2', 'end:BOFA-2']);
  });

  it('reports partial after files are saved but local history cannot be updated', async () => {
    const service = createCaptureService({
      history: {
        async load() { return []; },
        async upsert() {
          throw new Error('quota error https://rsch.baml.com/r?q=fake-secret');
        },
      },
      createIo() {
        return { async writeText() {}, async downloadUrl() {}, async close() {} };
      },
      async write(plan) {
        return { status: 'complete', warnings: [], files: [plan.originalMarkdownPath] };
      },
    });
    const result = await service.submit(submission('BOFA-1', 'a'));
    expect(result.status).toBe('partial');
    if (result.status === 'partial') {
      expect(result.warnings[0]).toContain('History update failed');
      expect(result.warnings[0]).not.toContain('rsch.baml.com');
    }
  });
});
```

- [ ] **Step 2: 写有界稳定轮询和用户状态失败测试**

```ts
// tests/research/observe.test.ts
import { describe, expect, it } from 'vitest';
import { waitForStablePage } from '@/utils/research/observe';
import type { ReadinessEvidence } from '@/utils/research/types';

const ready: ReadinessEvidence = {
  kind: 'report-html',
  sourceId: 'BOFA-1',
  title: 'Report',
  bodyTextLength: 500,
  tableCount: 1,
  tailText: 'stable tail',
};

describe('page observation', () => {
  it('returns ready after three stable probes', async () => {
    let probes = 0;
    await expect(
      waitForStablePage({
        probe: () => { probes += 1; return ready; },
        sleep: async () => {},
        shouldContinue: () => true,
        maxAttempts: 5,
      }),
    ).resolves.toBe('ready');
    expect(probes).toBe(3);
  });

  it('stops immediately on auth evidence', async () => {
    await expect(
      waitForStablePage({
        probe: () => ({ ...ready, kind: 'auth-required' }),
        sleep: async () => {},
        shouldContinue: () => true,
        maxAttempts: 5,
      }),
    ).resolves.toBe('auth-required');
  });
});
```

```ts
// tests/research/status.test.ts
import { describe, expect, it } from 'vitest';
import { presentPageStatus } from '@/utils/research/status';

describe('user-facing report status', () => {
  it('collapses internal results into simple user states', () => {
    expect(presentPageStatus('saved').label).toBe('已保存');
    expect(presentPageStatus('duplicate').label).toBe('已保存');
    expect(presentPageStatus('partial').label).toBe('部分保存');
    expect(presentPageStatus('needs-action').label).toBe('需要处理');
  });
});
```

- [ ] **Step 3: 运行测试并确认服务与轮询模块不存在**

Run: `npm test -- tests/research/capture-service.test.ts tests/research/observe.test.ts tests/research/status.test.ts`

Expected: FAIL with missing modules。

- [ ] **Step 4: 实现全局串行捕获服务**

```ts
// utils/research/capture-service.ts
import { writeArchive, type ArchiveIo, type ArchiveWriteResult } from './archive-writer';
import type { HistoryRepository } from './history';
import { redactError } from './privacy';
import { resolveArchivePlan } from './path';
import type { ArchivePlan, CaptureResult, CaptureSubmission } from './types';

export interface CaptureServiceDependencies {
  history: HistoryRepository;
  createIo(): ArchiveIo;
  write?: (
    plan: ArchivePlan,
    submission: CaptureSubmission,
    io: ArchiveIo,
  ) => Promise<ArchiveWriteResult>;
}

export interface CaptureService {
  submit(submission: CaptureSubmission): Promise<CaptureResult>;
}

export function createCaptureService(dependencies: CaptureServiceDependencies): CaptureService {
  let serial: Promise<void> = Promise.resolve();
  const write = dependencies.write || writeArchive;

  async function process(submission: CaptureSubmission): Promise<CaptureResult> {
    try {
      const history = await dependencies.history.load();
      const resolution = await resolveArchivePlan(submission.document, history);
      if (resolution.kind === 'duplicate') {
        return { status: 'duplicate', archivePath: resolution.entry.archivePath };
      }

      const io = dependencies.createIo();
      let result: ArchiveWriteResult;
      try {
        result = await write(resolution.plan, submission, io);
      } finally {
        await io.close().catch(() => {});
      }
      try {
        await dependencies.history.upsert({
          identityKey: resolution.plan.identityKey,
          contentHash: submission.document.contentHash,
          archivePath: resolution.plan.archiveDir,
          status: result.status,
          capturedAt: submission.document.capturedAt,
        });
      } catch (error) {
        return {
          status: 'partial',
          archivePath: resolution.plan.archiveDir,
          warnings: [
            ...result.warnings,
            `History update failed: ${redactError(error)}`,
          ],
        };
      }
      return result.status === 'complete'
        ? { status: 'saved', archivePath: resolution.plan.archiveDir }
        : {
            status: 'partial',
            archivePath: resolution.plan.archiveDir,
            warnings: result.warnings,
          };
    } catch (error) {
      return { status: 'failed', reason: redactError(error) };
    }
  }

  return {
    submit(submission) {
      const task = serial.then(() => process(submission));
      serial = task.then(() => undefined, () => undefined);
      return task;
    },
  };
}
```

- [ ] **Step 5: 实现有界轮询与用户状态映射**

```ts
// utils/research/observe.ts
import { StableReadinessTracker } from './adapters/types';
import type { ReadinessEvidence } from './types';

export interface StablePageOptions {
  probe(): ReadinessEvidence;
  sleep(milliseconds: number): Promise<void>;
  shouldContinue(): boolean;
  maxAttempts?: number;
  intervalMs?: number;
}

export async function waitForStablePage(
  options: StablePageOptions,
): Promise<'ready' | 'auth-required' | 'timeout' | 'cancelled'> {
  const tracker = new StableReadinessTracker(3);
  const maxAttempts = options.maxAttempts ?? 30;
  const intervalMs = options.intervalMs ?? 1000;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!options.shouldContinue()) return 'cancelled';
    const evidence = options.probe();
    if (evidence.kind === 'auth-required') return 'auth-required';
    if (tracker.observe(evidence)) return 'ready';
    await options.sleep(intervalMs);
  }
  return 'timeout';
}
```

```ts
// utils/research/status.ts
import type { PageStatusCode } from './types';

export interface PresentedStatus {
  label: string;
  tone: 'neutral' | 'working' | 'success' | 'warning' | 'danger';
}

export function presentPageStatus(code: PageStatusCode): PresentedStatus {
  if (code === 'saved' || code === 'duplicate') return { label: '已保存', tone: 'success' };
  if (code === 'partial') return { label: '部分保存', tone: 'warning' };
  if (code === 'needs-action' || code === 'failed') {
    return { label: '需要处理', tone: 'danger' };
  }
  if (['waiting-ready', 'extracting', 'saving', 'observing'].includes(code)) {
    return { label: '正在保存', tone: 'working' };
  }
  if (code === 'disabled') return { label: '自动捕获已关闭', tone: 'neutral' };
  return { label: '未识别为支持的研报', tone: 'neutral' };
}
```

- [ ] **Step 6: 用研报捕获服务完全替换旧后台入口**

```ts
// entrypoints/background.ts
import {
  createChromeArchiveIo,
  eraseArchiveDownloadHistory,
} from '@/utils/research/chrome-archive-io';
import { createCaptureService } from '@/utils/research/capture-service';
import { createHistoryRepository } from '@/utils/research/history';
import { isCaptureRequest } from '@/utils/research/messages';

export default defineBackground(() => {
  // 补偿 service worker/Chrome 在 finally 前退出的情况；只清理下载记录，不删文件。
  void eraseArchiveDownloadHistory().catch(() => {});
  const service = createCaptureService({
    history: createHistoryRepository(),
    createIo: createChromeArchiveIo,
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isCaptureRequest(message)) return false;
    service.submit(message.submission).then(sendResponse);
    return true;
  });
});
```

- [ ] **Step 7: 用 BofA 自动检测完全替换旧内容脚本**

```ts
// entrypoints/content.ts
import { bofaAdapter } from '@/utils/research/adapters/bofa';
import {
  isGetPageStatusRequest,
  type CaptureRequest,
  type GetPageStatusResponse,
} from '@/utils/research/messages';
import { waitForStablePage } from '@/utils/research/observe';
import { redactError } from '@/utils/research/privacy';
import {
  RESEARCH_SETTINGS_KEY,
  isBofaAutoCaptureEnabled,
  loadResearchSettings,
} from '@/utils/research/settings';
import type { CaptureResult, PageStatus, PageStatusCode } from '@/utils/research/types';

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export default defineContentScript({
  matches: ['https://rsch.baml.com/*'],
  runAt: 'document_idle',
  main() {
    let generation = 0;
    let status: PageStatus = {
      code: 'observing',
      message: '正在识别当前研报页面',
      updatedAt: new Date().toISOString(),
    };

    const setStatus = (code: PageStatusCode, message: string, extra: Partial<PageStatus> = {}) => {
      status = { code, message, updatedAt: new Date().toISOString(), ...extra };
    };

    const applyResult = (result: CaptureResult, title?: string) => {
      if (result.status === 'saved') {
        setStatus('saved', '原始研报已保存', { title, archivePath: result.archivePath });
      } else if (result.status === 'duplicate') {
        setStatus('duplicate', '相同版本已保存，不重复下载', {
          title,
          archivePath: result.archivePath,
        });
      } else if (result.status === 'partial') {
        setStatus('partial', '已保存可用原始文件，但有文件未完成', {
          title,
          archivePath: result.archivePath,
        });
      } else {
        setStatus('failed', result.reason, { title });
      }
    };

    const run = async (runGeneration: number) => {
      const settings = await loadResearchSettings();
      if (runGeneration !== generation) return;
      if (!isBofaAutoCaptureEnabled(settings)) {
        setStatus('disabled', '自动捕获或 BofA 支持已关闭');
        return;
      }
      const url = new URL(location.href);
      const kind = bofaAdapter.classifyPage(document, url);
      if (kind === 'auth-required') {
        setStatus('needs-action', '页面需要登录、验证或人工处理');
        return;
      }
      if (kind !== 'report-html') {
        setStatus('unsupported', '当前页面不是已支持的 BofA HTML 研报');
        return;
      }

      setStatus('waiting-ready', '等待研报正文稳定');
      const readiness = await waitForStablePage({
        probe: () => bofaAdapter.readinessEvidence(document, new URL(location.href)),
        sleep,
        shouldContinue: () => runGeneration === generation,
      });
      if (runGeneration !== generation || readiness === 'cancelled') return;
      if (readiness === 'auth-required') {
        setStatus('needs-action', '页面需要登录、验证或人工处理');
        return;
      }
      if (readiness === 'timeout') {
        setStatus('needs-action', '研报正文在 30 秒内没有稳定，请检查页面加载状态');
        return;
      }

      setStatus('extracting', '正在转换原始研报正文');
      const submission = await bofaAdapter.extractOriginal(
        document,
        location.href,
        new Date().toISOString(),
      );
      if (runGeneration !== generation) return;
      setStatus('saving', '正在写入 Downloads 研报归档', {
        title: submission.document.title,
      });
      const request: CaptureRequest = {
        target: 'background',
        type: 'FIN_REPORT_CLIPPER_CAPTURE',
        submission,
      };
      const result = (await chrome.runtime.sendMessage(request)) as CaptureResult;
      if (runGeneration === generation) applyResult(result, submission.document.title);
    };

    const safelyRun = async (runGeneration: number) => {
      try {
        await run(runGeneration);
      } catch (error) {
        if (runGeneration === generation) {
          setStatus('failed', `保存失败：${redactError(error)}`);
        }
      }
    };

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!isGetPageStatusRequest(message)) return false;
      sendResponse({ ok: true, status } satisfies GetPageStatusResponse);
      return false;
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[RESEARCH_SETTINGS_KEY]) return;
      generation += 1;
      void safelyRun(generation);
    });

    generation += 1;
    void safelyRun(generation);
  },
});
```

- [ ] **Step 8: 运行服务、轮询和状态测试**

Run: `npm test -- tests/research/capture-service.test.ts tests/research/observe.test.ts tests/research/status.test.ts`

Expected: PASS，6 tests passed；历史索引写入失败不会把已经落盘的归档误报为完全失败。

Run: `npm run compile && npm run build`

Expected: exit 0；构建的 content script 只声明 `https://rsch.baml.com/*`。

- [ ] **Step 9: 提交自动捕获主链路**

```bash
git add utils/research/capture-service.ts utils/research/observe.ts utils/research/status.ts entrypoints/background.ts entrypoints/content.ts tests/research/capture-service.test.ts tests/research/observe.test.ts tests/research/status.test.ts
git commit -m "feat: auto-capture opened BofA reports"
```

---

### Task 7: 研报专用弹窗与旧普通剪藏实现清理

**Files:**
- Replace: `entrypoints/popup/App.tsx`
- Replace: `entrypoints/popup/style.css`
- Delete: `entrypoints/options/Options.tsx`
- Delete: `entrypoints/options/index.html`
- Delete: `entrypoints/options/main.tsx`
- Delete: `entrypoints/options/style.css`
- Delete: `utils/extract-core.ts`
- Delete: `utils/extractors/bilibili.ts`
- Delete: `utils/extractors/feishu.ts`
- Delete: `utils/extractors/generic.ts`
- Delete: `utils/extractors/index.ts`
- Delete: `utils/extractors/reddit.ts`
- Delete: `utils/extractors/weixin.ts`
- Delete: `utils/extractors/x.ts`
- Delete: `utils/extractors/xiaohongshu.ts`
- Delete: `utils/extractors/youtube.ts`
- Delete: `utils/feishu-api.ts`
- Delete: `utils/feishu/client.ts`
- Delete: `utils/feishu/oauth.ts`
- Delete: `utils/feishu/save-service.ts`
- Delete: `utils/feishu/wiki.ts`
- Delete: `utils/filename.ts`
- Delete: `utils/frontmatter.ts`
- Delete: `utils/highlighter.ts`
- Delete: `utils/hosts.ts`
- Delete: `utils/images.ts`
- Delete: `utils/messaging.ts`
- Delete: `utils/obsidian.ts`
- Delete: `utils/rest.ts`
- Delete: `utils/storage.ts`
- Delete: `utils/strings.ts`
- Delete: `utils/types.ts`
- Delete: `public/logo.png`
- Delete: `public/icon/*.png`
- Delete: `.github/assets/social-preview.png`
- Delete: `.github/assets/social-preview.svg`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/research/product-boundary.test.ts`

**Interfaces:**
- Consumes: `loadResearchSettings()`、`saveResearchSettings()`、`presentPageStatus()`、`GetPageStatusRequest`。
- Produces: 只包含研报状态和两个开关的 Chrome 弹窗；运行代码不再包含任何普通剪藏/Obsidian/飞书/高亮入口，也不再携带旧 ZJ 品牌资产。

- [ ] **Step 1: 写产品边界失败测试**

```ts
// tests/research/product-boundary.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('research-only product boundary', () => {
  it('has no options page or legacy feature modules', () => {
    const forbidden = [
      'entrypoints/options',
      'utils/extract-core.ts',
      'utils/extractors',
      'utils/feishu-api.ts',
      'utils/feishu',
      'utils/filename.ts',
      'utils/frontmatter.ts',
      'utils/highlighter.ts',
      'utils/hosts.ts',
      'utils/images.ts',
      'utils/messaging.ts',
      'utils/obsidian.ts',
      'utils/rest.ts',
      'utils/storage.ts',
      'utils/strings.ts',
      'utils/types.ts',
      'public/logo.png',
      'public/icon',
      '.github/assets/social-preview.png',
      '.github/assets/social-preview.svg',
    ];
    for (const path of forbidden) expect(existsSync(path), path).toBe(false);
  });

  it('does not ship legacy user-facing messages or Defuddle', () => {
    const runtimeSource = [
      readFileSync('entrypoints/background.ts', 'utf8'),
      readFileSync('entrypoints/content.ts', 'utf8'),
      readFileSync('entrypoints/popup/App.tsx', 'utf8'),
    ].join('\n');
    expect(runtimeSource).not.toMatch(/ZHAOJI_CLIPPER|Obsidian|飞书|高亮|普通网页剪藏/);
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies).not.toHaveProperty('defuddle');
  });
});
```

- [ ] **Step 2: 运行边界测试并确认旧功能仍存在**

Run: `npm test -- tests/research/product-boundary.test.ts`

Expected: FAIL；报告 `entrypoints/options`、旧模块或 `defuddle` 仍存在。

- [ ] **Step 3: 用最小研报状态弹窗替换旧 App**

```tsx
// entrypoints/popup/App.tsx
import { useCallback, useEffect, useState } from 'react';
import type {
  GetPageStatusRequest,
  GetPageStatusResponse,
} from '@/utils/research/messages';
import {
  DEFAULT_RESEARCH_SETTINGS,
  loadResearchSettings,
  saveResearchSettings,
  type ResearchSettings,
} from '@/utils/research/settings';
import { presentPageStatus } from '@/utils/research/status';
import type { PageStatus } from '@/utils/research/types';

const BACKUP_LABEL = 'Downloads/Fin-report-clipper Backup/';
const unsupportedStatus: PageStatus = {
  code: 'unsupported',
  message: '当前页面不是已支持的 BofA 研报',
  updatedAt: new Date().toISOString(),
};

async function readCurrentPageStatus(): Promise<PageStatus> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return unsupportedStatus;
  const request: GetPageStatusRequest = {
    target: 'content',
    type: 'FIN_REPORT_CLIPPER_GET_PAGE_STATUS',
  };
  try {
    const response = (await chrome.tabs.sendMessage(tab.id, request)) as
      | GetPageStatusResponse
      | undefined;
    return response?.ok ? response.status : unsupportedStatus;
  } catch {
    return unsupportedStatus;
  }
}

export function App() {
  const [settings, setSettings] = useState<ResearchSettings>(DEFAULT_RESEARCH_SETTINGS);
  const [status, setStatus] = useState<PageStatus>({
    code: 'observing',
    message: '正在读取当前页面状态',
    updatedAt: new Date().toISOString(),
  });

  const refreshStatus = useCallback(async () => {
    setStatus(await readCurrentPageStatus());
  }, []);

  useEffect(() => {
    let active = true;
    void loadResearchSettings().then((value) => {
      if (active) setSettings(value);
    });
    void refreshStatus();
    const timer = window.setInterval(refreshStatus, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refreshStatus]);

  const update = async (next: ResearchSettings) => {
    setSettings(next);
    await saveResearchSettings(next);
    await refreshStatus();
  };

  const presented = presentPageStatus(status.code);
  return (
    <main className="frc-popup">
      <header className="frc-header">
        <div>
          <h1>Fin-report-clipper</h1>
          <p>Chrome 研报自动归档</p>
        </div>
      </header>

      <section className={`frc-status frc-status-${presented.tone}`}>
        <strong>{presented.label}</strong>
        <span>{status.message}</span>
        {status.title && <small>{status.title}</small>}
        {status.archivePath && <code>{status.archivePath}</code>}
      </section>

      <section className="frc-settings" aria-label="自动捕获设置">
        <label>
          <span><strong>自动捕获</strong><small>打开受支持研报后自动保存</small></span>
          <input
            type="checkbox"
            checked={settings.autoCapture}
            onChange={(event) => void update({ ...settings, autoCapture: event.target.checked })}
          />
        </label>
        <label>
          <span><strong>BofA Global Research</strong><small>阶段 1 唯一支持机构</small></span>
          <input
            type="checkbox"
            checked={settings.providers.bofa}
            onChange={(event) =>
              void update({
                ...settings,
                providers: { ...settings.providers, bofa: event.target.checked },
              })
            }
          />
        </label>
      </section>

      <footer>
        <span>固定备份位置</span>
        <code>{BACKUP_LABEL}</code>
      </footer>
    </main>
  );
}
```

- [ ] **Step 4: 用完整的小型样式表替换旧剪藏弹窗样式**

```css
/* entrypoints/popup/style.css */
:root {
  color-scheme: light dark;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f5f7fa;
  color: #142033;
}

* { box-sizing: border-box; }
body { margin: 0; background: #f5f7fa; }

.frc-popup {
  width: 380px;
  padding: 16px;
  display: grid;
  gap: 14px;
}

.frc-header { display: flex; align-items: center; gap: 10px; }
.frc-header h1 { margin: 0; font-size: 18px; }
.frc-header p { margin: 2px 0 0; color: #687386; font-size: 12px; }

.frc-status {
  display: grid;
  gap: 5px;
  padding: 12px;
  border: 1px solid #dce2ea;
  border-left-width: 4px;
  border-radius: 9px;
  background: #fff;
}
.frc-status span, .frc-status small { color: #5e6a7d; }
.frc-status code, footer code {
  overflow-wrap: anywhere;
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.frc-status-success { border-left-color: #25875a; }
.frc-status-warning { border-left-color: #bd7a00; }
.frc-status-danger { border-left-color: #c43d3d; }
.frc-status-working { border-left-color: #356ad8; }
.frc-status-neutral { border-left-color: #8994a6; }

.frc-settings {
  overflow: hidden;
  border: 1px solid #dce2ea;
  border-radius: 9px;
  background: #fff;
}
.frc-settings label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 12px;
  border-bottom: 1px solid #edf0f4;
}
.frc-settings label:last-child { border-bottom: 0; }
.frc-settings label span { display: grid; gap: 3px; }
.frc-settings small { color: #687386; }
.frc-settings input { width: 18px; height: 18px; accent-color: #235bc1; }

footer { display: grid; gap: 4px; color: #687386; font-size: 12px; }

@media (prefers-color-scheme: dark) {
  :root, body { background: #161a21; color: #edf1f7; }
  .frc-header p, .frc-status span, .frc-status small, .frc-settings small, footer {
    color: #9ca7b8;
  }
  .frc-status, .frc-settings { background: #202631; border-color: #343d4b; }
  .frc-settings label { border-color: #303845; }
}
```

- [ ] **Step 5: 删除不再属于产品的旧入口、模块和品牌资产**

Run:

```bash
git rm -r entrypoints/options utils/extractors utils/feishu
git rm -r public/icon .github/assets
git rm utils/extract-core.ts utils/feishu-api.ts utils/filename.ts utils/frontmatter.ts utils/highlighter.ts utils/hosts.ts utils/images.ts utils/messaging.ts utils/obsidian.ts utils/rest.ts utils/storage.ts utils/strings.ts utils/types.ts
git rm public/logo.png
npm uninstall defuddle
```

Expected: 删除列表与本 Task 的 Files 完全一致；`package.json` 和 `package-lock.json` 不再包含 `defuddle`。

- [ ] **Step 6: 运行产品边界和全部单元测试**

Run: `npm test`

Expected: PASS；所有 tests passed。

Run: `npm run compile && npm run build`

Expected: exit 0；构建产物中没有 `options.html`。

- [ ] **Step 7: 检查运行入口没有旧产品术语**

Run: `rg -n "ZHAOJI_CLIPPER|Obsidian|飞书|高亮|<all_urls>" entrypoints wxt.config.ts utils/research`

Expected: no matches，退出码 1。

- [ ] **Step 8: 提交研报专用产品清理**

```bash
git add entrypoints/popup/App.tsx entrypoints/popup/style.css package.json package-lock.json tests/research/product-boundary.test.ts
git commit -m "refactor: remove generic clipping product surfaces"
```

---

### Task 8: Chrome-only CI、manifest 断言与发布包命名

**Files:**
- Modify: `package.json`
- Create: `scripts/check-content-ascii.mjs`
- Create: `scripts/check-manifest.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/pull_request_template.md`
- Modify: `.github/dependabot.yml`
- Create: `tests/research/release-config.test.ts`

**Interfaces:**
- Consumes: Task 1 的 Chrome manifest 与 Task 7 的 research-only runtime。
- Produces: `npm run verify` 单一验证入口、只构建 Chrome 的 CI、`fin-report-clipper-chrome.zip` 固定发布别名。

- [ ] **Step 1: 写 Chrome-only CI/发布失败测试**

```ts
// tests/research/release-config.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Chrome-only automation', () => {
  it('runs the full verification command in CI without Edge or Firefox', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toContain('npm run verify');
    expect(ci).not.toMatch(/build:edge|build:firefox|edge-mv3|firefox/);
  });

  it('publishes the exact Chrome archive names', () => {
    const release = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(release).toContain('fin-report-clipper-${GITHUB_REF_NAME#v}-chrome.zip');
    expect(release).toContain('fin-report-clipper-chrome.zip');
    expect(release).not.toContain('zhaoji-clipper');
    expect(release).not.toMatch(/zip:edge|edge\.zip/);
  });
});
```

- [ ] **Step 2: 运行测试并确认旧双浏览器流程失败**

Run: `npm test -- tests/research/release-config.test.ts`

Expected: FAIL；旧 CI 含 `build:edge`，旧发布流程含 `zhaoji-clipper` 和 Edge 包。

- [ ] **Step 3: 增加可重复使用的内容脚本 ASCII 检查**

```js
// scripts/check-content-ascii.mjs
import { readFileSync } from 'node:fs';

const path = '.output/chrome-mv3/content-scripts/content.js';
const bytes = readFileSync(path);
const index = bytes.findIndex((byte) => byte > 0x7f);
if (index >= 0) {
  throw new Error(`${path} contains a non-ASCII byte at offset ${index}`);
}
console.log(`${path}: ASCII only`);
```

- [ ] **Step 4: 增加构建后 manifest 精确断言**

```js
// scripts/check-manifest.mjs
import { readFileSync } from 'node:fs';

const path = '.output/chrome-mv3/manifest.json';
const manifest = JSON.parse(readFileSync(path, 'utf8'));
const expectedPermissions = ['downloads', 'offscreen', 'storage'].sort();
const actualPermissions = [...(manifest.permissions || [])].sort();

if (manifest.name !== 'Fin-report-clipper') throw new Error('Unexpected extension name');
if (manifest.minimum_chrome_version !== '116') throw new Error('Unexpected Chrome floor');
if (JSON.stringify(actualPermissions) !== JSON.stringify(expectedPermissions)) {
  throw new Error(`Unexpected permissions: ${actualPermissions.join(',')}`);
}
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(['https://rsch.baml.com/*'])) {
  throw new Error('Unexpected host permissions');
}
const matches = manifest.content_scripts?.flatMap((script) => script.matches || []) || [];
if (JSON.stringify(matches) !== JSON.stringify(['https://rsch.baml.com/*'])) {
  throw new Error(`Unexpected content-script matches: ${matches.join(',')}`);
}
const serialized = JSON.stringify(manifest);
for (const forbidden of [
  '<all_urls>',
  'identity',
  'contextMenus',
  'options_page',
  'options_ui',
  'commands',
]) {
  if (serialized.includes(forbidden)) throw new Error(`Forbidden manifest capability: ${forbidden}`);
}
console.log(`${path}: Fin-report-clipper Chrome manifest verified`);
```

- [ ] **Step 5: 建立单一 verify 命令**

把 `package.json` scripts 扩展为以下精确内容：

```json
{
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "compile": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "check:ascii": "node scripts/check-content-ascii.mjs",
    "check:manifest": "node scripts/check-manifest.mjs",
    "verify": "npm test && npm run compile && npm run build && npm run check:ascii && npm run check:manifest",
    "postinstall": "wxt prepare"
  }
}
```

- [ ] **Step 6: 将 CI 收敛为 Chrome 研报验证**

`.github/workflows/ci.yml` 使用以下完整内容：

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  validate:
    name: Validate Chrome research capture
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - name: Setup Node.js
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 20
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Audit production dependencies
        run: npm audit --omit=dev --audit-level=high
      - name: Reject critical development vulnerabilities
        run: npm audit --audit-level=critical
      - name: Verify Fin-report-clipper
        run: npm run verify
```

- [ ] **Step 7: 将 Release 收敛为两个 Chrome 资产**

`.github/workflows/release.yml` 使用以下完整内容：

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: write

jobs:
  release:
    name: Build and publish Chrome research extension
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0

      - name: Setup Node.js
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 20
          cache: npm

      - name: Verify tag matches package version
        shell: bash
        run: |
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          PACKAGE_VERSION="$(node -p "require('./package.json').version")"
          if [[ "$TAG_VERSION" != "$PACKAGE_VERSION" ]]; then
            echo "Tag version $TAG_VERSION does not match package.json $PACKAGE_VERSION"
            exit 1
          fi

      - name: Install dependencies
        run: npm ci

      - name: Audit production dependencies
        run: npm audit --omit=dev --audit-level=high

      - name: Reject critical development vulnerabilities
        run: npm audit --audit-level=critical

      - name: Verify release build
        run: npm run verify

      - name: Build Chrome release archive
        run: npm run zip

      - name: Create stable latest alias
        shell: bash
        run: |
          cp ".output/fin-report-clipper-${GITHUB_REF_NAME#v}-chrome.zip" \
            ".output/fin-report-clipper-chrome.zip"

      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        shell: bash
        run: |
          NOTES_FILE="RELEASE_NOTES_${GITHUB_REF_NAME}.md"
          ASSETS=(
            ".output/fin-report-clipper-${GITHUB_REF_NAME#v}-chrome.zip"
            ".output/fin-report-clipper-chrome.zip"
          )
          if gh release view "$GITHUB_REF_NAME" >/dev/null 2>&1; then
            echo "Release $GITHUB_REF_NAME already exists; refusing to overwrite immutable assets."
            exit 1
          elif [[ -f "$NOTES_FILE" ]]; then
            gh release create "$GITHUB_REF_NAME" "${ASSETS[@]}" \
              --title "Fin-report-clipper ${GITHUB_REF_NAME#v}" \
              --notes-file "$NOTES_FILE"
          else
            gh release create "$GITHUB_REF_NAME" "${ASSETS[@]}" \
              --title "Fin-report-clipper ${GITHUB_REF_NAME#v}" \
              --generate-notes
          fi
```

- [ ] **Step 8: 更新 PR 与依赖配置**

`.github/pull_request_template.md` 使用以下完整内容：

```markdown
## 改了什么

<!-- 说明本次研报捕获、适配器、界面或文档变化。 -->

## 为什么改

<!-- 说明它解决的用户问题以及明确不包含的范围。 -->

## 验证

- [ ] `npm run verify`
- [ ] 若修改 BofA 适配器，已用脱敏固定样本验证
- [ ] 若影响真实捕获，已在正常可见 Chrome 中验证并检查 Downloads 归档
- [ ] 输出、界面和错误没有个性化 URL、访问链接携带的用户邮箱、令牌或签名

## 产品边界

- [ ] 没有引入普通网页剪藏、Obsidian/飞书、高亮或旧设置迁移
- [ ] 没有扩大 host、权限、自动化并发或页面发现范围

## 发布影响

- [ ] 不需要发布新版本
- [ ] Patch：修复问题，例如 `0.1.1`
- [ ] Minor：向后兼容的研报能力，例如 `0.2.0`
- [ ] Major：不兼容的数据或工作流变化，例如 `1.0.0`
- [ ] 发布前已确认 `LICENSE` 要求的版权方书面授权
```

`.github/dependabot.yml` 使用以下完整内容：

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: monthly
    open-pull-requests-limit: 5
    ignore:
      # 这些大版本目前会破坏 WXT 0.19 构建或内容脚本 ASCII 约束。
      # 升级前需要单独建立兼容分支并完成 docs/TESTING.md 回归。
      - dependency-name: wxt
        versions: [">= 0.20.0"]
      - dependency-name: typescript
        versions: [">= 6.0.0"]
      - dependency-name: react
        versions: [">= 19.0.0"]
      - dependency-name: react-dom
        versions: [">= 19.0.0"]
      - dependency-name: "@types/react"
        versions: [">= 19.0.0"]
      - dependency-name: "@types/react-dom"
        versions: [">= 19.0.0"]

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
    open-pull-requests-limit: 5
```

- [ ] **Step 9: 运行新自动化门**

Run: `npm test -- tests/research/release-config.test.ts`

Expected: PASS，2 tests passed。

Run: `npm run verify`

Expected: 所有测试通过、TypeScript exit 0、Chrome build exit 0、最后两行分别包含 `ASCII only` 与 `Chrome manifest verified`。

- [ ] **Step 10: 提交 Chrome-only 自动化**

```bash
git add package.json scripts/check-content-ascii.mjs scripts/check-manifest.mjs .github/workflows/ci.yml .github/workflows/release.yml .github/pull_request_template.md .github/dependabot.yml tests/research/release-config.test.ts
git commit -m "ci: validate Chrome research capture"
```

---

### Task 9: 中文产品文档与真实 Chrome 阶段 1 验收

**Files:**
- Replace: `README.md`
- Replace: `DEVELOPMENT.md`
- Replace: `PRIVACY.md`
- Modify: `SECURITY.md`
- Replace: `CHANGELOG.md`
- Replace: `docs/TESTING.md`
- Delete: `docs/test-reports/v4.0.2-browser-smoke.md`

**Interfaces:**
- Consumes: 前 8 个 Task 的实际命令、文件布局和产品边界。
- Produces: 与实现一致的中文用户/开发/隐私/测试说明，以及阶段 1 的真实浏览器验收结论。

- [ ] **Step 1: 将 README 重写为研报专用产品说明**

`README.md` 必须按以下顺序包含完整内容，不保留 ZJ-clipper、普通网页剪藏、Edge、Obsidian 或飞书说明：

````markdown
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
````

- [ ] **Step 2: 将开发文档重写为当前真实架构**

`DEVELOPMENT.md` 使用以下完整内容：

````markdown
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
````

- [ ] **Step 3: 重写隐私、安全与版本说明**

`PRIVACY.md` 使用以下完整事实边界：

```markdown
# Fin-report-clipper 隐私说明

Fin-report-clipper 不提供开发者云端服务，也不收集或上传研报正文。阶段 1 只在 `https://rsch.baml.com/*` 运行内容脚本。

扩展使用 `chrome.storage.local` 保存自动捕获开关和本机去重历史；键名以 `fin_report_clipper_*` 开头。扩展不读取 ZJ-clipper 数据，也不使用浏览器同步存储。

研报文件通过 Chrome Downloads API 写入 `Downloads/Fin-report-clipper Backup/`。页面原始 URL 和 PDF 下载 URL 可能包含用户邮箱、令牌或签名，只允许在当前未完成事务中短暂使用；归档、Markdown、界面和错误只保留脱敏来源。研报正文明确披露的公开分析师联系方式作为来源内容保留。每次下载完成或中断后，扩展会清除对应 Chrome 下载历史；后台再次启动时会补扫固定归档目录的遗留记录，已经成功落盘的文件不会因此删除。

原始 HTML 不归档。HTML 正文转换为 Markdown；页面提供的 PDF 原样下载。捕获阶段不调用 AI、OCR、Obsidian、飞书或其他远程知识库。

如发现隐私或安全问题，请使用仓库的私密漏洞报告，不要在公开 Issue、PR、日志或测试样本中粘贴真实研报 URL、邮箱、令牌、签名、HTML 或 PDF。
```

`SECURITY.md` 使用以下完整内容；`LICENSE` 保持不变：

```markdown
# Security Policy

## Supported version

Security fixes apply to the latest authorized Fin-report-clipper release.

## Reporting a vulnerability

Use the repository's private vulnerability reporting. Do not put research URLs, report HTML/PDF, email addresses, tokens, signatures, credentials, or private documents in public issues or pull requests. Revoke exposed credentials before sharing sanitized technical details.

## Research artifact handling

Only synthetic sanitized fixtures belong in the repository. Real BofA files remain outside the repository and must not be copied into logs, test reports, commits, or release assets.

## Development toolchain

Production dependencies must pass `npm audit --omit=dev --audit-level=high`; critical development dependency findings are blocked. `npm run verify` is required before an authorized release.

## License boundary

The existing `LICENSE` remains authoritative. A release or redistribution must not proceed without the copyright holder authorization required by that license.
```

把 `CHANGELOG.md` 重写为：

```markdown
# Changelog

## v0.1.0 - 2026-07-17

- 将产品独立为 Chrome-only 的 Fin-report-clipper。
- 增加 BofA HTML 研报自动识别、忠实 Markdown 和原始 PDF 归档。
- 增加 URL 脱敏、SHA-256 去重、修订保留、部分成功和最后清单。
- 固定备份根目录为 `Downloads/Fin-report-clipper Backup/`。
- 移除普通网页剪藏、Obsidian、飞书、高亮、旧设置迁移和非研报适配器。
```

- [ ] **Step 4: 把 docs/TESTING.md 重写为阶段 1 验收清单**

`docs/TESTING.md` 使用以下完整内容：

````markdown
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
````

Run: `git rm docs/test-reports/v4.0.2-browser-smoke.md`

原因：该文件只证明旧 ZJ-clipper/Edge 产品状态，不能作为新产品证据。

- [ ] **Step 5: 运行最终自动验证**

Run: `npm ci`

Expected: exit 0；`git status --short` 不因安装产生额外 diff。

Run: `npm run verify`

Expected: 全部单元测试通过、TypeScript exit 0、Chrome build exit 0、ASCII 与 manifest 检查通过。

Run: `npm run zip`

Expected: `.output/fin-report-clipper-0.1.0-chrome.zip` 存在。

- [ ] **Step 6: 在正常可见 Chrome 中执行真实 BofA 验收**

严格按以下顺序执行，不使用 Playwright、无头浏览器或 CDP：

1. 在 `chrome://extensions` 加载 `.output/chrome-mv3`。
2. 打开扩展弹窗，确认只有“自动捕获”“BofA Global Research”和固定备份位置；不存在普通剪藏、Obsidian、飞书或高亮。
3. 确认两个开关开启。
4. 使用用户已经提供、当前仍可访问的 BofA 研报链接，在正常登录 Chrome 中手动打开；不要把完整 URL复制到终端、截图说明或测试记录。
5. 等待弹窗显示“已保存”，确认原标签页仍然打开。
6. 在 `/Users/xiaoyuliu/Downloads/Fin-report-clipper Backup/` 找到新目录；确认 `original.md`、`original.pdf`、`.fin-report-clipper/capture.json` 存在，且清单修改时间不早于两个原始文件；单元测试必须同时证明调用顺序中清单最后。打开 `chrome://downloads`，确认本次带签名的 BofA 下载条目已被清理，而归档文件仍在。
7. 检查 Markdown 至少包含标题、正文首节、一个表格/展品和披露尾部；不得出现自动摘要或 tags。
8. 再次打开同一研报，确认弹窗仍显示“已保存”并说明为重复版本，Downloads 不新增第二个完整目录。
9. 打开一个普通网页，确认没有 Fin-report-clipper 内容脚本、没有下载行为，弹窗显示“未识别为支持的研报”。
10. 如能安全制造 PDF 下载失败，只允许观察到“部分保存”；不得删除已写入的 `original.md`。

验收中任何一项失败都不能把阶段 1 标记为完成；先记录脱敏症状并回到对应 Task 的失败测试。

- [ ] **Step 7: 扫描真实归档中的敏感 URL 和访问身份值**

Run:

```bash
rg -ni --glob 'original.md' --glob 'capture.json' '(https?://rsch\.baml\.com/[^ ]*\?)|(https?://[^ ]*[?&](auth|email|key|sig|signature|token)=)' '/Users/xiaoyuliu/Downloads/Fin-report-clipper Backup'
```

Expected: no matches，退出码 1。另用编辑器在本次归档中搜索访问链接携带的用户邮箱，确认无匹配；不要把真实邮箱写入命令历史或测试记录。来源正文明确提供的公开分析师邮箱允许保留。

- [ ] **Step 8: 确认仓库没有原始样本或旧产品运行代码**

Run: `find . -type f -size +5M -not -path './.git/*' -not -path './.output/*'`

Expected: 不出现用户提供的 BofA HTML/PDF 或 `_files` 资源目录。

Run: `rg -n "ZHAOJI_CLIPPER|zhaoji_clipper_|jicun_|Obsidian|飞书|<all_urls>" entrypoints utils wxt.config.ts package.json`

Expected: no matches，退出码 1。

- [ ] **Step 9: 提交中文产品文档**

```bash
git add README.md DEVELOPMENT.md PRIVACY.md SECURITY.md CHANGELOG.md docs/TESTING.md
git commit -m "docs: document Fin-report-clipper phase 1"
```

---

## 最终完成定义

只有同时满足以下条件，阶段 1 才能宣告完成：

- `npm run verify` 全绿，Chrome zip 可生成。
- 构建 manifest 只有 BofA host 和最小三项权限，普通网页不注入。
- 真实 BofA 页面在正常可见 Chrome 中自动保存 Markdown，并在页面提供 PDF 时保存 PDF。
- 重复版本不新增归档；同一来源 ID、不同正文哈希的单元测试保存为修订版。
- `capture.json` 始终在原始文件之后写入；PDF 失败保留 Markdown 并标记部分成功。
- 真实归档和构建产物通过访问链接用户身份值/敏感查询参数检查，同时保留来源正文公开联系方式。
- 完成、中断或后台重启后，Chrome 下载历史不保留固定归档目录中的带签名下载条目，成功文件仍保留。
- 用户手动打开的标签页保持打开。
- UI、文档和运行代码不再出现普通剪藏、Obsidian、飞书、高亮、旧设置迁移或 Edge/Firefox 产品入口。
