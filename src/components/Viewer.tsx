import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Canvas,
  FabricImage,
  PencilBrush,
  Line,
  Rect,
  Ellipse,
  Circle,
  Path,
  Textbox,
  Point,
  util,
} from 'fabric';
import type { FabricObject } from 'fabric';
import type { ImageInfo, LoadedImage, ToolId, ExportFormat } from '@/types';
import { loadImageFile, isSupportedFile, ACCEPT_STRING } from '@/lib/imageLoader';
import { createMosaicCanvas } from '@/lib/mosaic';
import { canvasToBlob } from '@/lib/exportImage';
import { circleHitsRect, eraserScreenRadius } from '@/lib/eraser';
import { EmptyState } from '@/components/EmptyState';

export interface AnnotationSettings {
  color: string;
  lineWidth: number;
  fillEnabled: boolean;
  fontSize: number;
  /** 线宽/字号基准：screen=屏幕恒定（÷当前缩放），image=图像恒定（固定图像像素） */
  widthBasis: 'screen' | 'image';
}

export interface ViewerHandle {
  openFileDialog: () => void;
  openFile: (file: File) => Promise<void>;
  undo: () => void;
  redo: () => void;
  clearAnnotations: () => void;
  zoomFit: () => void;
  zoom100: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  exportImage: (format: ExportFormat, quality: number) => Promise<Blob>;
  hasImage: () => boolean;
  annotationCount: () => number;
}

interface ViewerProps {
  tool: ToolId;
  settings: AnnotationSettings;
  onToolChange: (tool: ToolId) => void;
  onZoomChange: (zoom: number) => void;
  onImageLoad: (info: ImageInfo) => void;
  onHistoryChange: (canUndo: boolean, canRedo: boolean) => void;
  onError: (message: string) => void;
  onCopy: () => void;
  onScreenshot: () => void;
  onImageCleared?: () => void;
}

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 60;
const HISTORY_LIMIT = 50;

/**
 * 历史条目：普通批注快照只存对象序列化（json）；
 * 裁剪等改动底图的操作额外携带底图引用（bg），undo/redo 时一并恢复。
 * bg 只是对已存在位图的引用，不给普通快照增加负担。
 */
interface HistoryEntry {
  json: string;
  bg?: LoadedImage;
}

/** 标记位：橡皮擦跟随光标 / 裁剪遮罩视觉（都不进快照、不进导出） */
type MarkerObject = FabricObject & { __eraserCursor?: boolean; __cropOverlay?: boolean };

/** 按线宽基准换算描边宽度（图像坐标系） */
function basisStrokeWidth(s: AnnotationSettings, zoom: number): number {
  return s.widthBasis === 'screen' ? Math.max(0.5, s.lineWidth / zoom) : s.lineWidth;
}

/** 按线宽基准换算画笔宽度（PencilBrush 最小 1px） */
function basisBrushWidth(s: AnnotationSettings, zoom: number): number {
  return Math.max(1, basisStrokeWidth(s, zoom));
}

/** 按线宽基准换算字号（图像坐标系） */
function basisFontSize(s: AnnotationSettings, zoom: number): number {
  return s.widthBasis === 'screen' ? Math.max(4, s.fontSize / zoom) : s.fontSize;
}

function buildArrowPath(x1: number, y1: number, x2: number, y2: number, strokeWidth: number): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = Math.max(12, strokeWidth * 4);
  const spread = Math.PI / 7;
  const hx1 = x2 - headLen * Math.cos(angle - spread);
  const hy1 = y2 - headLen * Math.sin(angle - spread);
  const hx2 = x2 - headLen * Math.cos(angle + spread);
  const hy2 = y2 - headLen * Math.sin(angle + spread);
  return `M ${x1} ${y1} L ${x2} ${y2} L ${hx1} ${hy1} M ${x2} ${y2} L ${hx2} ${hy2}`;
}

