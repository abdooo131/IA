# Copies shots/*.png into small/*.jpg: at most 1400 px wide, JPEG quality 82, white behind
# transparency. Only files that changed are redone.
import os, sys
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
src, dst = os.path.join(here, 'shots'), os.path.join(here, 'small')
os.makedirs(dst, exist_ok=True)
for name in os.listdir(src):
    if not name.endswith('.png'):
        continue
    out = os.path.join(dst, name[:-4] + '.jpg')
    if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(os.path.join(src, name)):
        continue
    im = Image.open(os.path.join(src, name))
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        bg = Image.new('RGB', im.size, 'white')
        bg.paste(im, mask=im.split()[-1])
        im = bg
    else:
        im = im.convert('RGB')
    if im.width > 1400:
        im = im.resize((1400, round(im.height * 1400 / im.width)), Image.LANCZOS)
    im.save(out, 'JPEG', quality=68, optimize=True, progressive=True)
