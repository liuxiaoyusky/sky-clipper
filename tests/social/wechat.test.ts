import { describe, expect, it } from 'vitest';
import { canonicalWechatUrl, wechatImageUrl, extractWechatDocument, isWechatCaptureRequest } from '@/utils/social/wechat';

// Entirely synthetic article. No original article or live media is requested.
const url = 'https://mp.weixin.qq.com/s/offline-fixture-01?scene=1&key=private-token#rd';
const image = 'https://mmbiz.qpic.cn/mmbiz_png/fixture-one/640?wx_fmt=png';
function page(body = '<p>第一段 <strong>重点</strong></p><p>最后一段。</p>') {
  document.body.innerHTML = `<h1 id="activity-name">本地测试文章</h1><span id="js_name">测试公众号</span><em id="publish_time">2026年10月20日 09:30</em><div id="js_content">${body}</div><aside>相关推荐不要保存</aside>`;
  return extractWechatDocument(document, url);
}

describe('WeChat synthetic article capture', () => {
  it('normalizes short article URLs and strips session and tracking parameters', () => {
    expect(canonicalWechatUrl(url)).toBe('https://mp.weixin.qq.com/s/offline-fixture-01');
    for (const bad of ['https://mp.weixin.qq.com/', 'https://mp.weixin.qq.com/s', 'https://mp.weixin.qq.com/mp/profile', 'https://mp.weixin.qq.com.evil/s/abc', 'http://mp.weixin.qq.com/s/abc', 'https://user:pass@mp.weixin.qq.com/s/abc']) expect(canonicalWechatUrl(bad)).toBeNull();
  });
  it('preserves only stable identity for query-style articles', () => {
    const canonical = 'https://mp.weixin.qq.com/s?__biz=MzTEST%3D%3D&mid=123456&idx=1&sn=0123456789abcdef0123456789abcdef';
    expect(canonicalWechatUrl(canonical + '&pass_ticket=secret&scene=2')).toBe(canonical);
    expect(canonicalWechatUrl(canonical + '&mid=999')).toBeNull();
  });
  it('captures article body and metadata, keeping paragraph and heading order', () => {
    const d = page('<p>第一段</p><h2>小标题</h2><p>最后一段</p>')!;
    expect(d.title).toBe('本地测试文章');
    expect(d.author).toBe('测试公众号');
    expect(d.publishedAt).toBe('2026年10月20日 09:30');
    expect(d.markdown).toBe('第一段\n\n## 小标题\n\n最后一段');
    expect(d.sourceUrl).not.toContain('private-token');
    expect(d.markdown).not.toContain('相关推荐');
  });
  it('saves lazy images in order, deduplicates identical images and preserves captions', () => {
    const d = page(`<p>图前</p><img data-src="${image}" src="data:image/gif;base64,placeholder" alt="图一"><p>图注</p><img src="${image}"><img src="//mmbiz.qlogo.cn/mmbiz_gif/fixture-two/0?wx_fmt=gif">`)!;
    expect(d.images).toEqual([{url: image, path: 'images/001.png'}, {url:'https://mmbiz.qlogo.cn/mmbiz_gif/fixture-two/0?wx_fmt=gif',path:'images/002.gif'}]);
    expect(d.markdown.indexOf('图前')).toBeLessThan(d.markdown.indexOf('images/001.png'));
    expect(d.markdown).toContain('图注');
    expect(d.imagesComplete).toBe(true);
  });
  it('does not silently lose unsupported pictures or embedded media', () => {
    const d = page('<p>正文</p><img src="https://example.test/private-picture" alt="插图"><iframe src="https://example.test/video"></iframe>')!;
    expect(d.images).toEqual([]);
    expect(d.imagesComplete).toBe(false);
    expect(d.warnings).toHaveLength(2);
    expect(d.markdown).toContain('插图');
    expect(d.markdown).not.toContain('example.test');
  });
  it('waits for an unresolved lazy image rather than calling the capture complete', () => {
    expect(page('<p>正文</p><img data-src="" src="data:image/gif;base64,placeholder">')).toBeNull();
  });
  it('skips restricted, hidden, missing or empty article content', () => {
    for (const fragment of ['<div id="js_content"><p>正文</p></div>', '<h1 id="activity-name">标题</h1><div id="js_content"></div>', '<h1 id="activity-name">标题</h1><div id="js_content" style="display:none">正文</div>', '<h1 id="activity-name">标题</h1><div id="js_content">正文</div><div id="js_paywall">付费后阅读</div>', '<h1 id="activity-name">标题</h1><div id="js_content">正文</div><div id="captcha">安全验证</div>']) {
      document.body.innerHTML = fragment;
      expect(extractWechatDocument(document,url)).toBeNull();
    }
  });
  it('keeps code/tables/links while removing hidden text, scripts and translation overlays', () => {
    const d = page('<p>原文 <a href="/s/linked-article?scene=2">链接</a></p><p hidden>隐藏</p><script>secret()</script><span class="immersive-translate-target-wrapper">译文</span><pre><code>const x = 1;</code></pre><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>')!;
    expect(d.markdown).toContain('const x = 1;');
    expect(d.markdown).toContain('| A | B |');
    expect(d.markdown).toContain('https://mp.weixin.qq.com/s/linked-article');
    expect(d.markdown).not.toMatch(/隐藏|secret\(\)|译文/);
  });
  it('excludes source elements hidden by ancestor CSS selectors', () => {
    document.head.innerHTML='<style>body .concealed { display: none; }</style>';
    const d = page('<p>可见正文</p><p class="concealed">不应保存</p>')!;
    expect(d.markdown).not.toContain('不应保存');
    document.head.innerHTML='';
  });
  it('identifies rejected image position and reason without recording credentials', () => {
    const d = page(`<p>正文</p><img src="${image}"><img src="https://unsupported.example/asset?token=private-secret">`)!;
    expect(d.warnings[0]).toContain('图片 2');
    expect(d.warnings[0]).toContain('unsupported.example');
    expect(d.warnings[0]).not.toContain('private-secret');
    expect(d.warnings[0]).not.toContain('/asset');
  });
  it('preserves nested article text, punctuation, tables, links, notes and code', () => {
    const parts=['首段中文与 English 123。','强调内容','引用内容','带链接文字','图片下方的说明','表格单元格','结尾脚注','最后一段完整结束。'];
    const d=page(`<section><section><p>${parts[0]}<strong>${parts[1]}</strong></p><blockquote>${parts[2]}</blockquote><p><a href="https://example.test/public">${parts[3]}</a></p><figure><img src="${image}"><figcaption>${parts[4]}</figcaption></figure><table><tbody><tr><td>${parts[5]}</td></tr></tbody></table><p><sup>${parts[6]}</sup></p><pre><code>if (a &lt; b) return a &amp; b;</code></pre><p>${parts[7]}</p></section></section>`)!;
    for(const part of parts)expect(d.markdown).toContain(part);
    expect(d.markdown).toContain('if (a < b) return a & b;');
    expect(d.markdown.indexOf(parts[0])).toBeLessThan(d.markdown.indexOf(parts[7]));
  });
  it('preserves supported CDN SVG, AVIF and BMP as separate local image files', () => {
    const d=page('<p>正文</p><img data-src="https://mmbiz.qpic.cn/mmbiz_svg/offline-vector/0?wx_fmt=svg" src="data:image/gif;base64,placeholder"><img src="https://mmbiz.qpic.cn/offline-avif/0?wx_fmt=avif"><img src="https://mmbiz.qlogo.cn/offline-bmp/0?wx_fmt=bmp">')!;
    expect(d.images.map(i=>i.path)).toEqual(['images/001.svg','images/002.avif','images/003.bmp']);
    expect(d.imagesComplete).toBe(true);expect(d.warnings).toEqual([]);
    const sender={id:'ext',frameId:0,url,tab:{id:1,url}};
    expect(isWechatCaptureRequest({target:'background',type:'AUTO_SAVE_WECHAT_CAPTURE',document:d},sender,'ext')).toBe(true);
  });
  it('only accepts exact image CDN hosts, safe formats and HTTPS', () => {
    expect(wechatImageUrl('http://mmbiz.qpic.cn/mmbiz_png/fixture/640?wx_fmt=png&scene=1')).toBe('https://mmbiz.qpic.cn/mmbiz_png/fixture/640?wx_fmt=png');
    for (const bad of ['https://mmbiz.qpic.cn.evil/a', 'https://user:pass@mmbiz.qpic.cn/a', 'https://mmbiz.qpic.cn:8443/a', 'https://mmbiz.qpic.cn/a?wx_fmt=html', 'file:///tmp/a.png']) expect(wechatImageUrl(bad)).toBeNull();
  });
  it('validates trusted top-frame sender, target, document identity and image paths', () => {
    const d = page(`<p>正文</p><img src="${image}">`)!;
    const m = {target:'background',type:'AUTO_SAVE_WECHAT_CAPTURE',document:d};
    const sender = {id:'our-extension',frameId:0,url,tab:{id:2,url}};
    expect(isWechatCaptureRequest(m,sender,'our-extension')).toBe(true);
    expect(isWechatCaptureRequest(m,{...sender,id:'other'},'our-extension')).toBe(false);
    expect(isWechatCaptureRequest(m,{...sender,frameId:1},'our-extension')).toBe(false);
    expect(isWechatCaptureRequest(m,{...sender,tab:{id:2,url:'https://mp.weixin.qq.com/s/another'}},'our-extension')).toBe(false);
    expect(isWechatCaptureRequest({...m,document:{...d,sourceId:'../outside'}},sender,'our-extension')).toBe(false);
    expect(isWechatCaptureRequest({...m,document:{...d,images:[{url:image,path:'../../outside.png'}]}},sender,'our-extension')).toBe(false);
  });
});
