/**
 * 橡皮擦命中检测：圆形光标与对象包围盒（AABB）是否相交。
 * 圆心到矩形最近点的距离 ≤ 半径 即命中。
 */
export interface RectBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function circleHitsRect(cx: number, cy: number, r: number, rect: RectBounds): boolean {
  const nx = Math.max(rect.left, Math.min(cx, rect.left + rect.width));
  const ny = Math.max(rect.top, Math.min(cy, rect.top + rect.height));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

/** 橡皮擦光标屏幕半径（约 2.5 倍线宽直径，最小 10px） */
export function eraserScreenRadius(lineWidth: number): number {
  return Math.max(10, lineWidth * 1.25);
}
