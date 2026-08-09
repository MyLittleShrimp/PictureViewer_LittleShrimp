# 安装部署文档

本文档适用于「图片批注查看器」v1.0，覆盖从零安装、开发调试、生产构建与静态部署的完整流程。

---

## 1. 环境要求

| 项目 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | **20 或更高**（推荐 22 LTS / 24） | 项目使用 Vite 7，需要 Node 20+ |
| npm | 9 或更高 | 随 Node.js 一同安装 |
| 浏览器 | **推荐 Chrome / Edge 最新版** | 完整支持「另存为」对话框（File System Access API）；Firefox / Safari 可使用全部批注功能，导出时自动降级为普通下载 |
| 操作系统 | Windows / macOS / Linux 均可 | 开发团队实际验证环境为 Windows 10/11 |

验证环境：

```bash
node --version    # 应输出 v20.x 或更高
npm --version     # 应输出 9.x 或更高
```

> Windows + Git Bash 环境注意：如果 `npm` 命令找不到而 `npm.cmd` 可用，后续所有命令把 `npm` 换成 `npm.cmd` 即可（例如 `npm.cmd install`）。

---

## 2. 从零安装

假设你已经拿到项目源码目录 `PictureViewer/`（无论是 zip 解压还是 git clone）。

### 2.1 方式一：启动器（Windows，推荐）

双击项目根目录的 **`启动图片批注查看器.bat`**，它会自动完成以下全部步骤：

1. 检测 Node.js（系统 PATH 中没有时，会尝试 Kimi Work 内置的 Node.js；都没有则提示安装）
2. 首次运行自动执行 `npm install` 安装依赖
3. 在 3000-3009 中自动挑选一个空闲端口
4. 启动开发服务器并自动用默认浏览器打开应用

使用期间**保持启动器窗口打开，关闭窗口即停止服务**。之后每次使用只需双击该文件即可，无需再执行任何命令。

### 2.2 方式二：命令行手动安装

```bash
# 1. 进入项目根目录
cd PictureViewer

# 2. 安装依赖（约 1-2 分钟，取决于网络）
npm install

# 3. 启动开发服务器（默认端口 3000）
npm run dev
```

启动成功后终端会输出类似：

```
  VITE v7.x.x  ready in xxx ms
  ➜  Local:   http://localhost:3000/
```

用浏览器打开 `http://localhost:3000/` 即可使用。

---

## 3. 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器，支持热更新，默认端口 3000 |
| `npm run build` | 类型检查（`tsc -b`）+ 生产构建，产物输出到 `dist/` |
| `npm run preview` | 本地预览 `dist/` 生产构建产物（默认端口 4173） |
| `npm run lint` | ESLint 代码检查 |

典型流程：

```bash
# 开发
npm run dev

# 提交前：构建验证（必须通过，无 TS 错误）
npm run build

# 构建后本地验证一下产物
npm run preview
```

---

## 4. 生产构建与部署

### 4.1 构建

```bash
npm run build
```

构建产物在 `dist/` 目录，是**纯静态站点**（HTML + JS + CSS），不依赖任何 Node 服务端：

```
dist/
├── index.html
└── assets/
    ├── index-xxxxxxxx.js
    └── index-xxxxxxxx.css
```

> 注意：`vite.config.ts` 中配置了 `base: './'`（相对路径），因此 `dist/` 可以部署在任意子路径下，也可以直接双击 `index.html` 之外的任何静态服务器中运行。

### 4.2 部署到任意静态托管

把 `dist/` 目录里的全部内容上传到托管平台即可，例如：

- Nginx / Apache 的站点根目录
- GitHub Pages / Gitee Pages
- Vercel / Netlify（构建命令 `npm run build`，输出目录 `dist`）
- 对象存储（OSS / COS / S3）静态网站托管

### 4.3 Nginx 示例配置

```nginx
server {
    listen       80;
    server_name  picture-viewer.example.com;

    root   /var/www/picture-viewer;   # 指向 dist/ 内容所在目录
    index  index.html;

    location / {
        try_files $uri $uri/ /index.html;   # SPA 兜底
    }

    # 静态资源长缓存（文件名带 hash）
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### 4.4 无需部署：直接本地使用

本应用是纯前端应用，所有图片解码、批注、导出都在浏览器本地完成，**不上传任何图片到服务器**。内部团队使用时，也可以直接在一台机器上 `npm run dev` 或 `npm run preview` 后通过局域网 IP 访问。

---

## 5. 常见问题

### 5.1 端口被占用怎么办？

开发服务器默认端口 3000。如果端口被占用，有两种方式：

```bash
# 方式一：命令行指定端口（推荐）
npm run dev -- --port 3001

# 方式二：修改 vite.config.ts 中的 server.port
```

Windows 下查看端口占用：

```bash
netstat -ano | findstr LISTEN | findstr :3000
```

`npm run preview` 同理：`npm run preview -- --port 4174`。

### 5.2 npm install 太慢 / 网络失败？

使用国内镜像加速：

```bash
# 临时使用（单次安装）
npm install --registry=https://registry.npmmirror.com

# 或永久切换
npm config set registry https://registry.npmmirror.com
```

`fabric` 依赖会附带安装 `canvas` 原生模块的预编译包（`prebuild-install`），正常情况下自动下载预编译二进制，**不需要**本地编译环境；如果因网络问题失败，换镜像后重试即可，该依赖只用于 Node 端，浏览器端构建不依赖它。

### 5.3 为什么 Firefox/Safari 导出时没有「另存为」对话框？

应用优先调用 File System Access API（`window.showSaveFilePicker`）弹出系统「另存为」对话框，该 API 目前只有 **Chrome / Edge（桌面版）** 支持。不支持的浏览器会自动降级为 `<a download>` 普通下载，文件保存到浏览器默认下载目录——功能不受影响，只是不能选择保存位置。

### 5.4 构建报 TypeScript 错误？

`npm run build` 会先执行 `tsc -b` 做严格类型检查，任何 TS 错误都会导致构建失败。请根据终端输出的 `文件(行,列): error TSxxxx` 定位修复。勿用跳过类型检查的方式强行构建。

### 5.5 杀毒软件 / 公司代理导致依赖安装失败？

- 确认 Node 来自官网 nodejs.org；
- 公司代理环境设置 npm 代理：`npm config set proxy http://代理地址:端口`；
- 删除 `node_modules/` 与 `package-lock.json` 后重新 `npm install`。

---

## 6. 目录说明（与安装部署相关）

| 路径 | 说明 |
| --- | --- |
| `package.json` / `package-lock.json` | 依赖清单与锁定文件，二者必须一起分发 |
| `vite.config.ts` | Vite 配置（端口、`base: './'`、路径别名 `@`） |
| `dist/` | 构建产物（源码包中已附带一份，可直接部署） |
| `node_modules/` | 依赖目录，**不随源码分发**，由 `npm install` 生成 |
| `test-images/` | 测试图片，与应用运行无关，可选保留 |
