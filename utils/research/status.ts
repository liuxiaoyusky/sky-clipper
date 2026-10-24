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
  return { label: '当前页面暂不支持', tone: 'neutral' };
}
