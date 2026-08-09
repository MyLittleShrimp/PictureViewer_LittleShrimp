# 打包项目为 PictureViewer-v1.0.zip 并验证
import os
import zipfile
import shutil
import tempfile

ROOT = r"G:\Kimi Work\PictureViewer"
ZIP_PATH = os.path.join(ROOT, "PictureViewer-v1.0.zip")

# 包含的顶层条目
INCLUDE_DIRS = ["src", "docs", "test-images", "dist", "scripts"]
INCLUDE_FILES = [
    "index.html", "package.json", "package-lock.json", "README.md",
    "tsconfig.json", "tsconfig.app.json", "tsconfig.node.json",
    "vite.config.ts", "tailwind.config.js", "postcss.config.js",
    "components.json", "eslint.config.js", "template-info.md",
    "启动图片批注查看器.bat",
]
# 排除规则
EXCLUDE_DIRS = {"node_modules", ".git", "__pycache__"}
EXCLUDE_EXT = {".zip", ".pyc"}

def should_exclude(rel_path: str) -> bool:
    parts = rel_path.replace("\\", "/").split("/")
    if any(p in EXCLUDE_DIRS for p in parts):
        return True
    if os.path.splitext(rel_path)[1].lower() in EXCLUDE_EXT:
        return True
    return False

collected = []
for d in INCLUDE_DIRS:
    base = os.path.join(ROOT, d)
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [x for x in dirnames if x not in EXCLUDE_DIRS]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, ROOT)
            if not should_exclude(rel):
                collected.append((full, rel))
for f in INCLUDE_FILES:
    full = os.path.join(ROOT, f)
    if os.path.isfile(full):
        collected.append((full, f))
    else:
        print(f"!! 缺失预期文件: {f}")

if os.path.exists(ZIP_PATH):
    os.remove(ZIP_PATH)

with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
    for full, rel in sorted(collected, key=lambda x: x[1]):
        zf.write(full, rel.replace("\\", "/"))

zip_size = os.path.getsize(ZIP_PATH)
with zipfile.ZipFile(ZIP_PATH) as zf:
    names = zf.namelist()
    print(f"zip 文件: {ZIP_PATH}")
    print(f"zip 大小: {zip_size:,} bytes ({zip_size/1024/1024:.2f} MB)")
    print(f"文件数量: {len(names)}")
    # 确认无排除项混入
    bad = [n for n in names if should_exclude(n)]
    print(f"排除项混入检查: {'FAIL ' + str(bad[:5]) if bad else 'OK（无 node_modules/.git/zip）'}")

# 抽查解压验证
tmp = tempfile.mkdtemp(prefix="pv_zip_check_")
try:
    with zipfile.ZipFile(ZIP_PATH) as zf:
        zf.extract("index.html", tmp)
        zf.extract("docs/HANDOFF.md", tmp)
    with open(os.path.join(tmp, "index.html"), encoding="utf-8") as f:
        html = f.read()
    ok1 = "图片批注查看器" in html and "/src/main.tsx" in html
    print(f"抽查 index.html: {'OK' if ok1 else 'FAIL'}（{len(html)} 字符，含标题={('图片批注查看器' in html)}）")
    with open(os.path.join(tmp, "docs", "HANDOFF.md"), encoding="utf-8") as f:
        handoff = f.read()
    ok2 = handoff.startswith("# 交接文档") and "核心架构设计决策" in handoff and handoff.rstrip().endswith("批注位置/清晰度正确。")
    print(f"抽查 docs/HANDOFF.md: {'OK' if ok2 else 'FAIL'}（{len(handoff)} 字符，首尾完整={ok2}）")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"临时目录已清理: {not os.path.exists(tmp)}")
