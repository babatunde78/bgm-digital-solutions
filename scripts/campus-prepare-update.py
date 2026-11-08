"""Copy the verified pilot into a new edition without overwriting the old files."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import shutil

root = Path(__file__).resolve().parent.parent
release = json.loads((root / 'lib' / 'campus-release.json').read_text(encoding='utf-8'))
source = root / '.product-work' / 'campus-bursary' / 'v0.2.0'
target = root / '.product-work' / 'campus-bursary' / release['directory']
assert target.resolve().is_relative_to((root / '.product-work').resolve()) and target != source
evidence = json.loads((source / 'excel-verification.json').read_text(encoding='utf-8-sig'))
manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
def column_name(number):
    value = ''
    while number:
        number, remainder = divmod(number - 1, 26)
        value = chr(65 + remainder) + value
    return value
for result in evidence:
    assert result['savedAfterNativeRecalculation'] and not result['formulaErrors'] and all(check['passed'] for check in result['checks'])
    assert hashlib.sha256((source / result['file']).read_bytes()).hexdigest() == result['sha256']
target.mkdir(parents=True, exist_ok=False)
for result in evidence:
    shutil.copyfile(source / result['file'], target / result['file'])
for entry in manifest:
    entry['version'] = release['version']
    entry['upgradedFrom'] = 'v0.2.0'
    entry['preparedUtc'] = datetime.now(timezone.utc).isoformat()
    entry['sourceSha256'] = next(result['sha256'] for result in evidence if result['file'] == entry['file'])
    for sheet in entry['sheets']:
        if 'fields' in sheet:
            sheet['print'] = 'A1:' + column_name(sheet['rawCount']) + str(6 + release['preparedRows'])
(target / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
for name in ('clean-data.json', 'demo-data.json', 'expected-demo-report.json'):
    shutil.copyfile(source / name, target / name)
print('Prepared new edition from six hash-verified source files; v0.2.0 retained')
