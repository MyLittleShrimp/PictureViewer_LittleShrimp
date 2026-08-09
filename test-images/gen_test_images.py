# 生成测试图片：PNG / TGA(未压缩+RLE) / TIFF，带渐变和图形
from PIL import Image, ImageDraw
import os

out_dir = r"G:\Kimi Work\PictureViewer\test-images"
os.makedirs(out_dir, exist_ok=True)

W, H = 960, 640
img = Image.new("RGB", (W, H))
px = img.load()
for y in range(H):
    for x in range(0, W, 1):
        r = int(40 + 180 * x / W)
        g = int(30 + 120 * y / H)
        b = int(120 + 100 * (1 - x / W))
        px[x, y] = (r, g, b)

d = ImageDraw.Draw(img)
d.rectangle([80, 80, 380, 280], outline=(255, 255, 0), width=6)
d.ellipse([480, 100, 800, 420], outline=(0, 255, 128), width=8)
d.line([60, 560, 900, 480], fill=(255, 80, 80), width=10)
d.polygon([(700, 520), (880, 600), (760, 380)], outline=(0, 200, 255), width=5)
d.text((100, 320), "Test Image 960x640", fill=(255, 255, 255))
d.text((100, 360), "gradient + shapes", fill=(220, 220, 220))

img.save(os.path.join(out_dir, "sample.png"))
img.save(os.path.join(out_dir, "sample.tga"))                              # type 2 未压缩 24bpp
img.save(os.path.join(out_dir, "sample-rle.tga"), compression="tga_rle")   # type 10 RLE
img.save(os.path.join(out_dir, "sample.tiff"))

# 32bpp 带 alpha 的 TGA
rgba = img.convert("RGBA")
ra = rgba.load()
for y in range(H):
    for x in range(W):
        r, g, b, _ = ra[x, y]
        ra[x, y] = (r, g, b, int(255 * (0.4 + 0.6 * x / W)))
rgba.save(os.path.join(out_dir, "sample-32bpp.tga"))

for f in sorted(os.listdir(out_dir)):
    print(f, os.path.getsize(os.path.join(out_dir, f)), "bytes")
