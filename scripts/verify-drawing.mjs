// 修复验证：像素级检查 5 种拖拽工具渲染结果是否贴合鼠标（originX/Y: left/top）
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
try { Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true }); } catch {}
const { Canvas, Rect, Ellipse, Line, Path } = await import('fabric');

function buildArrowPath(x1, y1, x2, y2, sw) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = Math.max(12, sw * 4);
  const spread = Math.PI / 7;
  return `M ${x1} ${y1} L ${x2} ${y2} L ${x2 - headLen * Math.cos(angle - spread)} ${y2 - headLen * Math.sin(angle - spread)} M ${x2} ${y2} L ${x2 - headLen * Math.cos(angle + spread)} ${y2 - headLen * Math.sin(angle + spread)}`;
}

const el = document.createElement('canvas');
document.body.appendChild(el);
const canvas = new Canvas(el, { width: 1000, height: 700 });
canvas.setViewportTransform([0.5, 0, 0, 0.5, 100, 50]);

let temp = null, start = null, tool = 'rect';
const ORIGIN = { originX: 'left', originY: 'top' };
canvas.on('mouse:down', (opt) => {
  start = { x: opt.scenePoint.x, y: opt.scenePoint.y };
  if (tool === 'rect' || tool === 'mosaic') temp = new Rect({ ...ORIGIN, left: start.x, top: start.y, width: 0, height: 0, stroke: '#ff0000', strokeWidth: 2, fill: 'rgba(0,0,0,0)', strokeUniform: true });
  if (tool === 'ellipse') temp = new Ellipse({ ...ORIGIN, left: start.x, top: start.y, rx: 0, ry: 0, stroke: '#ff0000', strokeWidth: 2, fill: 'rgba(0,0,0,0)', strokeUniform: true });
  if (tool === 'line') temp = new Line([start.x, start.y, start.x, start.y], { stroke: '#ff0000', strokeWidth: 2, strokeUniform: true });
  if (tool === 'arrow') temp = new Path(buildArrowPath(start.x, start.y, start.x, start.y, 2), { stroke: '#ff0000', strokeWidth: 2, fill: 'rgba(0,0,0,0)', strokeUniform: true });
  canvas.add(temp);
});
canvas.on('mouse:move', (opt) => {
  if (!temp || !start) return;
  const pt = opt.scenePoint;
  const left = Math.min(start.x, pt.x), top = Math.min(start.y, pt.y);
  const w = Math.abs(pt.x - start.x), h = Math.abs(pt.y - start.y);
  if (tool === 'rect' || tool === 'mosaic') temp.set({ left, top, width: w, height: h });
  if (tool === 'ellipse') temp.set({ left, top, rx: w / 2, ry: h / 2 });
  if (tool === 'line') temp.set({ x2: pt.x, y2: pt.y });
  if (tool === 'arrow') { canvas.remove(temp); temp = new Path(buildArrowPath(start.x, start.y, pt.x, pt.y, 2), { stroke: '#ff0000', strokeWidth: 2, fill: 'rgba(0,0,0,0)', strokeUniform: true }); canvas.add(temp); }
});
function fire(target, type, cx, cy) {
  target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 1 }));
}
const upper = canvas.upperCanvasEl;

function renderedStrokeBounds() {
  canvas.renderAll();
  const ctx = canvas.lowerCanvasEl.getContext('2d');
  const img = ctx.getImageData(0, 0, 1000, 700).data;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < 700; y++) for (let x = 0; x < 1000; x++) {
    const i = (y * 1000 + x) * 4;
    if (img[i] > 150 && img[i] > img[i + 1] * 2 && img[i] > img[i + 2] * 2 && img[i + 3] > 100) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); count++;
    }
  }
  return { minX, minY, maxX, maxY, count };
}

