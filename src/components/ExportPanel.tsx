import { useState } from 'react';
import { X } from 'lucide-react';
import type { ExportFormat } from '@/types';

interface ExportPanelProps {
  defaultName: string;
  onCancel: () => void;
  onSave: (format: ExportFormat, quality: number, fileName: string) => void;
}

export function ExportPanel({ defaultName, onCancel, onSave }: ExportPanelProps) {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState(92);
  const [name, setName] = useState(defaultName);
  const ext = format === 'png' ? '.png' : '.jpg';

  return (
    <div className="absolute right-3 top-14 z-30 w-72 rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl shadow-black/60">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-100">导出另存为</h3>
        <button onClick={onCancel} className="rounded p-1 text-zinc-500 hover:bg-zinc-700/70 hover:text-zinc-200">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-3 flex gap-2">
        {(['png', 'jpeg'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFormat(f)}
            className={`flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors ${
              format === f
                ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
            }`}
          >
            {f === 'png' ? 'PNG（无损）' : 'JPEG'}
          </button>
        ))}
      </div>

      {format === 'jpeg' && (
        <div className="mb-3">
          <div className="mb-1 flex justify-between text-xs text-zinc-500">
            <span>质量</span>
            <span className="text-zinc-300">{quality}%</span>
          </div>
          <input
            type="range"
            min={10}
            max={100}
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded bg-zinc-700 accent-sky-500"
          />
        </div>
      )}

      <div className="mb-4">
        <label className="mb-1 block text-xs text-zinc-500">文件名</label>
        <div className="flex items-center gap-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-sky-500"
          />
          <span className="shrink-0 text-sm text-zinc-500">{ext}</span>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-700/70 hover:text-zinc-200"
        >
          取消
        </button>
        <button
          onClick={() => onSave(format, quality / 100, `${name.trim() || '批注'}${ext}`)}
          className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
        >
          保存
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
        按原图分辨率导出；支持"另存为"对话框（Chrome/Edge），否则自动下载。
      </p>
    </div>
  );
}
