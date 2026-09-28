'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');

const source = readFileSync(process.env.AICH_SOURCE || join(__dirname, '../src/ai-cost-helper.user.js'), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const badges = el => [...el.querySelectorAll('[data-ai-cost-helper]')];

function page(t, html, setup = () => {}, url = 'https://example.com') {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const w = dom.window;
    w.console.log = () => {};
    w.fetch = async () => { throw new Error('offline'); };
    setup(w);
    w.eval(source);
    return w;
}

test('完整价格变为普通文本或数字时清理旧标签，保留原节点', async t => {
    for (const replacement of ['免费', '123', '']) {
        const w = page(t, '<p>$5</p>');
        await tick();
        const p = w.document.querySelector('p');
        const original = p.firstChild;
        original.data = replacement;
        await tick();
        assert.equal(p.firstChild, original);
        assert.equal(p.textContent, replacement);
        assert.equal(badges(p).length, 0);
    }
});

test('中段多个价格更新时清理所有旧切分片段', async t => {
    const w = page(t, '<p>原价 $5，现在 $3/月</p>');
    await tick();
    const p = w.document.querySelector('p');
    const original = p.firstChild;
    assert.equal(badges(p).length, 2);
    original.data = '免费使用';
    await tick();
    assert.equal(p.textContent, '免费使用');
    assert.equal(p.firstChild, original);
    original.data = '价格 $9/月';
    await tick();
    assert.equal(badges(p).length, 1);
    assert.equal(badges(p)[0].dataset.usd, '9');
    assert.equal([...p.childNodes].filter(n => n.nodeType === 3).map(n => n.data).join(''), '价格 $9/月');
});

test('拆分千分位价格只生成一个美元标签，并响应数字和符号变化', async t => {
    const w = page(t, '<p><span>$</span><span>10,000</span></p>');
    await tick();
    const p = w.document.querySelector('p');
    const symbol = p.firstChild.firstChild;
    const number = p.lastChild.firstChild;
    assert.equal(badges(p).length, 1);
    assert.equal(badges(p)[0].dataset.usd, '10000');
    number.data = '20,000';
    await tick();
    assert.equal(badges(p).length, 1);
    assert.equal(badges(p)[0].dataset.usd, '20000');
    symbol.data = '€';
    await tick();
    assert.equal(badges(p).length, 1);
    assert.equal(badges(p)[0].hasAttribute('data-usd'), false);
    symbol.data = '$';
    await tick();
    assert.equal(badges(p).length, 1);
    assert.equal(badges(p)[0].dataset.usd, '20000');
    number.data = '免费';
    await tick();
    assert.equal(badges(p).length, 0);
});

test('移除拆分价格符号或数字后清理对应标签', async t => {
    for (const target of ['symbol', 'number']) {
        const w = page(t, '<p><span>$</span><span>5</span></p>');
        await tick();
        const p = w.document.querySelector('p');
        const node = target === 'symbol' ? p.firstChild : p.lastChild.firstChild;
        node.remove();
        await tick();
        assert.equal(badges(p).length, 0);
    }
});

test('拆分零美元正常处理，代码块和跨单元格内容不处理', async t => {
    const w = page(t, '<p><span>$</span><span>0</span></p><pre>$5</pre><table><tr><td>$</td><td>5</td></tr></table>');
    await tick();
    assert.equal(badges(w.document).length, 1);
    assert.equal(badges(w.document)[0].dataset.usd, '0');
});

test('动态新增价格、重叠大数及自身标签防重入', async t => {
    const w = page(t, '<main></main>');
    await tick();
    const main = w.document.querySelector('main');
    main.innerHTML = '<p>$2.4B</p><p>$10,000</p><p>122,800,000</p>';
    await tick();
    await tick();
    assert.equal(badges(main).length, 3);
    assert.equal(badges(main)[0].textContent, '≈ 24亿');
    assert.equal(badges(main)[1].dataset.usd, '10000');
    assert.equal(main.querySelectorAll('[data-ai-cost-helper] [data-ai-cost-helper]').length, 0);
});

test('网络未返回也立即显示，成功后刷新已有标签', async t => {
    let respond;
    const w = page(t, '<p>$5</p>', w => {
        w.fetch = () => new Promise(resolve => { respond = resolve; });
    });
    assert.equal(badges(w.document).length, 1);
    respond({ ok: true, json: async () => ({ rates: { CNY: 8 } }) });
    await tick();
    assert.equal(badges(w.document)[0].textContent, '≈ ¥40');
});

test('共享缓存跨站点复用，不依赖网页 localStorage', async t => {
    const storage = new Map();
    let requests = 0;
    const setup = w => {
        w.GM_getValue = (key, fallback) => storage.has(key) ? storage.get(key) : fallback;
        w.GM_setValue = (key, value) => storage.set(key, value);
        Object.defineProperty(w, 'localStorage', { get() { throw new Error('blocked'); } });
        w.fetch = async () => { requests++; return { ok: true, json: async () => ({ rates: { CNY: 8 } }) }; };
    };
    page(t, '<p>$5</p>', setup);
    await tick();
    const second = page(t, '<p>$5</p>', setup, 'https://another.example');
    await tick();
    assert.equal(requests, 1);
    assert.equal(badges(second.document)[0].textContent, '≈ ¥40');
});

test('损坏的缓存仍尝试联网，非法汇率不进入换算', async t => {
    let requests = 0;
    const w = page(t, '<p>$5</p>', w => {
        w.GM_getValue = (key, fallback) => key === 'ai_cost_helper_rate' ? '{broken' : fallback;
        w.GM_setValue = () => { throw new Error('write blocked'); };
        w.fetch = async () => { requests++; return { ok: true, json: async () => ({ rates: { CNY: 8, EUR: -1, GBP: 'bad' } }) }; };
    });
    await tick();
    assert.equal(requests, 1);
    assert.equal(badges(w.document)[0].textContent, '≈ ¥40');
    badges(w.document)[0].dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    const rows = [...w.document.querySelectorAll('.aich-popup-row')];
    assert.equal(rows.find(row => row.querySelector('.aich-code').textContent === 'EUR').querySelector('.aich-val').textContent, '€4.6');
    assert.equal(rows.find(row => row.querySelector('.aich-code').textContent === 'GBP').querySelector('.aich-val').textContent, '£3.95');
});

test('无油猴存储时，网页缓存损坏或禁止访问仍可联网', async t => {
    for (const blocked of [false, true]) {
        let requests = 0;
        const w = page(t, '<p>$5</p>', w => {
            if (blocked) Object.defineProperty(w, 'localStorage', { get() { throw new Error('blocked'); } });
            else w.localStorage.setItem('ai_cost_helper_rate', '{broken');
            w.fetch = async () => { requests++; return { ok: true, json: async () => ({ rates: { CNY: 8 } }) }; };
        });
        await tick();
        assert.equal(requests, 1);
        assert.equal(badges(w.document)[0].textContent, '≈ ¥40');
    }
});

test('汇率请求超时会取消，兜底标签保持可用', async t => {
    let aborted = false;
    const w = page(t, '<p>$5</p>', w => {
        const originalTimeout = w.setTimeout.bind(w);
        w.setTimeout = (fn, delay) => originalTimeout(fn, delay === 8000 ? 0 : delay);
        w.fetch = (_, { signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
        });
    });
    await tick();
    assert.equal(aborted, true);
    assert.equal(badges(w.document).length, 1);
});

test('禁用页面不扫描也不请求汇率', async t => {
    let requests = 0;
    const w = page(t, '<meta name="ai-cost-helper" content="disabled"><p>$5</p>', w => {
        w.fetch = async () => { requests++; throw new Error('unexpected'); };
    });
    await tick();
    assert.equal(requests, 0);
    assert.equal(badges(w.document).length, 0);
});

test('排除非美元前缀，同时保留裸美元和显式美元价格', async t => {
    const w = page(t, '<main><p>CA$5 AU$5 HK$5 S$5 NZ$5 CAD $5 AUD $5</p><p>$5 US$5 USD$5 Price $5 价格 $5</p></main>');
    await tick();
    const [foreign, usd] = w.document.querySelectorAll('p');
    assert.equal(badges(foreign).length, 0);
    assert.equal(badges(usd).length, 5);
    assert.ok(badges(usd).every(b => b.dataset.usd === '5'));
});

test('跨内联节点的外币前缀不会被当成美元', async t => {
    const w = page(t, '<p><span>CA</span><span>$5</span></p><p><span>AU</span><span>$</span><span>5</span></p><p><span>US$</span><span>5</span></p>');
    await tick();
    const paragraphs = w.document.querySelectorAll('p');
    assert.equal(badges(paragraphs[0]).length, 0);
    assert.equal(badges(paragraphs[1]).length, 0);
    assert.equal(badges(paragraphs[2]).length, 1);
});

test('K 要求计数上下文，分辨率和孤立 K 不标注', async t => {
    const w = page(t, '<p>4K 显示器，8K UHD，1.6K</p><p>128K tokens</p><p>调用量：12K</p><p><span>32K</span><span> tokens</span></p><p>122.8M，2.4B</p>');
    await tick();
    const paragraphs = w.document.querySelectorAll('p');
    assert.equal(badges(paragraphs[0]).length, 0);
    assert.equal(badges(paragraphs[1])[0].textContent, '≈ 12.8万');
    assert.equal(badges(paragraphs[2])[0].textContent, '≈ 1.2万');
    assert.equal(badges(paragraphs[3])[0].textContent, '≈ 3.2万');
    assert.equal(badges(paragraphs[4]).length, 2);
});

test('微小金额保留有效数字和原计价单位，真正的零仍显示零', async t => {
    const w = page(t, '<p>$0.00015 / 1M tokens</p><p>$0</p><p>$0.00000000000000000001</p>');
    await tick();
    const paragraphs = w.document.querySelectorAll('p');
    assert.equal(badges(paragraphs[0])[0].textContent, '≈ ¥0.00102');
    assert.equal([...paragraphs[0].childNodes].filter(n => n.nodeType === 3).map(n => n.data).join(''), '$0.00015 / 1M tokens');
    assert.equal(badges(paragraphs[1])[0].textContent, '≈ ¥0');
    assert.notEqual(badges(paragraphs[2])[0].textContent, '≈ ¥0');
    badges(paragraphs[0])[0].dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    const jpyRow = [...w.document.querySelectorAll('.aich-popup-row')].find(row => row.querySelector('.aich-code').textContent === 'JPY');
    assert.equal(jpyRow.querySelector('.aich-val').textContent, '¥0.0225');
});

test('大额标签用万亿缩写，标题和浮窗仍保留完整金额', async t => {
    const w = page(t, '<p>$10,000</p><p>$100,000,000</p>');
    await tick();
    const [first, second] = badges(w.document);
    assert.equal(first.textContent, '≈ ¥6.78万');
    assert.equal(second.textContent, '≈ ¥6.78亿');
    assert.ok(first.title.includes('¥67,800'));
    first.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    assert.equal(w.document.querySelector('.aich-val').textContent, '¥67,800');
});

test('更改默认币种后仍使用自适应金额格式', async t => {
    const w = page(t, '<p>$0.00015</p><p>$10000</p>');
    await tick();
    badges(w.document)[0].dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    w.document.querySelector('[data-popup-settings]').click();
    w.document.querySelector('[data-panel-default]').value = 'JPY';
    w.document.querySelector('[data-panel-save]').click();
    await tick();
    assert.equal(badges(w.document)[0].textContent, '≈ ¥0.0225');
    assert.equal(badges(w.document)[1].textContent, '≈ ¥150万');
});