// 场景: vpt=[0.5,0,0,0.5,100,50]; mousedown client(300,200)=scene(400,300); mousemove client(500,300)=scene(800,500)
// 期望渲染包围盒 ≈ 视口 (300,200)→(500,300)（箭头头部会略超出终点，单独断言主干穿过终点附近）
let allOk = true;
for (const t of ['rect', 'ellipse', 'line', 'mosaic', 'arrow']) {
  tool = t; temp = null; start = null;
  canvas.remove(...canvas.getObjects());
  fire(upper, 'mousedown', 300, 200);
  fire(document, 'mousemove', 500, 300);
  const b = renderedStrokeBounds();
  let ok;
  if (t === 'arrow') {
    ok = b.count > 100 && Math.abs(b.minX - 300) <= 4 && Math.abs(b.minY - 200) <= 4 && b.maxX >= 495 && b.maxY >= 295;
  } else {
    ok = b.count > 50 && Math.abs(b.minX - 300) <= 4 && Math.abs(b.minY - 200) <= 4 && Math.abs(b.maxX - 500) <= 4 && Math.abs(b.maxY - 300) <= 4;
  }
  if (!ok) allOk = false;
  console.log(`${t}: 渲染包围盒 (${b.minX},${b.minY})→(${b.maxX},${b.maxY}) 像素${b.count} | 期望约 (300,200)→(500,300) ${ok ? 'OK 贴合' : '*** 不贴合 ***'}`);
}

// 再测一个平移后的场景：vpt=[2,0,0,2,-300,100]（放大+平移），拖拽 client(100,100)→(400,400)
canvas.setViewportTransform([2, 0, 0, 2, -300, 100]);
for (const t of ['rect', 'ellipse']) {
  tool = t; temp = null; start = null;
  canvas.remove(...canvas.getObjects());
  fire(upper, 'mousedown', 100, 100);
  fire(document, 'mousemove', 400, 400);
  const b = renderedStrokeBounds();
  const ok = b.count > 50 && Math.abs(b.minX - 100) <= 4 && Math.abs(b.minY - 100) <= 4 && Math.abs(b.maxX - 400) <= 4 && Math.abs(b.maxY - 400) <= 4;
  if (!ok) allOk = false;
  console.log(`[放大平移] ${t}: (${b.minX},${b.minY})→(${b.maxX},${b.maxY}) | 期望约 (100,100)→(400,400) ${ok ? 'OK 贴合' : '*** 不贴合 ***'}`);
}
console.log(allOk ? '== 绘制工具全部通过 ==' : '== 存在失败 ==');
canvas.dispose();

// ============ 橡皮擦：命中检测 / 划过删除 / 单次快照 ============
const { circleHitsRect, eraserScreenRadius } = await import('../src/lib/eraser.ts');

const el2 = document.createElement('canvas');
document.body.appendChild(el2);
const c2 = new Canvas(el2, { width: 1000, height: 700 });
c2.setViewportTransform([1, 0, 0, 1, 0, 0]);
const r1 = new Rect({ left: 100, top: 100, width: 100, height: 100, originX: 'left', originY: 'top', stroke: '#f00', strokeWidth: 2, fill: 'rgba(0,0,0,0)' });
const r2 = new Rect({ left: 400, top: 400, width: 100, height: 100, originX: 'left', originY: 'top', stroke: '#f00', strokeWidth: 2, fill: 'rgba(0,0,0,0)' });
c2.add(r1, r2);

// 镜像 Viewer.tsx 的橡皮擦逻辑
let erasing = false, hits = null, snapshots = 0, drawing = false;
const pushHistory = () => { if (!drawing) snapshots++; };
c2.on('object:removed', pushHistory);
const radius = () => eraserScreenRadius(4) / c2.getZoom(); // = 10 (zoom=1)
const collect = (pt) => {
  for (const obj of c2.getObjects()) {
    if (hits.has(obj)) continue;
    obj.setCoords();
    if (circleHitsRect(pt.x, pt.y, radius(), obj.getBoundingRect())) {
      hits.set(obj, obj.opacity ?? 1);
      obj.set('opacity', 0.35);
    }
  }
};
c2.on('mouse:down', (opt) => { erasing = true; hits = new Map(); collect(opt.scenePoint); });
c2.on('mouse:move', (opt) => { if (erasing) collect(opt.scenePoint); });
c2.on('mouse:up', () => {
  erasing = false;
  const h = hits; hits = null;
  if (h && h.size > 0) {
    drawing = true;
    try { for (const [o, op] of h) o.set('opacity', op); c2.remove(...h.keys()); } finally { drawing = false; }
    pushHistory();
  }
});
const fire2 = (target, type, cx, cy) =>
  target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 1 }));
