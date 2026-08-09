/**
 * 马赛克工具：把底图指定矩形区域像素化，返回与原区域同尺寸的画布。
 * 原理：把区域画到小 offscreen canvas，再关闭平滑放大回去。
 */
export function createMosaicCanvas(
  source: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  blockSize: number,
): HTMLCanvasElement {
  // 裁剪到图像范围内
  const sx = Math.max(0, Math.min(x, source.width));
  const sy = Math.max(0, Math.min(y, source.height));
  const ex = Math.max(0, Math.min(x + w, source.width));
  const ey = Math.max(0, Math.min(y + h, source.height));
  const rw = Math.max(1, Math.round(ex - sx));
  const rh = Math.max(1, Math.round(ey - sy));
  const block = Math.max(2, Math.round(blockSize));

  const smallW = Math.max(1, Math.round(rw / block));
  const smallH = Math.max(1, Math.round(rh / block));

  const small = document.createElement('canvas');
  small.width = smallW;
  small.height = smallH;
  const sctx = small.getContext('2d');
  if (!sctx) throw new Error('无法创建 2D 上下文');
  sctx.drawImage(source, sx, sy, rw, rh, 0, 0, smallW, smallH);

  const out = document.createElement('canvas');
  out.width = rw;
  out.height = rh;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('无法创建 2D 上下文');
  octx.imageSmoothingEnabled = false;
  octx.drawImage(small, 0, 0, smallW, smallH, 0, 0, rw, rh);
  return out;
}
