/** 批注工具类型 */
export type ToolId =
  | 'select'   // 选择/移动 (V)
  | 'pencil'   // 自由画笔 (P)
  | 'line'     // 直线 (L)
  | 'arrow'    // 箭头 (A)
  | 'rect'     // 矩形 (R)
  | 'ellipse'  // 椭圆 (O)
  | 'text'     // 文字 (T)
  | 'mosaic'   // 马赛克 (M)
  | 'crop'     // 裁剪 (C)
  | 'eraser'   // 橡皮擦 (E)
  | 'hand';    // 抓手 (H)

export interface ToolDef {
  id: ToolId;
  label: string;
  shortcut: string;
  hint: string;
}

export const TOOLS: ToolDef[] = [
  { id: 'select',  label: '选择',   shortcut: 'V', hint: '选中后可拖动 / 缩放 / 旋转批注，Delete 删除' },
  { id: 'pencil',  label: '画笔',   shortcut: 'P', hint: '按住鼠标自由绘制' },
  { id: 'line',    label: '直线',   shortcut: 'L', hint: '按住拖拽绘制直线' },
  { id: 'arrow',   label: '箭头',   shortcut: 'A', hint: '按住拖拽绘制箭头' },
  { id: 'rect',    label: '矩形',   shortcut: 'R', hint: '按住拖拽绘制矩形' },
  { id: 'ellipse', label: '椭圆',   shortcut: 'O', hint: '按住拖拽绘制椭圆' },
  { id: 'text',    label: '文字',   shortcut: 'T', hint: '单击放置文字，双击已有文字可再次编辑' },
  { id: 'mosaic',  label: '马赛克', shortcut: 'M', hint: '拖出矩形区域，对底图该区域打马赛克' },
  { id: 'crop',    label: '裁剪',   shortcut: 'C', hint: '拖动框选裁剪区域，Enter 确认，Esc 取消' },
  { id: 'eraser',  label: '橡皮擦', shortcut: 'E', hint: '按住拖过批注，高亮的对象在松手后删除（可 Ctrl+Z 撤销）' },
  { id: 'hand',    label: '抓手',   shortcut: 'H', hint: '拖拽平移视图（任何工具下按住空格也可平移）' },
];

/** 已解码的图片：统一为自然分辨率的 canvas */
export interface LoadedImage {
  /** 自然分辨率位图 */
  source: HTMLCanvasElement;
  width: number;
  height: number;
  fileName: string;
  /** 原始格式描述，如 PNG / TGA / TIFF */
  formatLabel: string;
}

export interface ImageInfo {
  fileName: string;
  width: number;
  height: number;
  formatLabel: string;
}

export type ExportFormat = 'png' | 'jpeg';

/** 常用批注色板 */
export const PALETTE = [
  '#ef4444', // 红
  '#f97316', // 橙
  '#facc15', // 黄
  '#22c55e', // 绿
  '#06b6d4', // 青
  '#3b82f6', // 蓝
  '#a855f7', // 紫
  '#ffffff', // 白
  '#000000', // 黑
];
