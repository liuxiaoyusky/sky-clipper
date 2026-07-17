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
