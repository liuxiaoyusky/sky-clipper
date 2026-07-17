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
