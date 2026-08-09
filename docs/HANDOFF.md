# 交接文档（HANDOFF）

面向下一位接手开发者的技术交接。读完本文档你应该能：跑起项目、理解核心架构、知道每个文件干什么、清楚已知限制和下一步可以做什么。

---

## 1. 项目概述

「图片批注查看器」是一个**纯前端单页应用**：本地打开图片（含 TGA/TIFF 等特殊格式），在其上做对象化批注（画笔/直线/箭头/矩形/椭圆/文字/马赛克），并按原图分辨率导出 PNG/JPEG。无后端、无上传，全部计算在浏览器内完成。

### 技术栈

| 层 | 选型 | 版本（以 package.json 为准） |
| --- | --- | --- |
| 框架 | React + TypeScript | React 19.2 |
| 构建 | Vite | 7.x |
| 样式 | Tailwind CSS 3 + shadcn/ui（40+ 组件预装于 `src/components/ui/`） | tailwindcss 3.4 |
| 批注画布 | fabric.js（v6 API 体系，实际安装 7.4，API 兼容） | fabric 7.4 |
| TIFF 解码 | utif | 3.1 |
| TGA 解码 | 自研纯 TS 解码器（不依赖 npm 包） | `src/lib/tga.ts` |
| 图标 | lucide-react | — |

---

## 2. 目录结构与文件职责

```
PictureViewer/
├── index.html                     # 入口 HTML，标题「图片批注查看器」
├── package.json                   # 脚本与依赖
├── vite.config.ts                 # Vite 配置：端口 3000、base './'、别名 @ → src
├── tsconfig.json / *.app.json / *.node.json
├── tailwind.config.js / postcss.config.js / components.json / eslint.config.js
├── docs/                          # INSTALL.md / USER-GUIDE.md / HANDOFF.md / LAUNCHER-CHECKLIST.md
├── scripts/                       # verify-launcher.py 启动器验收脚本 / verify-drawing.mjs 绘制回归脚本
├── 启动图片批注查看器.bat          # Windows 一键启动器：检测 Node/装依赖/单实例锁/选端口/起服务/开浏览器
├── package_project.py             # 打包脚本：生成 PictureViewer-v1.0.zip 并自检
├── test-images/                   # 测试图（PNG/TGA×3/TIFF）+ gen_test_images.py 生成脚本
├── dist/                          # 构建产物（已随源码附带一份）
└── src/
    ├── main.tsx                   # React 挂载入口（StrictMode + BrowserRouter）
    ├── index.css                  # Tailwind 指令 + shadcn 主题变量 + 应用全局深色样式
    ├── App.tsx                    # 应用外壳：整体布局、全局状态（工具/属性/图片信息/缩放/历史可用性）、导出流程
    ├── components/
    │   ├── Viewer.tsx             # ★ 核心：fabric 画布及全部交互（见第 3 节）
    │   ├── TopToolbar.tsx         # 顶部工具栏：打开/导出/缩放控制/适应窗口/100%/撤销重做/清空
    │   ├── ToolPanel.tsx          # 左侧工具条：9 工具图标 + 色板 + 线宽/填充/字号滑块
    │   ├── StatusBar.tsx          # 底部状态栏：文件名/尺寸/格式/缩放比/工具提示/临时消息
    │   ├── EmptyState.tsx         # 未打开图片时的引导页（拖拽区 + 格式列表）
    │   ├── ExportPanel.tsx        # 导出面板：格式选择/JPEG 质量/文件名
    │   └── ui/                    # shadcn/ui 预装组件（当前主界面未直接使用，留作扩展）
    ├── lib/
    │   ├── tga.ts                 # TGA 解码器：type 2/10 真彩 24/32bpp、type 3/11 灰度 8bpp、RLE、origin 翻转
    │   ├── imageLoader.ts         # 统一解码入口：原生格式走 blob URL，TGA/TIFF 走自研/utif，统一输出 HTMLCanvasElement
    │   ├── exportImage.ts         # canvasToBlob（JPEG 铺白底）+ saveBlobAs（showSaveFilePicker 优先，降级 <a download>）
    │   ├── mosaic.ts              # 马赛克：区域画到小 canvas 再关闭平滑放大
    │   └── utils.ts               # shadcn 的 cn() 工具
    ├── hooks/use-mobile.ts        # shadcn 附带 hook
    └── types/
        ├── index.ts               # ToolId、TOOLS 定义、LoadedImage、ImageInfo、PALETTE 色板
        └── global.d.ts            # utif 模块声明 + File System Access API 类型补丁
```

### 关键文件速览

