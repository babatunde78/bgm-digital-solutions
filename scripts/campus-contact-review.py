"""Combine generated sheet previews into numbered visual-review pages."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
release = json.loads((root / 'lib' / 'campus-release.json').read_text(encoding='utf-8'))
output = root / '.product-work' / 'campus-bursary' / release['directory']
manifest = json.loads((output / 'manifest.json').read_text(encoding='utf-8'))
names = [sheet['name'] for sheet in next(entry for entry in manifest if entry['file'] == 'excel-demo.xlsx')['sheets']]
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 18)
for group in range(0, len(names), 6):
    page = Image.new('RGB', (1800, 1320), '#E5E8E5')
    draw = ImageDraw.Draw(page)
    for index, name in enumerate(names[group:group + 6]):
        preview = Image.open(output / ('excel-' + name + '.png')).convert('RGB')
        preview.thumbnail((890, 400))
        x = (index % 2) * 900
        y = (index // 2) * 440
        draw.text((x + 10, y + 6), name, font=font, fill='#183F2D')
        page.paste(preview, (x + 5, y + 32))
    page.save(output / ('contact-' + str(group // 6 + 1).zfill(2) + '.png'))
print(f'Created visual review pages for {len(names)} sheets')
