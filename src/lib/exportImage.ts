import type { ExportFormat } from '@/types';

/** 把导出画布转成 Blob；JPEG 先铺白底避免透明区域变黑 */
export async function canvasToBlob(
  source: HTMLCanvasElement,
  format: ExportFormat,
  quality: number,
): Promise<Blob> {
  let canvas = source;
  if (format === 'jpeg') {
    const flat = document.createElement('canvas');
    flat.width = source.width;
    flat.height = source.height;
    const ctx = flat.getContext('2d');
    if (!ctx) throw new Error('无法创建 2D 上下文');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(source, 0, 0);
    canvas = flat;
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, format === 'png' ? 'image/png' : 'image/jpeg', format === 'jpeg' ? quality : undefined),
  );
  if (!blob) throw new Error('导出失败：浏览器无法生成图像数据');
  return blob;
}

export type SaveResult = 'saved' | 'downloaded' | 'cancelled';

/**
 * 另存为：优先 File System Access API（showSaveFilePicker），
 * 不支持或出错时降级为 <a download>。
 */
export async function saveBlobAs(
  blob: Blob,
  suggestedName: string,
  format: ExportFormat,
): Promise<SaveResult> {
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const ext = format === 'png' ? '.png' : '.jpg';

  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: '图片文件', accept: { [mime]: [ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (err) {
      // 用户取消
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // 其他错误（如安全限制）则降级下载
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}

/**
 * 把 PNG Blob 写入系统剪贴板。
 * 需要安全上下文（HTTPS 或 localhost）与剪贴板权限；失败时抛出带中文说明的错误。
 */
export async function copyImageToClipboard(blob: Blob): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('当前浏览器不支持复制图片到剪贴板（需要 Chrome/Edge 且 localhost 或 HTTPS）');
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
      throw new Error('剪贴板权限被拒绝，请检查浏览器权限设置');
    }
    throw err instanceof Error ? err : new Error('写入剪贴板失败');
  }
}