const upper2 = c2.upperCanvasEl;

let eraserOk = true;
// 用例 1：拖过 r1（scene 100..200），不碰 r2
fire2(upper2, 'mousedown', 110, 110);
fire2(document, 'mousemove', 150, 150);
fire2(document, 'mouseup', 150, 150);
if (c2.getObjects().length !== 1 || c2.getObjects()[0] !== r2) { eraserOk = false; console.log('FAIL: 命中删除结果错误, 剩余对象', c2.getObjects().length); }
if (snapshots !== 1) { eraserOk = false; console.log('FAIL: 快照次数 =', snapshots, '期望 1'); }
console.log(eraserOk ? '橡皮擦用例1 OK: 拖过 r1 仅删除 r1，合并为 1 次快照' : '橡皮擦用例1 FAIL');

// 用例 2：空擦不产生快照
fire2(upper2, 'mousedown', 600, 100);
fire2(document, 'mousemove', 700, 200);
fire2(document, 'mouseup', 700, 200);
const ok2case = snapshots === 1 && c2.getObjects().length === 1;
if (!ok2case) eraserOk = false;
console.log(ok2case ? '橡皮擦用例2 OK: 空擦无快照、无删除' : '橡皮擦用例2 FAIL');

// 用例 3：半径换算
const okRadius = eraserScreenRadius(4) === 10 && eraserScreenRadius(20) === 25 && circleHitsRect(195, 150, 10, { left: 100, top: 100, width: 100, height: 100 }) && !circleHitsRect(220, 150, 10, { left: 100, top: 100, width: 100, height: 100 });
if (!okRadius) eraserOk = false;
console.log(okRadius ? '橡皮擦用例3 OK: circleHitsRect / 半径换算正确' : '橡皮擦用例3 FAIL');

c2.dispose();

// ============ 选择模式命中回归：拖拽 set() 生长后 findTarget 命中（含透明/实心填充） ============
let selectOk = true;
{
  const el3 = document.createElement('canvas');
  document.body.appendChild(el3);
  const c3 = new Canvas(el3, { width: 1000, height: 700 });
  // 非单位 vpt（模拟大图适应窗口后的缩放+平移）
  c3.setViewportTransform([0.5, 0, 0, 0.5, 100, 50]);
  c3.skipTargetFind = true; // 绘制期应用状态
  c3.selection = false;

  let temp3 = null, start3 = null, fillMode = 'rgba(0,0,0,0)', shape = 'rect';
  c3.on('mouse:down', (opt) => {
    start3 = { x: opt.scenePoint.x, y: opt.scenePoint.y };
    if (shape === 'rect') temp3 = new Rect({ left: start3.x, top: start3.y, originX: 'left', originY: 'top', width: 0, height: 0, stroke: '#ef4444', strokeWidth: 4, strokeUniform: true, fill: fillMode });
    else temp3 = new Ellipse({ left: start3.x, top: start3.y, originX: 'left', originY: 'top', rx: 0, ry: 0, stroke: '#ef4444', strokeWidth: 4, strokeUniform: true, fill: fillMode });
    c3.add(temp3);
  });
  c3.on('mouse:move', (opt) => {
    if (!temp3 || !start3) return;
    const pt = opt.scenePoint;
    const left = Math.min(start3.x, pt.x), top = Math.min(start3.y, pt.y);
    const w = Math.abs(pt.x - start3.x), h = Math.abs(pt.y - start3.y);
    if (shape === 'rect') temp3.set({ left, top, width: w, height: h });
    else temp3.set({ left, top, rx: w / 2, ry: h / 2 });
  });
  c3.on('mouse:up', () => { if (temp3) temp3.setCoords(); }); // 与应用修复一致
  const upper3 = c3.upperCanvasEl;
  const fire3 = (target, type, cx, cy) =>
    target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 1 }));

  for (const s of ['rect', 'ellipse']) {
    for (const f of ['rgba(0,0,0,0)', '#22c55e']) {
      shape = s; fillMode = f; temp3 = null; start3 = null;
      c3.remove(...c3.getObjects());
      fire3(upper3, 'mousedown', 300, 200);   // scene(400,300)
      fire3(document, 'mousemove', 500, 320); // scene(800,540)
      fire3(document, 'mouseup', 500, 320);
      const drawn = temp3;
      // 切选择模式
      c3.skipTargetFind = false;
      c3.selection = true;
      // 点图形内部中心 client(400,260) → scene(600,420)，在 shape(400,300)-(800,540) 内
      fire3(upper3, 'mousedown', 400, 260);
      const hit = c3.getActiveObject() === drawn;
      fire3(document, 'mouseup', 400, 260);
      c3.discardActiveObject();
      // 点边缘 client(301,201)
      fire3(upper3, 'mousedown', 301, 201);
      const hitEdge = c3.getActiveObject() === drawn;
      fire3(document, 'mouseup', 301, 201);
      c3.discardActiveObject();
      const ok = hit && hitEdge;
      if (!ok) selectOk = false;
      console.log(`选中回归 ${s} fill=${f === '#22c55e' ? '实心' : '透明'}: 内部=${hit ? '命中' : 'MISS'} 边缘=${hitEdge ? '命中' : 'MISS'} ${ok ? 'OK' : '*** FAIL ***'}`);
    }
  }
  c3.dispose();
}