- **`App.tsx`**：持有 `tool / settings / imageInfo / zoom / canUndo / canRedo / message / exportOpen` 状态；通过 `viewerRef`（`ViewerHandle`）调用 Viewer 的命令式 API；负责导出面板交互和「清空批注」确认。
- **`Viewer.tsx`**（约 600 行，核心）：创建/销毁 fabric Canvas；加载图片并设为 `backgroundImage`；滚轮缩放、空格/抓手平移；6 种绘制工具的 mouse:down/move/up 实现；文字双击编辑；键盘快捷键；撤销重做快照栈；原图分辨率导出。对外暴露 `ViewerHandle`（`openFileDialog / openFile / undo / redo / clearAnnotations / zoomFit / zoom100 / zoomIn / zoomOut / exportImage / hasImage / annotationCount`）。

---

## 3. 核心架构设计决策

接手前请务必理解以下 4 个决策，它们是代码里大多数"为什么这样做"的答案。

### 3.1 批注全部生活在「图像坐标系」中

- 底图以**自然分辨率**作为 `canvas.backgroundImage` 放在 (0,0)，不做任何缩放。
- 所有批注对象（线、箭头、矩形……）的坐标/尺寸单位就是**原图像素**。
- 查看缩放/平移只改 `canvas.viewportTransform`（vpt）：滚轮 `zoomToPoint`、平移改 `vpt[4]/vpt[5]`、适应窗口计算 `z = min(cw/iw, ch/ih) * 0.96` 后居中。

带来的好处：

1. **导出即原图分辨率**：见 3.3，无需任何坐标换算。
2. **批注永远不会"画死"**：对象一直在，底图不动。
3. 缩放时批注随图缩放，视觉永远 WYSIWYG。

代价及对策：在图像坐标系下，zoom=0.2 时 4px 线宽在屏幕上只剩 0.8px。因此**创建批注时把线宽/字号按当前 zoom 换算**（`lineWidth / zoom`），保证屏幕上看到的粗细就是导出后相对原图的比例。创建后不再随 zoom 变化——这是刻意的（所见即所得）。

### 3.2 撤销/重做：只序列化批注对象，排除底图

- 快照 = `JSON.stringify(canvas.getObjects().map(o => o.toObject(...)))`，**不含 backgroundImage**。
- 原因：`canvas.toJSON()` 会把背景图序列化成巨大的 dataURL，50 步历史就是几十上百 MB 内存，且每次 push 都有大字符串拷贝开销。
- 恢复 = `canvas.remove(...getObjects())` + `util.enlivenObjects()` 逐对象重建；底图自始至终不动，所以无需快照。
- 栈上限 50（`HISTORY_LIMIT`），`object:added / object:modified / object:removed` 触发 push；绘制拖拽期间（`drawingRef`）和恢复期间（`restoringRef`）屏蔽，避免中间态刷屏。
- 打开新图片时历史重置为 `[空快照]`。

### 3.3 导出：临时切回 identity 视图再 toCanvasElement

`Viewer.exportImage()` 的流程：

1. 保存当前 vpt 和画布 CSS 尺寸；
2. `setViewportTransform([1,0,0,1,0,0])` + `setDimensions({原图宽, 原图高})`，此时画布 = 原图坐标系 1:1；
3. `renderAll()` 后 `toCanvasElement(1)` 得到原图分辨率的扁平化位图（fabric 的控制点渲染在上层 context，不会被导出）；
4. 恢复原 vpt 和尺寸；
5. PNG 直接 `toBlob`；JPEG 先铺白底（否则透明区域变黑）。

因为批注本来就在图像坐标系，所以**不需要任何坐标变换**，等比例自动成立。

### 3.4 马赛克：像素化位图作为批注对象

- 拖拽时显示虚线预览框；松开后按 `createMosaicCanvas()` 处理：把底图对应区域 `drawImage` 到 `区域/block` 尺寸的小 canvas，再关闭平滑（`imageSmoothingEnabled=false`）放大回区域尺寸，形成像素块。
- 结果是一个 `FabricImage` 批注对象：可选中、移动、删除，底图不受影响。
- **块大小为什么创建时固定**：`block = max(6, round(10/zoom))` 在创建瞬间计算（保证屏幕上看到的块约 10px）。马赛克是破坏性滤镜，生成的是静态位图，之后 zoom 变化时不会重采样——这是刻意的取舍：重采样需要永久保存底图引用和区域参数，收益小、复杂度高。
- 最小有效区域 4×4（图像像素），过小的拖拽视为误触。

### 3.5 TGA 解码器（`src/lib/tga.ts`）

- 支持：type 2（未压缩真彩）、type 10（RLE 真彩）24/32 bpp；type 3 / 11（灰度）8 bpp；descriptor bit4/bit5 的 origin 翻转；BGR(A) → RGBA 转换。
- 不支持：彩色映射（type 1/9）、15/16 bpp——遇到会抛出带中文说明的 `TgaError`。
- **测试方法**（已验证通过）：
  ```bash
  ./node_modules/.bin/esbuild src/lib/tga.ts --bundle --format=esm --outfile=test-images/tga-test.mjs
  # 写一个 node 脚本 import decodeTga，读 test-images/*.tga 解码，检查宽高与抽样像素
  ```
  抽样像素可与 `gen_test_images.py` 的渐变公式对照（如点 (480,200)：R=130, G=67, B=170）。

