import { useCallback, useRef, useState } from 'react';
import { Viewer } from '@/components/Viewer';
import type { ViewerHandle, AnnotationSettings } from '@/components/Viewer';
import { TopToolbar } from '@/components/TopToolbar';
import { ToolPanel } from '@/components/ToolPanel';
import { StatusBar } from '@/components/StatusBar';
import { ExportPanel } from '@/components/ExportPanel';
import type { ImageInfo, ToolId, ExportFormat } from '@/types';
import { baseName } from '@/lib/imageLoader';
import { saveBlobAs, copyImageToClipboard } from '@/lib/exportImage';
import { captureScreenshotFile, isScreenshotSupported, SCREENSHOT_UNSUPPORTED_MSG } from '@/lib/screenshot';

export default function App() {
  const viewerRef = useRef<ViewerHandle>(null);
  const [tool, setTool] = useState<ToolId>('select');
  const [settings, setSettings] = useState<AnnotationSettings>({
    color: '#ef4444',
    lineWidth: 4,
    fillEnabled: false,
    fontSize: 24,
    widthBasis: 'screen',
  });
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [zoom, setZoom] = useState(1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const showMessage = useCallback((msg: string | null) => {
    setMessage(msg);
    if (msg) window.setTimeout(() => setMessage((cur) => (cur === msg ? null : cur)), 4000);
  }, []);

  const handleImageLoad = useCallback((info: ImageInfo) => {
    setImageInfo(info);
    setExportOpen(false);
    showMessage(null);
  }, [showMessage]);

  const handleHistoryChange = useCallback((u: boolean, r: boolean) => {
    setCanUndo(u);
    setCanRedo(r);
  }, []);

  const handleError = useCallback((msg: string) => showMessage(msg), [showMessage]);

  const handleClear = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.annotationCount() === 0) return;
    if (window.confirm('确定要清空全部批注吗？（可用 Ctrl+Z 撤销）')) {
      viewer.clearAnnotations();
    }
  }, []);

  const handleCopy = useCallback(async () => {
    const viewer = viewerRef.current;
    if (!viewer || !viewer.hasImage()) return;
    try {
      const blob = await viewer.exportImage('png', 1);
      await copyImageToClipboard(blob);
      showMessage('已复制到剪贴板');
    } catch (err) {
      showMessage(err instanceof Error ? `复制失败：${err.message}` : '复制失败，请重试');
    }
  }, [showMessage]);

  // 截图：getDisplayMedia 弹浏览器选择器 → 抓帧 → 走现有图片加载流程载入工作区
  const handleScreenshot = useCallback(async () => {
    if (!isScreenshotSupported()) {
      showMessage(SCREENSHOT_UNSUPPORTED_MSG);
      return;
    }
    showMessage('请在弹窗中选择要截取的画面');
    try {
      const file = await captureScreenshotFile();
      // 与"打开新图"一致：载入会重置画布与撤销栈；成功后 onImageLoad 先清消息，再提示结果
      await viewerRef.current?.openFile(file);
      showMessage('截图已载入');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        showMessage('已取消截图'); // 用户在选择器里点了取消
      } else {
        showMessage(err instanceof Error ? `截图失败：${err.message}` : '截图失败，请重试');
      }
    }
  }, [showMessage]);

  const handleExportSave = useCallback(
    async (format: ExportFormat, quality: number, fileName: string) => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      try {
        const blob = await viewer.exportImage(format, quality);
        const result = await saveBlobAs(blob, fileName, format);
        if (result === 'saved') showMessage('已保存');
        else if (result === 'downloaded') showMessage('已开始下载');
        setExportOpen(false);
      } catch (err) {
        showMessage(err instanceof Error ? err.message : '导出失败');
      }
    },
    [showMessage],
  );

  const hasImage = !!imageInfo;
  const defaultExportName = imageInfo ? `${baseName(imageInfo.fileName)}_批注` : '批注';

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-zinc-950 text-zinc-200">
      <TopToolbar
        hasImage={hasImage}
        canUndo={canUndo}
        canRedo={canRedo}
        onOpen={() => viewerRef.current?.openFileDialog()}
        onScreenshot={() => void handleScreenshot()}
        onExport={() => setExportOpen((v) => !v)}
        onCopy={() => void handleCopy()}
        onZoomIn={() => viewerRef.current?.zoomIn()}
        onZoomOut={() => viewerRef.current?.zoomOut()}
        onZoomFit={() => viewerRef.current?.zoomFit()}
        onZoom100={() => viewerRef.current?.zoom100()}
        onUndo={() => viewerRef.current?.undo()}
        onRedo={() => viewerRef.current?.redo()}
        onClear={handleClear}
      />
      <div className="relative flex min-h-0 flex-1">
        <ToolPanel
          tool={tool}
          settings={settings}
          disabled={!hasImage}
          onToolChange={setTool}
          onSettingsChange={setSettings}
        />
        <div className="relative min-w-0 flex-1">
          <Viewer
            ref={viewerRef}
            tool={tool}
            settings={settings}
            onToolChange={setTool}
            onZoomChange={setZoom}
            onImageLoad={handleImageLoad}
            onHistoryChange={handleHistoryChange}
            onError={handleError}
            onCopy={() => void handleCopy()}
            onScreenshot={() => void handleScreenshot()}
          />
          {exportOpen && hasImage && (
            <ExportPanel
              defaultName={defaultExportName}
              onCancel={() => setExportOpen(false)}
              onSave={handleExportSave}
            />
          )}
        </div>
      </div>
      <StatusBar imageInfo={imageInfo} zoom={zoom} tool={tool} message={message} />
    </div>
  );
}