// ============ 回归：橡皮擦删除 → 连续 Ctrl+Z(undo/redo) → 光标不丢 ============
// 镜像 Viewer.tsx 修复后的逻辑：applySnapshot remove-all 后必须重置 eraserCursorRef，
// updateEraserCursor 增加"引用对象已不在画布"的防御重建。
const { Circle, util } = await import('fabric');

let cursorOk = true;
{
  const el4 = document.createElement('canvas');
  document.body.appendChild(el4);
  const c4 = new Canvas(el4, { width: 400, height: 400 });
  c4.setViewportTransform([1, 0, 0, 1, 0, 0]);

  let tool4 = 'select', erasing4 = false, hits4 = null, drawing4 = false;
  const cursorRef = { current: null }; // 对应 Viewer 的 eraserCursorRef
  const history = { stack: [], index: -1 };

  const serialize = () =>
    JSON.stringify(c4.getObjects().filter((o) => !o.__eraserCursor).map((o) => o.toObject(['selectable', 'evented'])));
  const push = () => {
    if (drawing4) return;
    const json = serialize();
    if (history.index >= 0 && history.stack[history.index] === json) return;
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push(json);
    history.index = history.stack.length - 1;
  };
  const applySnapshot = async (json) => {
    c4.discardActiveObject();
    c4.remove(...c4.getObjects());
    cursorRef.current = null; // 修复点①：remove-all 连带删除光标对象，引用必须失效
    const objs = await util.enlivenObjects(JSON.parse(json));
    objs.forEach((o) => c4.add(o));
  };
  const undo = async () => { if (history.index <= 0) return; history.index -= 1; await applySnapshot(history.stack[history.index]); };
  const redo = async () => { if (history.index >= history.stack.length - 1) return; history.index += 1; await applySnapshot(history.stack[history.index]); };

  const applyTool = (t) => {
    tool4 = t;
    c4.selection = t === 'select';
    c4.skipTargetFind = t !== 'select';
    c4.defaultCursor = t === 'select' ? 'default' : 'none';
    if (t !== 'eraser' && cursorRef.current) { c4.remove(cursorRef.current); cursorRef.current = null; }
  };
  const updateCursor = (pt) => {
    // 修复点②：防御——引用对象已被 remove-all 类路径移出画布时按 null 处理并重建
    if (cursorRef.current && !c4.getObjects().includes(cursorRef.current)) cursorRef.current = null;
    if (!cursorRef.current) {
      const cur = new Circle({
        radius: 10, left: pt.x, top: pt.y, originX: 'center', originY: 'center',
        fill: 'rgba(255,255,255,0.12)', stroke: '#ffffff', strokeWidth: 1,
        selectable: false, evented: false, excludeFromExport: true,
      });
      cur.__eraserCursor = true;
      cursorRef.current = cur;
      c4.add(cur);
    } else {
      cursorRef.current.set({ left: pt.x, top: pt.y, visible: true });
    }
  };
  const collect4 = (pt) => {
    for (const obj of c4.getObjects()) {
      if (obj.__eraserCursor || hits4.has(obj)) continue;
      obj.setCoords();
      if (circleHitsRect(pt.x, pt.y, 10, obj.getBoundingRect())) { hits4.set(obj, obj.opacity ?? 1); obj.set('opacity', 0.35); }
    }
  };
  c4.on('mouse:down', (opt) => { if (tool4 !== 'eraser') return; erasing4 = true; hits4 = new Map(); collect4(opt.scenePoint); });
  c4.on('mouse:move', (opt) => { if (tool4 === 'eraser') updateCursor(opt.scenePoint); if (erasing4) collect4(opt.scenePoint); });
  c4.on('mouse:up', () => {
    if (!erasing4) return;
    erasing4 = false;
    const h = hits4; hits4 = null;
    if (h && h.size > 0) {
      drawing4 = true;
      try { for (const [o, op] of h) o.set('opacity', op); c4.remove(...h.keys()); } finally { drawing4 = false; }
      push();
    }
  });
  const fire4 = (target, type, cx, cy, buttons = 1) =>
    target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons }));
  const upper4 = c4.upperCanvasEl;

  const rectA = new Rect({ left: 100, top: 100, width: 100, height: 100, originX: 'left', originY: 'top', stroke: '#f00', strokeWidth: 2, fill: 'rgba(0,0,0,0)' });
  c4.add(rectA);
  push(); // S0: [rectA]

  // 1) 橡皮擦拖过 rectA → 删除并推 1 次快照
  applyTool('eraser');
  fire4(upper4, 'mousedown', 110, 110);
  fire4(document, 'mousemove', 150, 150);
  fire4(document, 'mouseup', 150, 150);
  const erased = !c4.getObjects().includes(rectA) && history.stack.length === 2;
  if (!erased) { cursorOk = false; console.log('FAIL: 橡皮擦删除未生效或快照异常'); }
  const cursorBefore = cursorRef.current;
  if (!cursorBefore || !c4.getObjects().includes(cursorBefore)) { cursorOk = false; console.log('FAIL: 擦除后光标不在画布上'); }

  // 2) 连续 Ctrl+Z：第一次 undo 恢复 rectA（remove-all 删掉光标对象）；第二次到栈底 no-op
  await undo();
  await undo();
  const restoredOk = c4.getObjects().some((o) => !o.__eraserCursor);
  const refCleared = cursorRef.current === null; // 修复后：remove-all 即置空引用
  const noStaleCursor = !c4.getObjects().some((o) => o.__eraserCursor);
  if (!restoredOk) { cursorOk = false; console.log('FAIL: undo 未恢复被删对象'); }
  if (!refCleared) { cursorOk = false; console.log('FAIL: applySnapshot 未重置光标引用（旧 bug）'); }
  if (!noStaleCursor) { cursorOk = false; console.log('FAIL: undo 后画布残留旧光标对象'); }

  // 3) undo 后移动鼠标（悬停）→ 光标必须被重建、可见、系统光标仍为 none
  fire4(upper4, 'mousemove', 120, 120, 0);
  const cur2 = cursorRef.current;
  const rebuiltOk = !!cur2 && c4.getObjects().includes(cur2) && cur2.visible === true && c4.defaultCursor === 'none';
  if (!rebuiltOk) { cursorOk = false; console.log('FAIL: undo 后光标未重建/不可见', { has: !!cur2, onCanvas: cur2 ? c4.getObjects().includes(cur2) : false, visible: cur2 && cur2.visible, dc: c4.defaultCursor }); }

  // 4) redo（又一次 remove-all）后移动鼠标 → 光标依然正常，rectA 再次被删除
  await redo();
  fire4(upper4, 'mousemove', 130, 130, 0);
  const cur3 = cursorRef.current;
  const redoOk = !!cur3 && c4.getObjects().includes(cur3) && cur3.visible === true && !c4.getObjects().some((o) => !o.__eraserCursor);
  if (!redoOk) { cursorOk = false; console.log('FAIL: redo 后光标异常或对象未再删除'); }

  // 5) 防御路径：模拟未重置引用的 remove-all（遗漏路径兜底），updateCursor 应自愈
  const stale = cursorRef.current;
  c4.remove(...c4.getObjects()); // 故意不重置 cursorRef —— 制造陈旧引用
  const isStale = cursorRef.current === stale && !c4.getObjects().includes(stale);
  fire4(upper4, 'mousemove', 140, 140, 0);
  const healed = !!cursorRef.current && cursorRef.current !== stale && c4.getObjects().includes(cursorRef.current);
  if (!isStale || !healed) { cursorOk = false; console.log('FAIL: 陈旧引用防御重建未生效'); }

  // 6) 切回选择工具：光标移除、系统光标恢复 default
  applyTool('select');
  const clearedOk = cursorRef.current === null && !c4.getObjects().some((o) => o.__eraserCursor) && c4.defaultCursor === 'default';
  if (!clearedOk) { cursorOk = false; console.log('FAIL: 切回选择工具后光标未清理'); }

  console.log(cursorOk ? '橡皮擦-undo-光标回归 OK' : '橡皮擦-undo-光标回归 *** FAIL ***');
  c4.dispose();
}

