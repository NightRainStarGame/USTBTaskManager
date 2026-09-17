// 输入问题诊断：用 CDP 真实鼠标/键盘事件测试打包版应用的输入框
const url = process.argv[2];
const ws = new WebSocket(url);
let id = 0;
const pending = new Map();
function send(method, params) {
  return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
}
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) pending.get(m.id)(m.result); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

ws.onopen = async () => {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Input.enable');

  // 1. 跳到设置页
  await send('Runtime.evaluate', { expression: "window.location.hash = '#/settings'; 'ok'" });
  await sleep(1500);

  // 2. 找到「姓名」输入框的位置
  const box = await send('Runtime.evaluate', {
    expression: `(() => {
      const labels = [...document.querySelectorAll('label')];
      const lb = labels.find(l => l.textContent.includes('姓名'));
      const inp = lb ? lb.querySelector('input') : document.querySelector('input.input-neon');
      if (!inp) return 'NOT_FOUND';
      const r = inp.getBoundingClientRect();
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, tag: inp.tagName });
    })()`,
    returnByValue: true,
  });
  console.log('目标输入框位置:', box.result.value);
  if (box.result.value === 'NOT_FOUND') { console.log('找不到输入框'); process.exit(1); }
  const { x, y } = JSON.parse(box.result.value);

  // 3. 真实鼠标点击（trusted event）
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(400);

  // 4. 检查焦点
  const focus1 = await send('Runtime.evaluate', {
    expression: `(() => {
      const a = document.activeElement;
      return JSON.stringify({ tag: a.tagName, cls: a.className, isInput: a.tagName === 'INPUT' });
    })()`,
    returnByValue: true,
  });
  console.log('点击后焦点:', focus1.result.value);

  // 5. 真实键盘逐字输入 "TEST"
  for (const ch of ['T', 'E', 'S', 'T']) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch, windowsVirtualKeyCode: ch.charCodeAt(0) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch, windowsVirtualKeyCode: ch.charCodeAt(0) });
    await sleep(80);
  }
  await sleep(400);

  // 6. 检查输入框的值
  const val = await send('Runtime.evaluate', {
    expression: `(() => {
      const labels = [...document.querySelectorAll('label')];
      const lb = labels.find(l => l.textContent.includes('姓名'));
      const inp = lb ? lb.querySelector('input') : document.querySelector('input.input-neon');
      return JSON.stringify({ value: inp ? inp.value : 'no-input', hasFocus: document.activeElement === inp });
    })()`,
    returnByValue: true,
  });
  console.log('键盘输入后:', val.result.value);

  const r = JSON.parse(val.result.value);
  console.log(r.value && r.value.includes('TEST') ? '✅ 输入正常' : '❌ 输入失败——复现用户问题');
  process.exit(0);
};
ws.onerror = () => { console.log('WS ERROR'); process.exit(1); };
