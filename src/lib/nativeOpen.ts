/**
 * Tauri 桌面端原生「打开图片」：dialog.open 选路径 + fs.readFile 读字节 → File。
 * 仅在 window.__TAURI__ 存在时调用；解码仍走前端统一管线（TGA/TIFF 前端自解）。
 */

/** 扩展名 → MIME（仅用于组装 File；解码路由仍按扩展名） */
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

/** 与 ACCEPT_STRING 一致的支持扩展名（TGA/TIFF 走前端解码，无 MIME） */
export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'tga', 'tif', 'tiff'];

export const IMAGE_OPEN_FILTERS = [{ name: '图片文件', extensions: [...IMAGE_EXTS] }];

/** 从路径取文件名（兼容 \ 与 / 分隔） */
export function baseNameOfPath(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return i >= 0 ? path.slice(i + 1) : path;
}

export function extOfPath(path: string): string {
  const name = baseNameOfPath(path);
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** 原生对话框选择图片，返回 File 列表（用户取消返回空数组） */
export async function openImagesViaNativeDialog(): Promise<File[]> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({ multiple: true, directory: false, filters: IMAGE_OPEN_FILTERS });
  if (!selected) return [];
  const paths = Array.isArray(selected) ? selected : [selected];
  const files: File[] = [];
  for (const p of paths) {
    files.push(await readImagePathAsFile(p));
  }
  return files;
}

/** 读取任意路径图片字节并组装 File（供打开对话框与文件关联共用） */
export async function readImagePathAsFile(path: string): Promise<File> {
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const bytes = await readFile(path);
  const name = baseNameOfPath(path);
  // 拷一份明确 backing 为 ArrayBuffer 的 Uint8Array，满足 BlobPart 类型
  return new File([new Uint8Array(bytes)], name, { type: EXT_MIME[extOfPath(path)] ?? '' });
}