// ============ 截图模块：文件名时间戳 / 不支持环境守卫 ============
// 抓帧部分依赖 getDisplayMedia + 真实视频帧，jsdom 无法模拟（只能人工浏览器验证）；
// 这里只测纯逻辑：screenshotFileName 格式化 与 isScreenshotSupported=false 时的拒绝分支。
const { screenshotFileName, captureScreenshot, isScreenshotSupported, SCREENSHOT_UNSUPPORTED_MSG } =
  await import('../src/lib/screenshot.ts');

let shotOk = true;
{
  const fixed = screenshotFileName(new Date(2025, 0, 13, 15, 30, 42));
  if (fixed !== '截图_20250113-153042.png') { shotOk = false; console.log('FAIL: 固定时间文件名 =', fixed); }
  if (!/^截图_\d{8}-\d{6}\.png$/.test(screenshotFileName())) { shotOk = false; console.log('FAIL: 默认文件名格式 =', screenshotFileName()); }
  if (isScreenshotSupported()) { shotOk = false; console.log('FAIL: jsdom 环境不应判定为支持截图'); }
  // jsdom 无 navigator.mediaDevices → 必须以"不支持"错误拒绝，而非崩溃
  let rejected = null;
  try { await captureScreenshot(); } catch (e) { rejected = e; }
  if (!(rejected instanceof Error && rejected.message === SCREENSHOT_UNSUPPORTED_MSG)) {
    shotOk = false; console.log('FAIL: 不支持环境下 captureScreenshot 拒绝信息异常 =', rejected && rejected.message);
  }
}
console.log(shotOk ? '截图模块检查 OK' : '截图模块检查 *** FAIL ***');

