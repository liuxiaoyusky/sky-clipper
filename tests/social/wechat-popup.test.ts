import { it,expect,vi } from 'vitest';
import { readPageStatus } from '@/entrypoints/popup/model';
it('displays the real WeChat capture state instead of unsupported',async()=>{
 const status={code:'partial' as const,message:'图片未下载',updatedAt:'2026-10-20T00:00:00Z'};
 const sendToTab=vi.fn(async()=>({ok:true as const,status}));
 expect(await readPageStatus({queryActiveTab:async()=>[{id:7,url:'https://mp.weixin.qq.com/s/offline-fixture?scene=1'}],sendToTab})).toEqual(status);
 expect(sendToTab).toHaveBeenCalledExactlyOnceWith(7);
});
it('does not send capture status requests to unrelated WeChat endpoints',async()=>{
 const sendToTab=vi.fn();
 expect(await readPageStatus({queryActiveTab:async()=>[{id:7,url:'https://mp.weixin.qq.com/mp/profile'}],sendToTab})).toMatchObject({code:'unsupported'});
 expect(sendToTab).not.toHaveBeenCalled();
});
