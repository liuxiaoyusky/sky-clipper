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