---

## 4. 构建 / 开发命令速查

| 命令 | 说明 |
| --- | --- |
| `npm install` | 安装依赖 |
| `npm run dev` | 开发服务器，默认端口 3000；换端口 `npm run dev -- --port N` |
| `npm run build` | `tsc -b` 类型检查 + Vite 生产构建 → `dist/` |
| `npm run preview` | 预览构建产物，默认端口 4173 |
| `npm run lint` | ESLint |
| `python test-images/gen_test_images.py` | 重新生成测试图（需要 pillow） |

> Windows + Git Bash 下 `npm` 找不到时用 `npm.cmd`。

---

## 5. 已知限制

1. 马赛克块大小创建时固定，之后不随缩放重采样；不可调强度（可删除重画）。
2. TIFF 只取第一帧；utif 对个别罕见压缩（JPEG-in-TIFF 等）支持有限。
3. TGA 不支持彩色映射（type 1/9）与 15/16 bpp。
4. 撤销栈上限 50 步；打开新图片清空画布与历史（无多文档）。
5. 文字撤销粒度是整个 Textbox（进入编辑前/退出编辑后），非逐字。
6. `showSaveFilePicker` 仅 Chrome/Edge，其他浏览器降级为默认目录下载。
7. 缩放范围 2% ~ 6000%；超大图片（>100MP）导出受浏览器 canvas 内存上限限制。
8. 批注改色仅支持选中后点色板改描边色；无批注级线宽/字号二次编辑面板（可整体缩放）。
9. 属性（线宽/字号/颜色）只影响新批注，不回溯已选对象（颜色除外）。

---

## 6. 后续可扩展方向

| 方向 | 说明 | 主要改动文件 |
| --- | --- | --- |
| 多页 TIFF 浏览 | utif.decode 返回所有帧，加页码切换 UI | `lib/imageLoader.ts`（返回帧数组）、`App.tsx`（页码状态）、`StatusBar.tsx`（页码显示） |
| 批注工程文件（JSON 保存/载入） | 快照序列化已现成，加「保存工程/打开工程」把 objects JSON 存为 `.pva.json`，可与原图配对重载 | `Viewer.tsx`（导出/导入快照方法）、`App.tsx`、`TopToolbar.tsx`（按钮） |
| 贴图/图章工具 | 把外部小图片或 emoji 作为 fabric.Image 放置 | `Viewer.tsx`（新 tool 分支）、`types/index.ts`（工具注册）、`ToolPanel.tsx`（图标） |
| 取色器 | 从底图取色作为当前描边色：图像坐标已知，`source.getContext('2d').getImageData(x,y,1,1)` 即可 | `Viewer.tsx`（吸管 tool + mouse:down 分支）、`ToolPanel.tsx` |
| 序号标注工具 | 自增数字圆标（Group: Circle + Text），适合写教程 | `Viewer.tsx`（新 tool）、`types/index.ts` |
| 选中对象的属性编辑栏 | 选中批注后显示浮动面板改线宽/颜色/字号/层级 | `App.tsx`（选中状态）、新组件、`Viewer.tsx`（selection:created/updated 事件回调） |
| 旋转/翻转底图 | 对 backgroundImage 设置 angle/flipX，注意马赛克与导出都以 source canvas 为准，需要先重烘 source | `Viewer.tsx`、`TopToolbar.tsx` |
| 触屏/手写板支持 | fabric 已支持 pointer 事件，主要补双指缩放与工具条适配 | `Viewer.tsx`（gesture 处理）、`ToolPanel.tsx`（响应式） |

---

## 7. 测试资源

`test-images/` 由 `gen_test_images.py` 生成（Python + pillow），均为 960×640 渐变 + 几何图形：

| 文件 | 用途 |
| --- | --- |
| `sample.png` | 常规原生格式打开/批注/导出 |
| `sample.tga` | TGA type 2 未压缩 24bpp |
| `sample-rle.tga` | TGA type 10 RLE 压缩 |
| `sample-32bpp.tga` | TGA 32bpp 带 alpha 通道 |
| `sample.tiff` | TIFF 解码路径 |

手工冒烟建议路径：打开 `sample.tga` → 画箭头 + 矩形 + 文字 + 一块马赛克 → `Ctrl+Z`/`Ctrl+Shift+Z` 各一次 → 选中文字改色 → 导出 PNG 与 JPEG 各一份 → 用看图工具确认导出尺寸为 960×640 且批注位置/清晰度正确。
