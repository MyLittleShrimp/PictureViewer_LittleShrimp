import {
  MousePointer2,
  Pencil,
  Slash,
  ArrowUpRight,
  Square,
  Circle,
  Type,
  Grid2X2,
  Crop,
  Eraser,
  Hand,
} from 'lucide-react';
import type { ToolId } from '@/types';
import { TOOLS, PALETTE } from '@/types';
import type { AnnotationSettings } from '@/components/Viewer';

const ICONS: Record<ToolId, React.ComponentType<{ className?: string }>> = {
  select: MousePointer2,
  pencil: Pencil,
  line: Slash,
  arrow: ArrowUpRight,
  rect: Square,
  ellipse: Circle,
  text: Type,
  mosaic: Grid2X2,
  crop: Crop,
  eraser: Eraser,
  hand: Hand,
};

interface ToolPanelProps {
  tool: ToolId;
  settings: AnnotationSettings;
  disabled: boolean;
  onToolChange: (tool: ToolId) => void;
  onSettingsChange: (settings: AnnotationSettings) => void;
}

export function ToolPanel({ tool, settings, disabled, onToolChange, onSettingsChange }: ToolPanelProps) {
  const set = (patch: Partial<AnnotationSettings>) =>
    onSettingsChange({ ...settings, ...patch });

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-zinc-800 bg-zinc-900 py-2">
      {TOOLS.map((t) => {
        const Icon = ICONS[t.id];
        const active = tool === t.id;
        return (
          <button
            key={t.id}
            disabled={disabled}
            title={`${t.label} (${t.shortcut}) — ${t.hint}`}
            onClick={() => onToolChange(t.id)}
            className={`flex h-10 w-10 flex-col items-center justify-center rounded-lg transition-colors
              ${disabled ? 'cursor-not-allowed text-zinc-700' : active
                ? 'bg-sky-500/20 text-sky-400'
                : 'text-zinc-400 hover:bg-zinc-700/70 hover:text-zinc-100'}`}
          >
            <Icon className="h-4.5 w-4.5" />
          </button>
        );
      })}

      <div className="my-1 h-px w-8 bg-zinc-700" />

      {/* 描边颜色 */}
      <div className="grid grid-cols-2 gap-1.5 px-2">
        {PALETTE.map((c) => (
          <button
            key={c}
            disabled={disabled}
            title={c}
            onClick={() => set({ color: c })}
            className={`h-5 w-5 rounded-full border transition-transform
              ${settings.color === c ? 'scale-110 border-sky-400 ring-1 ring-sky-400' : 'border-zinc-600 hover:scale-105'}
              ${disabled ? 'opacity-30' : ''}`}
            style={{ backgroundColor: c }}
          />
        ))}
        <label
          title="自定义颜色"
          className={`relative flex h-5 w-5 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-zinc-500 text-[10px] text-zinc-400
            ${disabled ? 'pointer-events-none opacity-30' : 'hover:border-sky-400'}`}
        >
          +
          <input
            type="color"
            value={settings.color}
            onChange={(e) => set({ color: e.target.value })}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>

      <div className="my-1 h-px w-8 bg-zinc-700" />

      {/* 线宽 */}
      <div className="flex w-full flex-col items-center gap-1 px-2" title={`线宽 ${settings.lineWidth}px`}>
        <span className="text-[10px] text-zinc-500">线宽</span>
        <input
          type="range"
          min={1}
          max={40}
          value={settings.lineWidth}
          disabled={disabled}
          onChange={(e) => set({ lineWidth: Number(e.target.value) })}
          className="h-1 w-9 cursor-pointer appearance-none rounded bg-zinc-700 accent-sky-500"
        />
        <span className="text-[10px] text-zinc-400">{settings.lineWidth}</span>
      </div>

      {/* 线宽基准切换：屏幕恒定 / 图像恒定（同时作用于字号） */}
      <div
        className="mt-1 flex w-full flex-col items-center gap-0.5 px-1.5"
        title={
          settings.widthBasis === 'screen'
            ? '屏幕恒定：任何缩放下画出来一样粗（线宽/字号 ÷ 当前缩放）'
            : '图像恒定：固定为 N 图像像素，缩放越大看起来越粗，导出后宽度恒定'
        }
      >
        <div className={`flex w-full overflow-hidden rounded-md border border-zinc-700 ${disabled ? 'opacity-30' : ''}`}>
          {(['screen', 'image'] as const).map((m) => (
            <button
              key={m}
              disabled={disabled}
              onClick={() => set({ widthBasis: m })}
              className={`flex-1 py-0.5 text-[10px] transition-colors ${
                settings.widthBasis === m
                  ? 'bg-sky-500/20 text-sky-400'
                  : 'text-zinc-500 hover:bg-zinc-700/70 hover:text-zinc-300'
              }`}
            >
              {m === 'screen' ? '屏幕' : '图像'}
            </button>
          ))}
        </div>
        <span className="text-center text-[9px] leading-tight text-zinc-600">
          {settings.widthBasis === 'screen' ? '屏幕恒定·一样粗' : '图像恒定·固定像素'}
        </span>
      </div>

      {/* 填充开关 */}
      <label
        className={`mt-1 flex flex-col items-center gap-0.5 text-[10px] text-zinc-500 ${disabled ? 'opacity-30' : 'cursor-pointer'}`}
        title="矩形 / 椭圆是否填充颜色"
      >
        <input
          type="checkbox"
          checked={settings.fillEnabled}
          disabled={disabled}
          onChange={(e) => set({ fillEnabled: e.target.checked })}
          className="h-3.5 w-3.5 accent-sky-500"
        />
        填充
      </label>

      {/* 字号 */}
      <div className="mt-1 flex w-full flex-col items-center gap-1 px-2" title={`文字字号 ${settings.fontSize}px`}>
        <span className="text-[10px] text-zinc-500">字号</span>
        <input
          type="range"
          min={10}
          max={120}
          value={settings.fontSize}
          disabled={disabled}
          onChange={(e) => set({ fontSize: Number(e.target.value) })}
          className="h-1 w-9 cursor-pointer appearance-none rounded bg-zinc-700 accent-sky-500"
        />
        <span className="text-[10px] text-zinc-400">{settings.fontSize}</span>
      </div>
    </aside>
  );
}
