import { useEffect, useRef, useState } from 'react';

interface DragRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 原生拖框截图的选区层（Tauri 覆盖层窗口，?mode=screenshot&screen=N 时挂载）。
 * 流程：invoke(take_screenshot, {index}) 拉本屏全屏图 → 拖框（亮框 + box-shadow 压暗四周 + 尺寸标签）
 * → 首次按下时 invoke(claim_screenshot) 关闭其他屏覆盖层 → 松手按本窗口 devicePixelRatio
 * 换算裁剪 → invoke(finish_screenshot) 交给 Rust 落盘并通知主窗口。Esc → invoke(cancel_screenshot)。
 */
export function ScreenshotOverlay() {
  // 本覆盖层对应的显示器 index（多屏时每屏一个窗口，缺省 0 = 单屏行为）
  const [screenIndex] = useState(() => {
    const n = Number(new URLSearchParams(window.location.search).get('screen') ?? '0');
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rect, setRect] = useState<DragRect | null>(null);
  const draggingRef = useRef(false);
  const finishingRef = useRef(false);
  const readySentRef = useRef(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  /** 图片加载完成 + 双帧渲染保险后，通知 Rust 显示本覆盖层（避免白/黑屏过渡） */
  const notifyReady = () => {
    if (readySentRef.current) return;
    readySentRef.current = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void import('@tauri-apps/api/core').then(({ invoke }) =>
          invoke('overlay_ready', { index: screenIndex }).catch(() => {}),
        );
      }),
    );
  };

  // 拉取 Rust 已抓取的本屏 PNG（截图在覆盖层出现前完成，画面不含本窗口）
  useEffect(() => {
    let created: string | null = null;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const bytes = await invoke<number[]>('take_screenshot', { index: screenIndex });
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
        created = url;
        setImgUrl(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        notifyReady(); // 出错也要显示覆盖层（展示错误信息、可用 Esc 退出），不等看门狗
      }
    })();
    return () => {
      if (created) URL.revokeObjectURL(created);
    };
  }, [screenIndex]);

  // Esc 取消
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void import('@tauri-apps/api/core').then(({ invoke }) => invoke('cancel_screenshot'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const finish = async (r: DragRect) => {
    const dpr = window.devicePixelRatio || 1;
    const x = Math.round(Math.min(r.x0, r.x1) * dpr);
    const y = Math.round(Math.min(r.y0, r.y1) * dpr);
    const w = Math.round(Math.abs(r.x1 - r.x0) * dpr);
    const h = Math.round(Math.abs(r.y1 - r.y0) * dpr);
    if (w < 4 || h < 4) {
      setRect(null); // 误触微拖：不清场，继续等下一次拖框
      return;
    }
    const img = imgRef.current;
    if (!img) return;
    finishingRef.current = true;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建 2D 上下文');
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('截图编码失败');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('finish_screenshot', { bytes: Array.from(bytes) });
    } catch (err) {
      finishingRef.current = false;
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const norm = rect && {
    left: Math.min(rect.x0, rect.x1),
    top: Math.min(rect.y0, rect.y1),
    width: Math.abs(rect.x1 - rect.x0),
    height: Math.abs(rect.y1 - rect.y0),
  };
  const dpr = window.devicePixelRatio || 1;

  return (
    <div
      className="fixed inset-0 cursor-crosshair select-none overflow-hidden bg-black"
      onMouseDown={(e) => {
        if (e.button !== 0 || finishingRef.current) return;
        draggingRef.current = true;
        setRect({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
        // 开始拖框即认领本屏：让 Rust 关掉其他显示器的覆盖层（fire-and-forget）
        void import('@tauri-apps/api/core').then(({ invoke }) =>
          invoke('claim_screenshot', { index: screenIndex }).catch(() => {}),
        );
      }}
      onMouseMove={(e) => {
        if (!draggingRef.current) return;
        setRect((r) => (r ? { ...r, x1: e.clientX, y1: e.clientY } : r));
      }}
      onMouseUp={(e) => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        const r = rect ? { ...rect, x1: e.clientX, y1: e.clientY } : null;
        if (r) void finish(r);
      }}
    >
      {imgUrl && (
        <img
          ref={imgRef}
          src={imgUrl}
          alt=""
          draggable={false}
          onLoad={notifyReady}
          className="absolute inset-0 h-full w-full object-fill"
        />
      )}

      {/* 未拖框时整屏压暗；拖框后改为 box-shadow 开洞（选区保持原亮度） */}
      {!norm && <div className="absolute inset-0 bg-black/35" />}
      {norm && (
        <>
          <div
            className="absolute border-2 border-sky-400"
            style={{
              left: norm.left,
              top: norm.top,
              width: norm.width,
              height: norm.height,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
            }}
          />
          <div
            className="absolute rounded bg-zinc-900/90 px-2 py-0.5 text-xs text-sky-300"
            style={{
              left: norm.left,
              top: norm.top > 24 ? norm.top - 24 : norm.top + 4,
            }}
          >
            {Math.round(norm.width * dpr)} × {Math.round(norm.height * dpr)}
          </div>
        </>
      )}

      <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-lg bg-zinc-900/85 px-4 py-1.5 text-sm text-zinc-200">
        拖动框选截图区域 · 松开完成 · Esc 取消
      </div>

      {error && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-red-500/50 bg-zinc-900/95 px-5 py-3 text-sm text-red-300">
          截图失败：{error}（按 Esc 返回）
        </div>
      )}
    </div>
  );
}
