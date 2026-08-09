import * as UTIF from 'utif';
import { decodeTga } from './tga';
import type { LoadedImage } from '@/types';

const NATIVE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif'];

export function getExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function isSupportedFile(name: string): boolean {
  const ext = getExt(name);
  return NATIVE_EXTS.includes(ext) || ext === 'tga' || ext === 'tif' || ext === 'tiff';
}

export const ACCEPT_STRING =
  '.jpg,.jpeg,.png,.gif,.webp,.bmp,.avif,.tga,.tif,.tiff,image/*';

function imageDataToCanvas(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 上下文');
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/** 浏览器原生解码（blob URL → Image → canvas） */
async function decodeNative(file: File | Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('浏览器无法解码该图片'));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 2D 上下文');
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** TIFF 解码：UTIF.decode → decodeImage → toRGBA8 → ImageData（取第一帧） */
function decodeTiff(buffer: ArrayBuffer): HTMLCanvasElement {
  const ifds = UTIF.decode(buffer);
  if (!ifds.length) throw new Error('TIFF 中没有图像帧');
  const ifd = ifds[0];
  UTIF.decodeImage(buffer, ifd);
  const rgba = UTIF.toRGBA8(ifd);
  const imageData = new ImageData(new Uint8ClampedArray(rgba), ifd.width, ifd.height);
  return imageDataToCanvas(imageData);
}

/**
 * 统一解码入口：File → 自然分辨率 canvas。
 * 支持 JPG/PNG/GIF/WebP/BMP/AVIF（原生）、TGA（自研解码器）、TIFF（utif）。
 */
export async function loadImageFile(file: File): Promise<LoadedImage> {
  const ext = getExt(file.name);
  const formatLabel = (ext || 'unknown').toUpperCase();

  let source: HTMLCanvasElement;
  if (ext === 'tga') {
    const buffer = await file.arrayBuffer();
    source = imageDataToCanvas(decodeTga(buffer));
  } else if (ext === 'tif' || ext === 'tiff') {
    const buffer = await file.arrayBuffer();
    source = decodeTiff(buffer);
  } else if (NATIVE_EXTS.includes(ext) || file.type.startsWith('image/')) {
    source = await decodeNative(file);
  } else {
    throw new Error(`不支持的文件格式: ${file.name}`);
  }

  return {
    source,
    width: source.width,
    height: source.height,
    fileName: file.name,
    formatLabel,
  };
}

/** 去掉扩展名的文件名 */
export function baseName(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i > 0 ? fileName.slice(0, i) : fileName;
}
