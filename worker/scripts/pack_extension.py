"""Packs worker/extension into public/bluxury-meta-helper.zip (served by the dashboard for download)."""
import os, zipfile
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(root, 'extension'); out = os.path.join(root, 'public', 'bluxury-meta-helper.zip')
icon = os.path.join(src, 'icon-128.png')
if not os.path.exists(icon):
    from PIL import Image
    Image.open(os.path.join(root, 'public', 'icon-192.png')).convert('RGBA').resize((128, 128)).save(icon)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in sorted(os.listdir(src)):
        z.write(os.path.join(src, name), f'bluxury-meta-helper/{name}')
print('packed', out, os.path.getsize(out), 'bytes')
