/**
 * 纯 TypeScript 实现的 TGA 解码器。
 *
 * 支持：
 *  - type 2  / 10：未压缩 / RLE 真彩（24 / 32 bpp，BGR(A) 存储）
 *  - type 3  / 11：未压缩 / RLE 灰度（8 bpp）
 *  - origin 翻转（descriptor 第 5 位：垂直方向；第 4 位：水平方向）
 *
 * 不支持：彩色映射（type 1/9）、15/16 bpp。
 */

export class TgaError extends Error {}

export function decodeTga(buffer: ArrayBuffer): ImageData {
  const data = new Uint8Array(buffer);
  if (data.length < 18) throw new TgaError('文件太小，不是有效的 TGA');

  const view = new DataView(buffer);
  const idLength = data[0];
  const colorMapType = data[1];
  const imageType = data[2];
  // color map spec (bytes 3..7) 忽略
  const xOrigin = view.getUint16(8, true);
  const yOrigin = view.getUint16(10, true);
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const pixelDepth = data[16];
  const descriptor = data[17];

  if (colorMapType !== 0) throw new TgaError('不支持彩色映射（colormapped）TGA');
  if (![2, 3, 10, 11].includes(imageType)) {
    throw new TgaError(`不支持的 TGA 图像类型: ${imageType}（仅支持 2/3/10/11）`);
  }
  if (width === 0 || height === 0) throw new TgaError('TGA 宽高为 0');

  const isColor = imageType === 2 || imageType === 10;
  const isGray = imageType === 3 || imageType === 11;
  const isRle = imageType === 10 || imageType === 11;

  if (isColor && pixelDepth !== 24 && pixelDepth !== 32) {
    throw new TgaError(`不支持的真彩位深: ${pixelDepth}bpp（仅支持 24/32）`);
  }
  if (isGray && pixelDepth !== 8) {
    throw new TgaError(`不支持的灰度位深: ${pixelDepth}bpp（仅支持 8）`);
  }

  const bytesPerPixel = pixelDepth / 8;
  const pixelCount = width * height;

  // origin：bit4 (0x10) = 从右到左；bit5 (0x20) = 从上到下
  const flipX = (descriptor & 0x10) !== 0;
  const flipY = (descriptor & 0x20) === 0; // TGA 默认左下角为原点

  // ---------- 读取全部像素（展开 RLE）----------
  const raw = new Uint8Array(pixelCount * bytesPerPixel);
  let offset = 18 + idLength;
  if (offset > data.length) throw new TgaError('TGA 数据截断');

  if (!isRle) {
    const needed = pixelCount * bytesPerPixel;
    if (offset + needed > data.length) throw new TgaError('TGA 像素数据不完整');
    raw.set(data.subarray(offset, offset + needed));
  } else {
    let out = 0;
    while (out < pixelCount) {
      if (offset >= data.length) throw new TgaError('TGA RLE 数据截断');
      const header = data[offset++];
      const count = (header & 0x7f) + 1;
      if (header & 0x80) {
        // RLE 包：重复 1 个像素 count 次
        if (offset + bytesPerPixel > data.length) throw new TgaError('TGA RLE 数据截断');
        for (let i = 0; i < count; i++) {
          for (let b = 0; b < bytesPerPixel; b++) raw[(out + i) * bytesPerPixel + b] = data[offset + b];
        }
        offset += bytesPerPixel;
      } else {
        // 原始包：count 个像素
        const bytes = count * bytesPerPixel;
        if (offset + bytes > data.length) throw new TgaError('TGA RLE 数据截断');
        raw.set(data.subarray(offset, offset + bytes), out * bytesPerPixel);
        offset += bytes;
      }
      out += count;
    }
  }

  // ---------- 转成 RGBA，并处理 origin 翻转 ----------
  const out = new Uint8ClampedArray(pixelCount * 4);
  for (let y = 0; y < height; y++) {
    // 源行：TGA 存储顺序中的第 y 行来自像素流索引（含 xOrigin/yOrigin 偏移忽略，假定充满整幅）
    const srcRow = flipY ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const srcCol = flipX ? width - 1 - x : x;
      const si = (srcRow * width + srcCol) * bytesPerPixel;
      const di = (y * width + x) * 4;
      if (isGray) {
        const g = raw[si];
        out[di] = g;
        out[di + 1] = g;
        out[di + 2] = g;
        out[di + 3] = 255;
      } else {
        out[di] = raw[si + 2];     // B -> R
        out[di + 1] = raw[si + 1]; // G
        out[di + 2] = raw[si];     // R -> B
        out[di + 3] = bytesPerPixel === 4 ? raw[si + 3] : 255;
      }
    }
  }

  void xOrigin;
  void yOrigin;
  return new ImageData(out, width, height);
}
