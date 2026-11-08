"""Package only files whose native Excel verification matches their hash."""
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent.parent
RELEASE = json.loads((ROOT / 'lib' / 'campus-release.json').read_text(encoding='utf-8'))
OUTPUT = ROOT / '.product-work' / 'campus-bursary' / RELEASE['directory']
evidence = json.loads((OUTPUT / 'excel-verification.json').read_text(encoding='utf-8-sig'))
assert len(evidence) == 6, 'Native acceptance must cover all six workbooks'
for result in evidence:
    assert result.get('savedAfterNativeRecalculation') and not result.get('formulaErrors'), 'Native Excel failure remains'
    assert all(check['passed'] for check in result['checks']), 'Financial acceptance failed'
    assert hashlib.sha256((OUTPUT / result['file']).read_bytes()).hexdigest() == result['sha256'], 'Workbook changed after native verification'
acceptance_dir = ROOT / '.product-work' / 'campus-bursary' / 'acceptance'
acceptance_files = ['query-acceptance.json', 'capacity-acceptance.json', 'source-print-acceptance.json']
template_hash = next(result['sha256'] for result in evidence if result['file'] == 'excel-clean.xlsx')
for name in acceptance_files:
    acceptance = json.loads((acceptance_dir / name).read_text(encoding='utf-8-sig'))
    assert acceptance['passed'], 'Technical acceptance failure remains: ' + name
    assert acceptance['templateSha256'] == template_hash, 'Acceptance evidence refers to a different template'
    if 'checks' in acceptance:
        assert acceptance['originalTemplateUnchanged'] and acceptance['templateSha256'] == template_hash, 'Acceptance template differs from the current release'
shutil.copyfile(ROOT / 'docs' / 'EXCEL_IMPLEMENTATION.md', OUTPUT / 'USER-GUIDE.md')
archives = []
for package in ('a', 'b', 'excel', 'all'):
    name = 'campus-bursary-' + package + '-' + RELEASE['status'] + '-v' + RELEASE['version'] + '.zip'
    files = [OUTPUT / result['file'] for result in evidence if package == 'all' or result['file'].startswith(package + '-')]
    assert len(files) == (6 if package == 'all' else 2)
    with zipfile.ZipFile(OUTPUT / name, 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in files:
            archive.write(file, file.name)
        archive.write(OUTPUT / 'USER-GUIDE.md', 'USER-GUIDE.md')
        archive.write(OUTPUT / 'excel-verification.json', 'verification/excel-verification.json')
        for acceptance_name in acceptance_files:
            archive.write(acceptance_dir / acceptance_name, 'verification/' + acceptance_name)
        for resource in (ROOT / 'resources' / 'campus').iterdir():
            archive.write(resource, 'resources/' + resource.name)
    archives.append({'file': name, 'sha256': hashlib.sha256((OUTPUT / name).read_bytes()).hexdigest(), 'workbooks': [file.name for file in files]})
(OUTPUT / 'package-manifest.json').write_text(json.dumps(archives, indent=2), encoding='utf-8')
print(json.dumps(archives, indent=2))