// ============ 裁剪回归：底图裁剪 / 批注平移 / 区外删除 / undo-redo 恢复（含底图） ============
// 镜像 Viewer.tsx 的 confirmCrop 与扩展历史条目（HistoryEntry { json, bg? }）。
const { FabricImage } = await import('fabric');

let cropOk = true;
{
  const el5 = document.createElement('canvas');
  document.body.appendChild(el5);
  const c5 = new Canvas(el5, { width: 400, height: 300 });
  c5.setViewportTransform([1, 0, 0, 1, 0, 0]);

  // 源图 200x100：红底，裁剪区 (20,10,100,60) 填蓝，便于像素断言裁剪映射
  const src = document.createElement('canvas');
  src.width = 200; src.height = 100;
  const sctx = src.getContext('2d');
  sctx.fillStyle = '#ff0000'; sctx.fillRect(0, 0, 200, 100);
  sctx.fillStyle = '#0000ff'; sctx.fillRect(20, 10, 100, 60);
  let loaded = { source: src, width: 200, height: 100, fileName: 't.png', formatLabel: 'PNG' };
  c5.backgroundImage = new FabricImage(src, { left: 0, top: 0, originX: 'left', originY: 'top' });

  const ORIGIN = { originX: 'left', originY: 'top' };
  const objA = new Rect({ left: 30, top: 20, width: 40, height: 30, ...ORIGIN, fill: '#00ff00' }); // 完全在裁剪区内
  const objB = new Rect({ left: 150, top: 10, width: 40, height: 30, ...ORIGIN, fill: '#00ff00' }); // 完全在区外
  const objC = new Rect({ left: 110, top: 50, width: 40, height: 30, ...ORIGIN, fill: '#00ff00' }); // 部分重叠
  const overlay = new Rect({ left: 0, top: 0, width: 10, height: 10, ...ORIGIN, fill: 'rgba(0,0,0,0.5)' });
  overlay.__cropOverlay = true;   // 裁剪遮罩视觉：应被清除、不进快照
  const eCursor = new Rect({ left: 0, top: 0, width: 6, height: 6, ...ORIGIN, fill: '#ffffff' });
  eCursor.__eraserCursor = true;  // 橡皮光标：不参与平移、不进快照
  c5.add(objA, objB, objC, overlay, eCursor);
  [objA, objB, objC].forEach((o) => o.setCoords());

  const serialize5 = () => JSON.stringify(c5.getObjects()
    .filter((o) => !o.__eraserCursor && !o.__cropOverlay)
    .map((o) => o.toObject(['selectable', 'evented'])));
  const hist5 = { stack: [], index: -1 };
  let drawing5 = false;
  const push5 = (bg) => {
    if (drawing5) return;
    const json = serialize5();
    if (bg === undefined && hist5.index >= 0 && hist5.stack[hist5.index].json === json) return;
    hist5.stack = hist5.stack.slice(0, hist5.index + 1);
    hist5.stack.push(bg === undefined ? { json } : { json, bg });
    hist5.index = hist5.stack.length - 1;
  };
  const applySnapshot5 = async (entry) => {
    const bgChanged = entry.bg !== undefined && entry.bg !== loaded;
    c5.remove(...c5.getObjects());
    if (bgChanged && entry.bg) {
      loaded = entry.bg;
      c5.backgroundImage = new FabricImage(loaded.source, { left: 0, top: 0, originX: 'left', originY: 'top' });
    }
    const objs = await util.enlivenObjects(JSON.parse(entry.json));
    objs.forEach((o) => c5.add(o));
  };
  push5(); // S0：裁剪前

  // 镜像 confirmCrop：裁剪 (20,10) 起 100x60
  const rect = { x: 20, y: 10, w: 100, h: 60 };
  hist5.stack[hist5.index] = { ...hist5.stack[hist5.index], bg: loaded }; // 栈顶挂旧底图
  const cropped = document.createElement('canvas');
  cropped.width = rect.w; cropped.height = rect.h;
  cropped.getContext('2d').drawImage(loaded.source, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  const next5 = { source: cropped, width: rect.w, height: rect.h, fileName: loaded.fileName, formatLabel: loaded.formatLabel };
  drawing5 = true; // 屏蔽 object:removed 的逐对象历史触发
  try {
    c5.remove(overlay); // 清裁剪视觉
    for (const obj of [...c5.getObjects()]) {
      if (obj.__eraserCursor) continue;
      const b = obj.getBoundingRect();
      const outside = b.left + b.width <= rect.x || b.left >= rect.x + rect.w || b.top + b.height <= rect.y || b.top >= rect.y + rect.h;
      if (outside) { c5.remove(obj); continue; }
      obj.set({ left: obj.left - rect.x, top: obj.top - rect.y });
      obj.setCoords(); // 刷新 aCoords 缓存
    }
    loaded = next5;
    c5.backgroundImage = new FabricImage(cropped, { left: 0, top: 0, originX: 'left', originY: 'top' });
  } finally { drawing5 = false; }
  push5(loaded); // S1：裁剪后（带新底图引用）

  const px = (cv, x, y) => Array.from(cv.getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3));
  const annots = () => c5.getObjects().filter((o) => !o.__eraserCursor && !o.__cropOverlay);

  // ---- 断言：裁剪结果 ----
  if (loaded.width !== 100 || loaded.height !== 60) { cropOk = false; console.log('FAIL: 裁剪后底图尺寸 =', loaded.width, loaded.height); }
  const cp = px(cropped, 50, 50);
  if (!(cp[2] > 150 && cp[0] < 60)) { cropOk = false; console.log('FAIL: 裁剪位图映射错误（应取自源图蓝区） =', cp); }
  const sp = px(src, 5, 5);
  if (!(sp[0] > 150 && sp[2] < 60)) { cropOk = false; console.log('FAIL: 源图被意外改动 =', sp); }
  if (annots().length !== 2) { cropOk = false; console.log('FAIL: 裁剪后批注数应为 2 =', annots().length); }
  if (c5.getObjects().includes(objB)) { cropOk = false; console.log('FAIL: 区外对象 objB 未删除'); }
  if (c5.getObjects().some((o) => o.__cropOverlay)) { cropOk = false; console.log('FAIL: 裁剪视觉残留'); }
  const ba = objA.getBoundingRect();
  if (!(Math.abs(ba.left - 10) < 0.01 && Math.abs(ba.top - 10) < 0.01)) { cropOk = false; console.log('FAIL: objA 平移/aCoords =', ba.left, ba.top, '期望 10,10'); }
  const bc = objC.getBoundingRect();
  if (!(Math.abs(bc.left - 90) < 0.01 && Math.abs(bc.top - 40) < 0.01)) { cropOk = false; console.log('FAIL: objC 平移 =', bc.left, bc.top, '期望 90,40'); }
  if (JSON.parse(serialize5()).length !== 2) { cropOk = false; console.log('FAIL: 快照序列化应只含 2 个批注（标记对象须排除）'); }
  if (hist5.stack.length !== 2) { cropOk = false; console.log('FAIL: 历史栈应为 S0+S1 =', hist5.stack.length); }

  // ---- 断言：undo 一步恢复（含底图） ----
  hist5.index -= 1;
  await applySnapshot5(hist5.stack[hist5.index]);
  const afterUndo = annots();
  if (loaded.width !== 200 || loaded.height !== 100) { cropOk = false; console.log('FAIL: undo 未恢复底图尺寸 =', loaded.width, loaded.height); }
  if (afterUndo.length !== 3) { cropOk = false; console.log('FAIL: undo 后批注数应为 3 =', afterUndo.length); }
  if (!afterUndo.find((o) => Math.abs(o.left - 30) < 0.01 && Math.abs(o.top - 20) < 0.01)) { cropOk = false; console.log('FAIL: undo 后 objA 未回到 (30,20)'); }
  if (!afterUndo.find((o) => Math.abs(o.left - 150) < 0.01)) { cropOk = false; console.log('FAIL: undo 后 objB 未找回'); }

  // ---- 断言：redo 重做（含底图） ----
  hist5.index += 1;
  await applySnapshot5(hist5.stack[hist5.index]);
  const afterRedo = annots();
  if (loaded.width !== 100 || loaded.height !== 60) { cropOk = false; console.log('FAIL: redo 未恢复裁剪后底图 =', loaded.width, loaded.height); }
  if (afterRedo.length !== 2) { cropOk = false; console.log('FAIL: redo 后批注数应为 2 =', afterRedo.length); }
  if (!afterRedo.find((o) => Math.abs(o.left - 10) < 0.01 && Math.abs(o.top - 10) < 0.01)) { cropOk = false; console.log('FAIL: redo 后 objA 未回到裁剪后 (10,10)'); }

  console.log(cropOk ? '裁剪回归 OK' : '裁剪回归 *** FAIL ***');
  c5.dispose();
}

console.log(allOk && eraserOk && selectOk && cursorOk && shotOk && cropOk ? '== 全部通过 ==' : '== 存在失败 ==');
process.exit(allOk && eraserOk && selectOk && cursorOk && shotOk && cropOk ? 0 : 1);
