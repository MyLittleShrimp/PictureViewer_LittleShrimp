/**
 * 屏幕截图（Screen Capture API）。
 * getDisplayMedia 弹出浏览器选择器（整个屏幕 / 窗口 / 标签页），
 * 从视频轨抓一帧原始分辨率位图后立即停止采集，避免长时间录屏指示。
 */

/** 当前环境是否支持屏幕截图（需 secure context + getDisplayMedia） */
export function isScreenshotSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
}

export const SCREENSHOT_UNSUPPORTED_MSG =
  '当前浏览器不支持截图（需 Chrome / Edge / Firefox 桌面版，且页面运行在 localhost 或 HTTPS 环境）';

/** 截图文件名：截图_YYYYMMDD-HHmmss.png（本地时间） */
export function screenshotFileName(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `截图_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.png`
  );
}

/** 等待 video 出现真实首帧（loadeddata + 2 个动画帧，规避黑帧） */
async function waitFirstFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState < 2 /* HAVE_CURRENT_DATA */) {
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadeddata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('视频加载失败')), { once: true });
    });
  }
  await new Promise<void>((resolve) => {
    let n = 0;
    const step = () => {
      n += 1;
      if (n >= 2) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/**
 * 截取一帧屏幕/窗口画面，返回原始分辨率 canvas。
 * 用户在选择器里点"取消"时抛 DOMException(NotAllowedError)。
 */
export async function captureScreenshot(): Promise<HTMLCanvasElement> {
  if (!isScreenshotSupported()) throw new Error(SCREENSHOT_UNSUPPORTED_MSG);
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('未获取到视频轨');
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    await waitFirstFrame(video);
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error('无法读取画面尺寸');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 2D 上下文');
    ctx.drawImage(video, 0, 0, w, h);
    video.srcObject = null;
    return canvas;
  } finally {
    // 立即停止所有 track，结束系统录屏指示
    stream.getTracks().forEach((t) => t.stop());
  }
}

/** 截屏并编码为 PNG File（走现有图片加载流程） */
export async function captureScreenshotFile(): Promise<File> {
  const canvas = await captureScreenshot();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('截图编码失败');
  return new File([blob], screenshotFileName(), { type: 'image/png' });
}
