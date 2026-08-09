import {
  FolderOpen,
  MonitorDown,
  Save,
  Copy,
  ZoomIn,
  ZoomOut,
  Maximize,
  Scan,
  Undo2,
  Redo2,
  Trash2,
} from 'lucide-react';

interface TopToolbarProps {
  hasImage: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onOpen: () => void;
  onScreenshot: () => void;
  onExport: () => void;
  onCopy: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  onZoom100: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

function ToolButton({
  title,
  onClick,
  disabled,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors
        ${disabled ? 'cursor-not-allowed text-zinc-600' : danger
          ? 'text-zinc-300 hover:bg-red-500/15 hover:text-red-400'
          : 'text-zinc-300 hover:bg-zinc-700/70 hover:text-zinc-100'}`}
    >
      {children}
    </button>
  );
}

const Sep = () => <div className="mx-1.5 h-5 w-px bg-zinc-700" />;

export function TopToolbar(p: TopToolbarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-zinc-800 bg-zinc-900 px-3">
      <span className="mr-2 select-none text-sm font-semibold tracking-wide text-zinc-100">
        图片批注查看器
      </span>
      <ToolButton title="打开图片 (拖拽 / Ctrl+V 也可以)" onClick={p.onOpen}>
        <FolderOpen className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="截图并载入 (Ctrl+Shift+S)" onClick={p.onScreenshot}>
        <MonitorDown className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="导出另存为…" onClick={p.onExport} disabled={!p.hasImage}>
        <Save className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="复制批注后的图片到剪贴板 (Ctrl+Shift+C)" onClick={p.onCopy} disabled={!p.hasImage}>
        <Copy className="h-4 w-4" />
      </ToolButton>
      <Sep />
      <ToolButton title="缩小" onClick={p.onZoomOut} disabled={!p.hasImage}>
        <ZoomOut className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="放大" onClick={p.onZoomIn} disabled={!p.hasImage}>
        <ZoomIn className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="适应窗口 (Ctrl+0)" onClick={p.onZoomFit} disabled={!p.hasImage}>
        <Maximize className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="实际大小 100% (Ctrl+1)" onClick={p.onZoom100} disabled={!p.hasImage}>
        <Scan className="h-4 w-4" />
      </ToolButton>
      <Sep />
      <ToolButton title="撤销 (Ctrl+Z)" onClick={p.onUndo} disabled={!p.canUndo}>
        <Undo2 className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="重做 (Ctrl+Shift+Z / Ctrl+Y)" onClick={p.onRedo} disabled={!p.canRedo}>
        <Redo2 className="h-4 w-4" />
      </ToolButton>
      <Sep />
      <ToolButton title="清空全部批注" onClick={p.onClear} disabled={!p.hasImage} danger>
        <Trash2 className="h-4 w-4" />
      </ToolButton>
      <div className="flex-1" />
      <span className="hidden select-none text-xs text-zinc-500 lg:block">
        V 选择 · P 画笔 · L 直线 · A 箭头 · R 矩形 · O 椭圆 · T 文字 · M 马赛克 · H 抓手
      </span>
    </header>
  );
}
