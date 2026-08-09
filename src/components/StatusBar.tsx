import type { ImageInfo, ToolId } from '@/types';
import { TOOLS } from '@/types';

interface StatusBarProps {
  imageInfo: ImageInfo | null;
  zoom: number;
  tool: ToolId;
  message: string | null;
}

export function StatusBar({ imageInfo, zoom, tool, message }: StatusBarProps) {
  const toolDef = TOOLS.find((t) => t.id === tool);
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-zinc-800 bg-zinc-900 px-3 text-xs text-zinc-400">
      {imageInfo ? (
        <>
          <span className="max-w-[280px] truncate text-zinc-300" title={imageInfo.fileName}>
            {imageInfo.fileName}
          </span>
          <span className="shrink-0">
            {imageInfo.width} × {imageInfo.height} px
          </span>
          <span className="shrink-0 rounded border border-zinc-700 px-1.5 py-px text-[10px] text-zinc-500">
            {imageInfo.formatLabel}
          </span>
          <span className="shrink-0 text-sky-400">{Math.round(zoom * 100)}%</span>
        </>
      ) : (
        <span className="text-zinc-500">未打开图片</span>
      )}
      <div className="flex-1" />
      {message ? (
        <span className="truncate text-amber-400">{message}</span>
      ) : (
        imageInfo && toolDef && (
          <span className="hidden truncate text-zinc-500 md:block">
            {toolDef.label}：{toolDef.hint}
          </span>
        )
      )}
    </footer>
  );
}
