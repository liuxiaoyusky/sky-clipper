import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}{{modeSuffix}}',
  vite: () => ({
    esbuild: { charset: 'ascii' },
  }),
  manifest: {
    name: '自动保存版本',
    description: '自动保存研报、X、公众号原文图片与 B站平台字幕',
    default_locale: undefined,
    minimum_chrome_version: '116',
    permissions: ['alarms', 'downloads', 'offscreen', 'storage'],
    host_permissions: ['https://rsch.baml.com/*', 'https://markets.ml.com/*', 'https://x.com/*', 'https://twitter.com/*', 'https://pbs.twimg.com/*', 'https://mp.weixin.qq.com/*', 'https://mmbiz.qpic.cn/*', 'https://mmbiz.qlogo.cn/*', 'https://www.bilibili.com/*', 'https://api.bilibili.com/*', 'https://aisubtitle.hdslb.com/*', 'https://i0.hdslb.com/*', 'https://i1.hdslb.com/*', 'https://i2.hdslb.com/*'],
    action: {
      default_title: '自动保存版本：捕获状态',
    },
  },
});