export const Viewer = forwardRef<ViewerHandle, ViewerProps>(function Viewer(props, ref) {
  const { onToolChange, onZoomChange, onImageLoad, onHistoryChange, onError } = props;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const loadedRef = useRef<LoadedImage | null>(null);
  const toolRef = useRef<ToolId>(props.tool);
  const settingsRef = useRef<AnnotationSettings>(props.settings);
  const onCopyRef = useRef(props.onCopy);
  useEffect(() => {
    onCopyRef.current = props.onCopy;
  }, [props.onCopy]);
  const onScreenshotRef = useRef(props.onScreenshot);
  useEffect(() => {
    onScreenshotRef.current = props.onScreenshot;
  }, [props.onScreenshot]);
  const spaceDownRef = useRef(false);
  const panningRef = useRef<{ lastX: number; lastY: number } | null>(null);
  const drawingRef = useRef(false);
  const restoringRef = useRef(false);
  const historyRef = useRef<{ stack: HistoryEntry[]; index: number }>({ stack: [], index: -1 });
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const tempObjRef = useRef<FabricObject | null>(null);
  // 橡皮擦状态：拖拽中、本次命中集合（对象 → 原 opacity）、跟随光标
  const erasingRef = useRef(false);
  const eraserHitsRef = useRef<Map<FabricObject, number> | null>(null);
  const eraserCursorRef = useRef<Circle | null>(null);
  // 裁剪状态：选区（图像坐标）、拖拽起点、遮罩/描边视觉对象、确认/取消回调
  const cropRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const cropStartRef = useRef<{ x: number; y: number } | null>(null);
  const cropVisualsRef = useRef<FabricObject[]>([]);
  const confirmCropRef = useRef<(() => void) | null>(null);
  const cancelCropRef = useRef<(() => void) | null>(null);

  const [hasImage, setHasImage] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [cropDraft, setCropDraft] = useState(false); // 有待确认的裁剪选区（浮动确认条）

  // 保持 props 镜像到 ref，供 fabric 事件闭包读取
  useEffect(() => {
    settingsRef.current = props.settings;
    const canvas = fabricRef.current;
    if (canvas?.isDrawingMode && canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = props.settings.color;
      canvas.freeDrawingBrush.width = basisBrushWidth(props.settings, canvas.getZoom());
    }
  }, [props.settings]);

  const notifyHistory = useCallback(() => {
    const { stack, index } = historyRef.current;
    onHistoryChange(index > 0, index >= 0 && index < stack.length - 1);
  }, [onHistoryChange]);

  const serializeObjects = useCallback((canvas: Canvas): string => {
    // 排除橡皮擦跟随光标与裁剪遮罩视觉（非批注对象，不进快照；
    // 它们 add/remove 触发的 object:added/removed 也因此被下面的去重跳过，不污染历史）
    return JSON.stringify(
      canvas
        .getObjects()
        .filter((o) => {
          const m = o as MarkerObject;
          return !m.__eraserCursor && !m.__cropOverlay;
        })
        .map((o) => o.toObject(['selectable', 'evented'])),
    );
  }, []);

  /** bg：仅裁剪等改动底图的操作传入，随条目一起保存底图引用供 undo/redo 恢复 */
  const pushHistory = useCallback(
    (bg?: LoadedImage) => {
      const canvas = fabricRef.current;
      if (!canvas || restoringRef.current || drawingRef.current) return;
      const h = historyRef.current;
      const json = serializeObjects(canvas);
      if (bg === undefined && h.index >= 0 && h.stack[h.index].json === json) return;
      h.stack = h.stack.slice(0, h.index + 1);
      h.stack.push(bg === undefined ? { json } : { json, bg });
      if (h.stack.length > HISTORY_LIMIT) h.stack.shift();
      h.index = h.stack.length - 1;
      notifyHistory();
    },
    [notifyHistory, serializeObjects],
  );

  const applyToolMode = useCallback((tool: ToolId) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const s = settingsRef.current;
    canvas.isDrawingMode = tool === 'pencil';
    canvas.selection = tool === 'select';
    canvas.skipTargetFind = !(tool === 'select' || tool === 'text');
    canvas.defaultCursor =
      tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : tool === 'eraser' ? 'none' : 'crosshair';
    canvas.hoverCursor = tool === 'hand' ? 'grab' : 'move';
    // 离开橡皮擦工具时清理跟随光标
    if (tool !== 'eraser' && eraserCursorRef.current) {
      canvas.remove(eraserCursorRef.current);
      eraserCursorRef.current = null;
      canvas.requestRenderAll();
    }
    // 离开橡皮擦时若处于拖拽中，按"空擦"结束（不删除、不快照）
    if (tool !== 'eraser' && erasingRef.current) {
      erasingRef.current = false;
      const hits = eraserHitsRef.current;
      eraserHitsRef.current = null;
      if (hits) for (const [obj, op] of hits) obj.set('opacity', op);
    }
    // 切换工具自动取消未确认的裁剪选区
    if (tool !== 'crop' && (cropRectRef.current || cropStartRef.current || cropVisualsRef.current.length)) {
      cropStartRef.current = null;
      cropRectRef.current = null;
      cropVisualsRef.current.forEach((v) => canvas.remove(v));
      cropVisualsRef.current = [];
      setCropDraft(false);
      canvas.requestRenderAll();
    }
    if (tool === 'pencil') {
      const brush = new PencilBrush(canvas);
      brush.color = s.color;
      brush.width = basisBrushWidth(s, canvas.getZoom());
      canvas.freeDrawingBrush = brush;
    }
    if (tool !== 'select') {
      // 正在编辑文字时不得 discard，否则会强制退出编辑态
      const active = canvas.getActiveObject() as (FabricObject & { isEditing?: boolean }) | undefined;
      if (!active?.isEditing) canvas.discardActiveObject();
    }
    canvas.requestRenderAll();
  }, []);

  useEffect(() => {
    toolRef.current = props.tool;
    applyToolMode(props.tool);
  }, [props.tool, applyToolMode]);

  const updateZoomDisplay = useCallback(() => {
    const canvas = fabricRef.current;
    if (canvas) onZoomChange(canvas.getZoom());
  }, [onZoomChange]);

  const zoomTo = useCallback(
    (zoom: number, point?: Point) => {
      const canvas = fabricRef.current;
      if (!canvas || !loadedRef.current) return;
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
      const p = point ?? new Point(canvas.getWidth() / 2, canvas.getHeight() / 2);
      canvas.zoomToPoint(p, z);
      canvas.requestRenderAll();
      updateZoomDisplay();
    },
    [updateZoomDisplay],
  );

  const zoomFit = useCallback(() => {
    const canvas = fabricRef.current;
    const loaded = loadedRef.current;
    if (!canvas || !loaded) return;
    const cw = canvas.getWidth();
    const ch = canvas.getHeight();
    if (cw === 0 || ch === 0) return;
    const z = Math.min(cw / loaded.width, ch / loaded.height) * 0.96;
    canvas.setViewportTransform([z, 0, 0, z, (cw - loaded.width * z) / 2, (ch - loaded.height * z) / 2]);
    canvas.requestRenderAll();
    updateZoomDisplay();
  }, [updateZoomDisplay]);

  const applySnapshot = useCallback(
    async (entry: HistoryEntry) => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      restoringRef.current = true;
      // 条目携带底图引用且与当前不同（裁剪的 undo/redo）→ 先恢复底图
      const bgChanged = entry.bg !== undefined && entry.bg !== loadedRef.current;
      try {
        canvas.discardActiveObject();
        canvas.remove(...canvas.getObjects());
        // remove-all 会把橡皮擦光标一起删掉，必须让引用失效，
        // 否则 updateEraserCursor 只对 null 重建 → 光标永久丢失（画布无光标）
        eraserCursorRef.current = null;
        // 同理：remove-all 也会清掉裁剪遮罩/选框，重置裁剪状态（未确认选区随快照切换消失）
        cropStartRef.current = null;
        cropRectRef.current = null;
        cropVisualsRef.current = [];
        setCropDraft(false);
        if (bgChanged && entry.bg) {
          const bg = entry.bg;
          loadedRef.current = bg;
          canvas.backgroundImage = new FabricImage(bg.source, {
            left: 0,
            top: 0,
            originX: 'left',
            originY: 'top',
          });
          onImageLoad({
            fileName: bg.fileName,
            width: bg.width,
            height: bg.height,
            formatLabel: bg.formatLabel,
          });
        }
        const plain = JSON.parse(entry.json) as Record<string, unknown>[];
        const objects = (await util.enlivenObjects(plain)) as unknown as FabricObject[];
        objects.forEach((o) => canvas.add(o));
        canvas.requestRenderAll();
      } finally {
        restoringRef.current = false;
      }
      if (bgChanged) zoomFit(); // 底图尺寸变了，恢复"适应窗口"视图
      notifyHistory();
    },
    [notifyHistory, onImageLoad, zoomFit],
  );

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.index <= 0) return;
    h.index -= 1;
    void applySnapshot(h.stack[h.index]);
  }, [applySnapshot]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.index >= h.stack.length - 1) return;
    h.index += 1;
    void applySnapshot(h.stack[h.index]);
  }, [applySnapshot]);

  const loadImage = useCallback(
    async (file: File) => {
      if (!isSupportedFile(file.name) && !file.type.startsWith('image/')) {
        onError(`不支持的文件格式：${file.name}`);
        return;
      }
      const canvas = fabricRef.current;
      if (!canvas) return;
      try {
        const loaded = await loadImageFile(file);
        loadedRef.current = loaded;
        drawingRef.current = true; // 装载过程不记历史
        try {
          canvas.discardActiveObject();
          canvas.remove(...canvas.getObjects());
          eraserCursorRef.current = null; // 橡皮擦光标随对象一起被移除，重置引用
          erasingRef.current = false;
          eraserHitsRef.current = null;
          // 裁剪选区/遮罩同样随 remove-all 消失，重置裁剪状态
          cropStartRef.current = null;
          cropRectRef.current = null;
          cropVisualsRef.current = [];
          setCropDraft(false);
          const bg = new FabricImage(loaded.source, {
            left: 0,
            top: 0,
            originX: 'left',
            originY: 'top',
          });
          canvas.backgroundImage = bg;
          canvas.backgroundColor = 'rgba(0,0,0,0)';
        } finally {
          drawingRef.current = false;
        }
        setHasImage(true);
        onImageLoad({
          fileName: loaded.fileName,
          width: loaded.width,
          height: loaded.height,
          formatLabel: loaded.formatLabel,
        });
        // 重置历史
        historyRef.current = { stack: [{ json: serializeObjects(canvas) }], index: 0 };
        notifyHistory();
        zoomFit();
        canvas.requestRenderAll();
      } catch (err) {
        onError(err instanceof Error ? err.message : '图片解码失败');
      }
    },
    [notifyHistory, onError, onImageLoad, serializeObjects, zoomFit],
  );

  const clearAnnotations = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    drawingRef.current = true;
    try {
      canvas.discardActiveObject();
      canvas.remove(...canvas.getObjects());
      eraserCursorRef.current = null; // 清空同样会移除橡皮擦光标，引用置空待重建
      canvas.requestRenderAll();
    } finally {
      drawingRef.current = false;
    }
    pushHistory();
  }, [pushHistory]);

  const exportImage = useCallback(
    async (format: ExportFormat, quality: number): Promise<Blob> => {
      const canvas = fabricRef.current;
      const loaded = loadedRef.current;
      if (!canvas || !loaded) throw new Error('尚未打开图片');

      // 保存视图状态
      const vpt = [...canvas.viewportTransform] as [number, number, number, number, number, number];
      const cw = canvas.getWidth();
      const ch = canvas.getHeight();

      // 切到原图分辨率、无缩放的导出状态
      canvas.discardActiveObject();
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      canvas.setDimensions({ width: loaded.width, height: loaded.height });
      canvas.renderAll();
      const flat = canvas.toCanvasElement(1);

      // 恢复视图
      canvas.setDimensions({ width: cw, height: ch });
      canvas.setViewportTransform(vpt);
      canvas.requestRenderAll();

      return canvasToBlob(flat, format, quality);
    },
    [],
  );

  /** 打开图片入口：Tauri 桌面端走原生对话框，网页版走隐藏的 input[type=file]（行为不变） */
  const openFileDialog = useCallback(() => {
    if (window.__TAURI__) {
      void (async () => {
        try {
          const { openImagesViaNativeDialog } = await import('@/lib/nativeOpen');
          const files = await openImagesViaNativeDialog();
          if (files.length > 0) await loadImage(files[0]); // 单图工作区：取第一个
        } catch (err) {
          onError(err instanceof Error ? `打开失败：${err.message}` : '打开失败，请重试');
        }
      })();
      return;
    }
    fileInputRef.current?.click();
  }, [loadImage, onError]);

  useImperativeHandle(ref, () => ({
    openFileDialog,
    openFile: loadImage,
    undo,
    redo,
    clearAnnotations,
    zoomFit,
    zoom100: () => zoomTo(1),
    zoomIn: () => {
      const canvas = fabricRef.current;
      if (canvas) zoomTo(canvas.getZoom() * 1.25);
    },
    zoomOut: () => {
      const canvas = fabricRef.current;
      if (canvas) zoomTo(canvas.getZoom() / 1.25);
    },
    exportImage,
    hasImage: () => !!loadedRef.current,
    annotationCount: () => fabricRef.current?.getObjects().length ?? 0,
  }), [openFileDialog, loadImage, undo, redo, clearAnnotations, zoomFit, zoomTo, exportImage]);

  // ---------------- 画布初始化（仅一次） ----------------
  useEffect(() => {
    const el = canvasElRef.current;
    const wrapper = wrapperRef.current;
    if (!el || !wrapper) return;

    const canvas = new Canvas(el, {
      preserveObjectStacking: true,
      stopContextMenu: true,
      fireRightClick: false,
      uniformScaling: false,
    });
    fabricRef.current = canvas;

    const resize = () => {
      const rect = wrapper.getBoundingClientRect();
      canvas.setDimensions({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
      canvas.requestRenderAll();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);

    const isPanningTool = () => toolRef.current === 'hand' || spaceDownRef.current;

    // ---------- 橡皮擦辅助 ----------
    /** 橡皮擦半径（图像坐标），按 ~2.5 倍线宽直径（最小 20px 直径）的屏幕尺寸换算 */
    const eraserRadius = () => eraserScreenRadius(settingsRef.current.lineWidth) / canvas.getZoom();

    /** 圆形光标与对象包围盒求交，命中对象收集进 eraserHitsRef 并降透明度高亮 */
    const collectEraserHits = (pt: Point) => {
      const hits = eraserHitsRef.current;
      if (!hits) return;
      const r = eraserRadius();
      for (const obj of canvas.getObjects()) {
        if ((obj as FabricObject & { __eraserCursor?: boolean }).__eraserCursor) continue;
        if (hits.has(obj)) continue;
        obj.setCoords();
        const b = obj.getBoundingRect();
        if (circleHitsRect(pt.x, pt.y, r, b)) {
          hits.set(obj, obj.opacity ?? 1);
          obj.set('opacity', 0.35);
        }
      }
    };

    /** 创建/移动橡皮擦跟随光标（非事件化、不进导出、不进快照） */
    const updateEraserCursor = (pt: Point) => {
      if (!loadedRef.current) return;
      // 防御：引用对象可能已被 remove-all 类路径（undo/redo/清空/加载新图）移出画布
      if (eraserCursorRef.current && !canvas.getObjects().includes(eraserCursorRef.current)) {
        eraserCursorRef.current = null;
      }
      const r = eraserRadius();
      const strokeW = Math.max(0.5, 1 / canvas.getZoom());
      let cursor = eraserCursorRef.current;
      if (!cursor) {
        cursor = new Circle({
          radius: r,
          left: pt.x,
          top: pt.y,
          originX: 'center',
          originY: 'center',
          fill: 'rgba(255,255,255,0.12)',
          stroke: '#ffffff',
          strokeWidth: strokeW,
          selectable: false,
          evented: false,
          excludeFromExport: true,
        });
        (cursor as FabricObject & { __eraserCursor?: boolean }).__eraserCursor = true;
        eraserCursorRef.current = cursor;
        canvas.add(cursor);
      } else {
        cursor.set({ left: pt.x, top: pt.y, radius: r, strokeWidth: strokeW, visible: true });
      }
      canvas.requestRenderAll();
    };

    // ---------- 裁剪辅助 ----------
    /** 标记为裁剪视觉（不进快照、不进导出、不可选） */
    const markCropVisual = <T extends FabricObject>(o: T): T => {
      o.set({ selectable: false, evented: false, excludeFromExport: true });
      (o as MarkerObject).__cropOverlay = true;
      return o;
    };

    /** 按当前 cropRectRef 重建遮罩 + 描边 + 四角手柄（重拖直接覆盖上一个选区） */
    const renderCropVisuals = () => {
      cropVisualsRef.current.forEach((v) => canvas.remove(v));
      cropVisualsRef.current = [];
      const r = cropRectRef.current;
      const loaded = loadedRef.current;
      if (!r || !loaded) { canvas.requestRenderAll(); return; }
      const W = loaded.width;
      const H = loaded.height;
      const mask = 'rgba(0,0,0,0.5)';
      const mkMask = (left: number, top: number, width: number, height: number) =>
        markCropVisual(new Rect({ left, top, width: Math.max(0, width), height: Math.max(0, height), originX: 'left', originY: 'top', fill: mask }));
      const zoom = canvas.getZoom();
      const strokeW = Math.max(0.5, 2 / zoom);
      const border = markCropVisual(new Rect({
        left: r.x, top: r.y, width: r.w, height: r.h, originX: 'left', originY: 'top',
        fill: 'rgba(0,0,0,0)', stroke: '#38bdf8', strokeWidth: strokeW, strokeUniform: true,
      }));
      const hs = Math.max(4, 8 / zoom); // 角手柄边长（仅视觉，不响应拖拽）
      const mkHandle = (cx: number, cy: number) =>
        markCropVisual(new Rect({
          left: cx, top: cy, width: hs, height: hs, originX: 'center', originY: 'center',
          fill: '#38bdf8', stroke: '#0c4a6e', strokeWidth: Math.max(0.5, 1 / zoom), strokeUniform: true,
        }));
      cropVisualsRef.current = [
        mkMask(0, 0, W, r.y),                    // 上
        mkMask(0, r.y + r.h, W, H - (r.y + r.h)), // 下
        mkMask(0, r.y, r.x, r.h),                 // 左
        mkMask(r.x + r.w, r.y, W - (r.x + r.w), r.h), // 右
        border,
        mkHandle(r.x, r.y),
        mkHandle(r.x + r.w, r.y),
        mkHandle(r.x, r.y + r.h),
        mkHandle(r.x + r.w, r.y + r.h),
      ];
      canvas.add(...cropVisualsRef.current);
      canvas.requestRenderAll();
    };

    const clearCropDraft = () => {
      cropStartRef.current = null;
      cropRectRef.current = null;
      cropVisualsRef.current.forEach((v) => canvas.remove(v));
      cropVisualsRef.current = [];
      setCropDraft(false);
      canvas.requestRenderAll();
    };

    /** 确认裁剪：裁底图 → 批注平移 (-x,-y)、删区外对象 → 画布/状态栏/视图更新 → 可撤销 */
    const confirmCrop = () => {
      const loaded = loadedRef.current;
      const r = cropRectRef.current;
      if (!loaded || !r) return;
      // 收敛到图像范围内并取整
      const x = Math.max(0, Math.min(Math.round(r.x), loaded.width - 1));
      const y = Math.max(0, Math.min(Math.round(r.y), loaded.height - 1));
      const x2 = Math.max(x + 1, Math.min(Math.round(r.x + r.w), loaded.width));
      const y2 = Math.max(y + 1, Math.min(Math.round(r.y + r.h), loaded.height));
      const w = x2 - x;
      const h = y2 - y;
      if (w < 8 || h < 8) {
        onError('选区太小：裁剪区域至少 8×8 图像像素，请重新拖框');
        return; // 保留当前选区，允许重新拖框覆盖
      }

      // 1) 历史栈顶条目挂上"裁剪前底图"引用——undo 回到此条目时连底图一起恢复
      const hist = historyRef.current;
      if (hist.index >= 0) hist.stack[hist.index] = { ...hist.stack[hist.index], bg: loaded };

      // 2) 裁出新底图位图
      const cropped = document.createElement('canvas');
      cropped.width = w;
      cropped.height = h;
      const ctx = cropped.getContext('2d');
      if (!ctx) { onError('无法创建 2D 上下文'); return; }
      ctx.drawImage(loaded.source, x, y, w, h, 0, 0, w, h);
      const next: LoadedImage = { source: cropped, width: w, height: h, fileName: loaded.fileName, formatLabel: loaded.formatLabel };

      // 3) 应用变更（屏蔽 object:removed 等事件的逐对象历史触发）
      drawingRef.current = true;
      try {
        cropVisualsRef.current.forEach((v) => canvas.remove(v));
        cropVisualsRef.current = [];
        for (const obj of [...canvas.getObjects()]) {
          if ((obj as MarkerObject).__eraserCursor) continue;
          const b = obj.getBoundingRect(); // 场景坐标 = 图像坐标（底图在 0,0）
          const outside = b.left + b.width <= x || b.left >= x + w || b.top + b.height <= y || b.top >= y + h;
          if (outside) { canvas.remove(obj); continue; } // 完全落在裁剪区外 → 删除
          obj.set({ left: obj.left - x, top: obj.top - y });
          obj.setCoords(); // set() 后必须刷新 aCoords 缓存，否则选择命中过期
        }
        loadedRef.current = next;
        canvas.backgroundImage = new FabricImage(cropped, { left: 0, top: 0, originX: 'left', originY: 'top' });
      } finally {
        drawingRef.current = false;
      }

      cropStartRef.current = null;
      cropRectRef.current = null;
      setCropDraft(false);
      onImageLoad({ fileName: next.fileName, width: w, height: h, formatLabel: next.formatLabel });
      pushHistory(next); // 裁剪后快照（携带新底图引用，redo 用）
      zoomFit();
      canvas.requestRenderAll();
    };

    confirmCropRef.current = confirmCrop;
    cancelCropRef.current = clearCropDraft;

    // ---------- 鼠标：平移 / 绘制 ----------
    canvas.on('mouse:down', (opt) => {
      const e = opt.e as MouseEvent;
      if (e.button !== 0) return;
      if (!loadedRef.current) return;

      if (isPanningTool()) {
        panningRef.current = { lastX: e.clientX, lastY: e.clientY };
        canvas.defaultCursor = 'grabbing';
        canvas.requestRenderAll();
        return;
      }

      const tool = toolRef.current;
      const s = settingsRef.current;
      const pt = opt.scenePoint;
      const zoom = canvas.getZoom();
      const strokeWidth = basisStrokeWidth(s, zoom);
      const fillValue = s.fillEnabled ? s.color : 'rgba(0,0,0,0)';

      // 文字工具：点在已有文字上 → 进入编辑；否则新建
      if (tool === 'text') {
        const target = opt.target;
        if (target instanceof Textbox) {
          canvas.setActiveObject(target);
          target.enterEditing();
          canvas.requestRenderAll();
          return;
        }
        const tb = new Textbox('双击编辑', {
          left: pt.x,
          top: pt.y,
          originX: 'left',
          originY: 'top',
          fontSize: basisFontSize(s, zoom),
          fill: s.color,
          width: Math.max(80, 240 / zoom),
          fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
        });
        canvas.add(tb);
        tb.setCoords(); // 保证文字对象的命中缓存立即有效
        canvas.setActiveObject(tb);
        tb.enterEditing();
        tb.selectAll();
        canvas.requestRenderAll();
        return;
      }

      // 橡皮擦：开始一次擦除拖拽，立即命中检测一次
      if (tool === 'eraser') {
        erasingRef.current = true;
        eraserHitsRef.current = new Map();
        collectEraserHits(pt);
        canvas.requestRenderAll();
        return;
      }

      // 裁剪：开始拖框（重拖会覆盖上一个未确认选区）
      if (tool === 'crop') {
        cropStartRef.current = { x: pt.x, y: pt.y };
        cropRectRef.current = { x: pt.x, y: pt.y, w: 0, h: 0 };
        renderCropVisuals();
        return;
      }

      if (!['line', 'arrow', 'rect', 'ellipse', 'mosaic'].includes(tool)) return;

      drawingRef.current = true;
      drawStartRef.current = { x: pt.x, y: pt.y };

      if (tool === 'line') {
        const line = new Line([pt.x, pt.y, pt.x, pt.y], {
          stroke: s.color,
          strokeWidth,
          strokeUniform: true,
          strokeLineCap: 'round',
        });
        tempObjRef.current = line;
        canvas.add(line);
      } else if (tool === 'arrow') {
        const arrow = new Path(buildArrowPath(pt.x, pt.y, pt.x, pt.y, strokeWidth), {
          stroke: s.color,
          strokeWidth,
          strokeUniform: true,
          fill: 'rgba(0,0,0,0)',
          strokeLineCap: 'round',
          strokeLineJoin: 'round',
        });
        tempObjRef.current = arrow;
        canvas.add(arrow);
      } else if (tool === 'rect') {
        const rect = new Rect({
          left: pt.x,
          top: pt.y,
          originX: 'left',
          originY: 'top',
          width: 0,
          height: 0,
          stroke: s.color,
          strokeWidth,
          strokeUniform: true,
          fill: fillValue,
        });
        tempObjRef.current = rect;
        canvas.add(rect);
      } else if (tool === 'ellipse') {
        const ell = new Ellipse({
          left: pt.x,
          top: pt.y,
          originX: 'left',
          originY: 'top',
          rx: 0,
          ry: 0,
          stroke: s.color,
          strokeWidth,
          strokeUniform: true,
          fill: fillValue,
        });
        tempObjRef.current = ell;
        canvas.add(ell);
      } else if (tool === 'mosaic') {
        const rect = new Rect({
          left: pt.x,
          top: pt.y,
          originX: 'left',
          originY: 'top',
          width: 0,
          height: 0,
          stroke: '#ffffff',
          strokeWidth: Math.max(1, 1.5 / zoom),
          strokeUniform: true,
          strokeDashArray: [6 / zoom, 4 / zoom],
          fill: 'rgba(255,255,255,0.12)',
        });
        tempObjRef.current = rect;
        canvas.add(rect);
      }
      canvas.requestRenderAll();
    });

    canvas.on('mouse:move', (opt) => {
      const e = opt.e as MouseEvent;
      if (panningRef.current) {
        const vpt = canvas.viewportTransform;
        vpt[4] += e.clientX - panningRef.current.lastX;
        vpt[5] += e.clientY - panningRef.current.lastY;
        panningRef.current = { lastX: e.clientX, lastY: e.clientY };
        canvas.requestRenderAll();
        return;
      }
      // 橡皮擦：光标跟随 + 拖拽中持续收集命中
      if (toolRef.current === 'eraser') {
        updateEraserCursor(opt.scenePoint);
        if (erasingRef.current) {
          collectEraserHits(opt.scenePoint);
          canvas.requestRenderAll();
        }
        return;
      }
      // 裁剪：拖框中，实时更新选区与遮罩
      if (toolRef.current === 'crop') {
        const cs = cropStartRef.current;
        if (cs) {
          const pt = opt.scenePoint;
          cropRectRef.current = {
            x: Math.min(cs.x, pt.x),
            y: Math.min(cs.y, pt.y),
            w: Math.abs(pt.x - cs.x),
            h: Math.abs(pt.y - cs.y),
          };
          renderCropVisuals();
        }
        return;
      }
      if (!drawingRef.current || !drawStartRef.current || !tempObjRef.current) return;
      const start = drawStartRef.current;
      const pt = opt.scenePoint;
      const tool = toolRef.current;
      const s = settingsRef.current;
      const zoom = canvas.getZoom();
      const strokeWidth = basisStrokeWidth(s, zoom);
      const temp = tempObjRef.current;
      const left = Math.min(start.x, pt.x);
      const top = Math.min(start.y, pt.y);
      const w = Math.abs(pt.x - start.x);
      const h = Math.abs(pt.y - start.y);

      if (tool === 'line' && temp instanceof Line) {
        temp.set({ x2: pt.x, y2: pt.y });
      } else if (tool === 'arrow') {
        // 重建箭头路径
        canvas.remove(temp);
        const arrow = new Path(buildArrowPath(start.x, start.y, pt.x, pt.y, strokeWidth), {
          stroke: s.color,
          strokeWidth,
          strokeUniform: true,
          fill: 'rgba(0,0,0,0)',
          strokeLineCap: 'round',
          strokeLineJoin: 'round',
        });
        tempObjRef.current = arrow;
        canvas.add(arrow);
      } else if (tool === 'rect' && temp instanceof Rect) {
        temp.set({ left, top, width: w, height: h });
      } else if (tool === 'ellipse' && temp instanceof Ellipse) {
        temp.set({ left, top, rx: w / 2, ry: h / 2 });
      } else if (tool === 'mosaic' && temp instanceof Rect) {
        temp.set({ left, top, width: w, height: h });
      }
      canvas.requestRenderAll();
    });

    canvas.on('mouse:up', (opt) => {
      if (panningRef.current) {
        panningRef.current = null;
        canvas.defaultCursor = isPanningTool() ? 'grab' : canvas.defaultCursor;
        applyToolMode(toolRef.current);
        return;
      }
      // 裁剪：松手定型选区，等待 Enter 确认 / Esc 取消（误触微拖则清除）
      if (toolRef.current === 'crop') {
        if (cropStartRef.current) {
          cropStartRef.current = null;
          const r = cropRectRef.current;
          if (!r || (r.w < 2 && r.h < 2)) {
            cropRectRef.current = null;
            renderCropVisuals();
          }
          setCropDraft(!!cropRectRef.current);
        }
        return;
      }
      // 橡皮擦：松手统一删除本次命中集合，整次拖拽只推一次快照
      if (erasingRef.current) {
        erasingRef.current = false;
        const hits = eraserHitsRef.current;
        eraserHitsRef.current = null;
        if (hits && hits.size > 0) {
          drawingRef.current = true; // 屏蔽逐对象 object:removed 的历史触发
          try {
            for (const [obj, op] of hits) obj.set('opacity', op); // 先恢复透明度，保证序列化状态干净
            canvas.remove(...hits.keys());
          } finally {
            drawingRef.current = false;
          }
          pushHistory(); // 一次拖拽 = 一个撤销步骤
        }
        canvas.requestRenderAll();
        return;
      }
      if (!drawingRef.current) return;
      drawingRef.current = false;
      const start = drawStartRef.current;
      drawStartRef.current = null;
      const temp = tempObjRef.current;
      tempObjRef.current = null;
      if (!temp) return;

      const tool = toolRef.current;
      const pt = opt.scenePoint;
      const w = start ? Math.abs(pt.x - start.x) : 0;
      const h = start ? Math.abs(pt.y - start.y) : 0;

      // 太小的拖拽视为误触
      if (tool !== 'mosaic' && w < 1.5 && h < 1.5 && tool !== 'line' && tool !== 'arrow') {
        canvas.remove(temp);
        canvas.requestRenderAll();
        return;
      }
      if ((tool === 'line' || tool === 'arrow') && w < 1.5 && h < 1.5) {
        canvas.remove(temp);
        canvas.requestRenderAll();
        return;
      }

      // 关键：拖拽过程中用 set() 改了几何，fabric 的 aCoords 缓存不会自动失效，
      // 命中检测（_pointIsInObjectSelectionArea → getCoords）依赖该缓存。
      // 不调 setCoords 会导致选择模式下点不中图形内部（只有缓存小框区域能点中）。
      temp.setCoords();

      if (tool === 'mosaic') {
        canvas.remove(temp);
        const loaded = loadedRef.current;
        if (loaded && start && w >= 4 && h >= 4) {
          const zoom = canvas.getZoom();
          const block = Math.max(6, Math.round(10 / zoom));
          const left = Math.min(start.x, pt.x);
          const top = Math.min(start.y, pt.y);
          try {
            const mosaicCanvas = createMosaicCanvas(loaded.source, left, top, w, h, block);
            const img = new FabricImage(mosaicCanvas, { left, top, originX: 'left', originY: 'top' });
            canvas.add(img);
            img.setCoords(); // 同上，保证马赛克对象可被命中
          } catch {
            // 区域完全在图外等情况，忽略
          }
        }
      }
      canvas.requestRenderAll();
      pushHistory();
    });

    // 双击文字进入编辑
    canvas.on('mouse:dblclick', (opt) => {
      const target = opt.target;
      if (target instanceof Textbox) {
        canvas.setActiveObject(target);
        target.enterEditing();
        canvas.requestRenderAll();
      }
    });

    // 指针离开画布时隐藏橡皮擦光标
    canvas.on('mouse:out', () => {
      const cursor = eraserCursorRef.current;
      if (cursor) {
        cursor.visible = false;
        canvas.requestRenderAll();
      }
    });

    // ---------- 滚轮缩放（以光标为中心） ----------
    canvas.on('mouse:wheel', (opt) => {
      const e = opt.e as WheelEvent;
      e.preventDefault();
      e.stopPropagation();
      if (!loadedRef.current) return;
      const delta = e.deltaY;
      const factor = Math.pow(0.999, delta);
      zoomTo(canvas.getZoom() * factor, opt.viewportPoint);
      // 画笔宽度按当前基准模式重算，缩放变化后同步刷新
      if (canvas.isDrawingMode && canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush.width = basisBrushWidth(settingsRef.current, canvas.getZoom());
      }
    });

    // ---------- 历史记录触发 ----------
    canvas.on('object:added', () => pushHistory());
    canvas.on('object:modified', () => pushHistory());
    canvas.on('object:removed', () => pushHistory());
    canvas.on('text:changed', () => {
      // 文字编辑过程不逐字记录，退出编辑时由 object:modified 兜底
    });

    applyToolMode(toolRef.current);

    // ---------- 键盘快捷键 ----------
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    };
    // 画布中是否有对象正处于文字编辑状态（含 fabric 隐藏 textarea 编辑）
    const isEditingText = () => {
      const active = canvas.getActiveObject() as (FabricObject & { isEditing?: boolean }) | undefined;
      return !!active?.isEditing;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // 文字编辑中（或事件来自输入框）：跳过全部应用级快捷键，
      // 包括空格平移、字母工具切换、Delete、Ctrl+Z/Y、Ctrl+0/1 等，
      // 让按键（含 Ctrl+Z 文字撤销）正常进入文字本身
      if (isTypingTarget(e.target) || isEditingText()) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (!spaceDownRef.current && loadedRef.current) {
          spaceDownRef.current = true;
          canvas.defaultCursor = 'grab';
          canvas.requestRenderAll();
        }
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;
      // 裁剪模式下：Enter 确认裁剪，Esc 取消选区（优先于其他快捷键）
      if (toolRef.current === 'crop') {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmCropRef.current?.();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelCropRef.current?.();
          return;
        }
      }
      // Ctrl+Shift+C：复制批注后的图片到剪贴板（注意不覆盖 Ctrl+C 默认行为）
      if (ctrl && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        if (loadedRef.current) onCopyRef.current();
        return;
      }
      // Ctrl+Shift+S：截图并载入工作区（无需已打开图片）
      if (ctrl && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onScreenshotRef.current();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (ctrl && e.key === '0') {
        e.preventDefault();
        zoomFit();
        return;
      }
      if (ctrl && e.key === '1') {
        e.preventDefault();
        zoomTo(1);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const actives = canvas.getActiveObjects();
        if (actives.length) {
          e.preventDefault();
          canvas.discardActiveObject();
          canvas.remove(...actives);
          canvas.requestRenderAll();
        }
        return;
      }
      if (ctrl) return;
      const key = e.key.toLowerCase();
      const map: Record<string, ToolId> = {
        v: 'select', p: 'pencil', l: 'line', a: 'arrow', r: 'rect',
        o: 'ellipse', t: 'text', m: 'mosaic', c: 'crop', e: 'eraser', h: 'hand',
      };
      if (map[key]) onToolChange(map[key]);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      // 与 keydown 同样的守卫：文字编辑中松开空格不得重置平移/调用 applyToolMode，
      // 否则 applyToolMode 内的 discardActiveObject 会把正在编辑的文字踢出编辑态
      if (isTypingTarget(e.target) || isEditingText()) return;
      if (e.code === 'Space') {
        spaceDownRef.current = false;
        panningRef.current = null;
        applyToolMode(toolRef.current);
      }
    };

    // ---------- 粘贴 / 拖拽打开 ----------
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void loadImage(file);
            return;
          }
        }
      }
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) void loadImage(file);
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      setDragActive(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragActive(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('paste', onPaste);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);

    return () => {
      observer.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      canvas.dispose();
      fabricRef.current = null;
      loadedRef.current = null;
      confirmCropRef.current = null;
      cancelCropRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={`relative h-full w-full overflow-hidden bg-zinc-950 ${
        dragActive ? 'ring-2 ring-inset ring-sky-400' : ''
      }`}
    >
      <canvas ref={canvasElRef} />
      {!hasImage && <EmptyState onOpenFile={openFileDialog} />}
      {cropDraft && (
        <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/95 px-3 py-2 shadow-lg shadow-black/40">
          <span className="select-none text-xs text-zinc-400">裁剪选区就绪</span>
          <button
            onClick={() => confirmCropRef.current?.()}
            className="rounded-md bg-sky-600 px-3 py-1 text-xs text-white transition-colors hover:bg-sky-500"
          >
            确认裁剪 (Enter)
          </button>
          <button
            onClick={() => cancelCropRef.current?.()}
            className="rounded-md bg-zinc-700 px-3 py-1 text-xs text-zinc-200 transition-colors hover:bg-zinc-600"
          >
            取消 (Esc)
          </button>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_STRING}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void loadImage(file);
          e.target.value = '';
        }}
      />
    </div>
  );
});
