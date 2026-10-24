import { it, expect, vi } from 'vitest';
import { normalizeResearchSettings } from '@/utils/research/settings';
import { readPageStatus } from '@/entrypoints/popup/model';
it('preserves existing preferences and defaults the new Bilibili switch on',()=>{
 const settings=normalizeResearchSettings({autoCapture:false,socialAutoCapture:false,providers:{bofa:false,x:false,wechat:false}});
 expect(settings.providers).toMatchObject({bofa:false,x:false,wechat:false,bilibili:true});
 expect(settings.socialAutoCapture).toBe(false);
 expect(normalizeResearchSettings({providers:{bilibili:false}}).providers).toMatchObject({bilibili:false});
});
it('shows the current Bilibili capture state for a specific part',async()=>{
 const status={code:'partial' as const,message:'暂无字幕',updatedAt:'2026-10-24T00:00:00Z'};
 const sendToTab=vi.fn(async()=>({ok:true as const,status}));
 expect(await readPageStatus({queryActiveTab:async()=>[{id:1,url:'https://www.bilibili.com/video/BV1CTJ26XE24/?p=2'}],sendToTab})).toEqual(status);
});
