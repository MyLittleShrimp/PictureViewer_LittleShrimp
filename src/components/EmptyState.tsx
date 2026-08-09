import { ImagePlus, ClipboardPaste, MousePointerClick } from 'lucide-react';

interface EmptyStateProps {
  onOpenFile: () => void;
}

const FORMATS = ['JPG', 'PNG', 'GIF', 'WebP', 'BMP', 'AVIF', 'TGA', 'TIFF'];

export function EmptyState({ onOpenFile }: EmptyStateProps) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950">
      <button
        onClick={onOpenFile}
        className="group flex w-[520px] max-w-[85%] flex-col items-center gap-5 rounded-2xl border-2 border-dashed border-zinc-700 bg-zinc-900/40 px-10 py-12 transition-colors hover:border-sky-500 hover:bg-zinc-900/70"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-800 transition-colors group-hover:bg-sky-500/20">
          <ImagePlus className="h-8 w-8 text-zinc-400 transition-colors group-hover:text-sky-400" />
        </div>
        <div className="text-center">
          <p className="text-lg font-medium text-zinc-200">打开图片开始批注</p>
          <p className="mt-1.5 text-sm text-zinc-500">
            点击选择文件，或直接把图片拖进窗口
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <ClipboardPaste className="h-3.5 w-3.5" />
          <span>支持 Ctrl+V 粘贴剪贴板图片</span>
          <MousePointerClick className="ml-2 h-3.5 w-3.5" />
          <span>滚轮缩放 · 空格拖拽平移</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {FORMATS.map((f) => (
            <span
              key={f}
              className="rounded border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[11px] text-zinc-400"
            >
              {f}
            </span>
          ))}
        </div>
      </button>
    </div>
  );
}
