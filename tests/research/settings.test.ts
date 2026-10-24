import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESEARCH_SETTINGS,
  normalizeResearchSettings,
  isBofaAutoCaptureEnabled,
  isXAutoCaptureEnabled,
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
    ).toEqual({ autoCapture: false, socialAutoCapture: true, providers: { bofa: false, x: true, wechat: true, bilibili: true } });
  });
});

 it('分类与站点同时开启才保存，彼此不影响', () => {
   const settings = normalizeResearchSettings({autoCapture:false, socialAutoCapture:true, providers:{bofa:true,x:true}});
   expect(isBofaAutoCaptureEnabled(settings)).toBe(false);
   expect(isXAutoCaptureEnabled(settings)).toBe(true);
   expect(isXAutoCaptureEnabled({...settings,socialAutoCapture:false})).toBe(false);
   expect(isXAutoCaptureEnabled({...settings,providers:{...settings.providers,x:false}})).toBe(false);
 });
