"""Render native Excel PDF samples with PDFium and record page text."""
import json
from pathlib import Path
import pypdfium2 as pdfium
from pypdf import PdfReader

root = Path(__file__).resolve().parent.parent
release = json.loads((root / 'lib' / 'campus-release.json').read_text(encoding='utf-8'))
output = root / '.product-work' / 'campus-bursary' / release['directory']
summaries = []
for file in sorted(output.glob('*.pdf')):
    document = pdfium.PdfDocument(str(file))
    for index in range(len(document)):
        document[index].render(scale=1.4).to_pil().save(output / (file.stem + '-page-' + str(index + 1) + '-print.png'))
    reader = PdfReader(file)
    summaries.append({'file': file.name, 'pages': len(document), 'renderer': 'PDFium', 'pageTexts': [page.extract_text() for page in reader.pages]})
    document.close()
(output / 'print-review.json').write_text(json.dumps(summaries, indent=2), encoding='utf-8')
print(f'Rendered {len(summaries)} native Excel PDF samples with PDFium')
