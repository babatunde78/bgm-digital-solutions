"""Add unsupported print/protection settings and audit the generated OOXML."""
import copy
import json
import pathlib
import re
import sys
import zipfile
from lxml import etree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
RELEASE = json.loads((ROOT / 'lib' / 'campus-release.json').read_text(encoding='utf-8'))
OUTPUT = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / '.product-work' / 'campus-bursary' / RELEASE['directory']
assert OUTPUT.is_relative_to(ROOT / '.product-work'), 'Output must stay in private product work'
NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
ET.register_namespace('r', REL)
def tag(name):
    return '{' + NS + '}' + name

def column_number(letters):
    result = 0
    for letter in letters:
        result = result * 26 + ord(letter) - 64
    return result

def column_letter(number):
    result = ''
    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(65 + remainder) + result
    return result

manifest = json.loads((OUTPUT / 'manifest.json').read_text(encoding='utf-8'))
report = []
for item in manifest:
    target = OUTPUT / item['file']
    with zipfile.ZipFile(target) as source:
        parts = {name: source.read(name) for name in source.namelist()}
    assert not any('externalLink' in name or 'vbaProject' in name for name in parts), 'External workbook or macro dependency'
    styles = ET.fromstring(parts['xl/styles.xml'])
    xfs = styles.find(tag('cellXfs'))
    unlocked = {}
    def unlocked_style(old):
        if old not in unlocked:
            new = copy.deepcopy(xfs[old])
            new.set('applyProtection', '1')
            protection = new.find(tag('protection'))
            if protection is None:
                protection = ET.Element(tag('protection'))
                extension = new.find(tag('extLst'))
                new.insert(list(new).index(extension) if extension is not None else len(new), protection)
            protection.set('locked', '0')
            unlocked[old] = len(xfs)
            xfs.append(new)
        return str(unlocked[old])
    book = ET.fromstring(parts['xl/workbook.xml'])
    relationships = ET.fromstring(parts['xl/_rels/workbook.xml.rels'])
    rels = {element.attrib['Id']: element.attrib['Target'] for element in relationships}
    definitions = book.find(tag('definedNames'))
    if definitions is None:
        definitions = ET.Element(tag('definedNames'))
        calc_index = next((i for i, node in enumerate(book) if node.tag == tag('calcPr')), len(book))
        book.insert(calc_index, definitions)
    formula_count = 0
    errors = []
    sheets = book.find(tag('sheets'))
    for index, sheet in enumerate(sheets):
        name = sheet.attrib['name']
        specification = next((entry for entry in item['sheets'] if entry['name'] == name), None)
        if specification is None:
            assert name == 'PivotAnalysis', 'Unexpected native sheet'
            specification = {'name': name, 'rawCount': 0, 'print': 'A1:F32'}
        part = rels[sheet.attrib['{' + REL + '}id']]
        part = part.lstrip('/') if part.startswith('/') else 'xl/' + part
        xml = ET.fromstring(parts[part])
        for cell in xml.findall('.//' + tag('c')):
            address = cell.attrib['r']
            letters, row_text = re.fullmatch(r'([A-Z]+)(\d+)', address).groups()
            row = int(row_text)
            formula = cell.find(tag('f'))
            if formula is not None:
                formula_count += 1
                expression = formula.text or ''
                assert '[' not in expression or 'T_' in expression, 'Unexpected external reference'
            editable = name == 'Config' and letters == 'B' and 5 <= row <= 34 and row not in (6, 9)
            editable = editable or ('fields' in specification and row >= 7 and column_number(letters) <= specification['rawCount'])
            if editable and formula is None:
                cell.set('s', unlocked_style(int(cell.attrib.get('s', 0))))
            if cell.attrib.get('t') == 'e':
                errors.append({'sheet': name, 'cell': address, 'error': cell.findtext(tag('v'))})
        protection = xml.find(tag('sheetProtection'))
        if protection is None:
            protection = ET.Element(tag('sheetProtection'), {'sheet': '1', 'objects': '1', 'scenarios': '1', 'autoFilter': '0'})
            data_index = list(xml).index(xml.find(tag('sheetData')))
            xml.insert(data_index + 1, protection)
        page_margins = xml.find(tag('pageMargins'))
        if page_margins is None:
            page_margins = ET.SubElement(xml, tag('pageMargins'))
        page_margins.attrib.update({'left': '0.3', 'right': '0.3', 'top': '0.45', 'bottom': '0.45', 'header': '0.2', 'footer': '0.2'})
        setup = xml.find(tag('pageSetup'))
        if setup is None:
            setup = ET.SubElement(xml, tag('pageSetup'))
        forms = name in ('Receipt', 'Statement', 'RefundApproval', 'Voucher', 'BudgetApproval', 'AdvanceRetirement')
        setup.attrib.update({'paperSize': '9', 'orientation': 'portrait' if forms else 'landscape', 'fitToWidth': '2' if 'fields' in specification and specification['rawCount'] > 8 else '1', 'fitToHeight': '1' if forms or name == 'Dashboard' else '0'})
        properties = xml.find(tag('sheetPr'))
        if properties is None:
            properties = ET.Element(tag('sheetPr'))
            xml.insert(0, properties)
        page_properties = properties.find(tag('pageSetUpPr'))
        if page_properties is None:
            page_properties = ET.SubElement(properties, tag('pageSetUpPr'))
        page_properties.set('fitToPage', '1')
        for defined_name in list(definitions):
            if defined_name.attrib.get('localSheetId') == str(index) and defined_name.attrib.get('name') in ('_xlnm.Print_Area', '_xlnm.Print_Titles'):
                definitions.remove(defined_name)
        area = specification['print']
        if 'fields' in specification:
            last_row = str(6 + RELEASE['preparedRows'])
            area = 'A1:' + column_letter(specification['rawCount']) + last_row
        ET.SubElement(definitions, tag('definedName'), {'name': '_xlnm.Print_Area', 'localSheetId': str(index)}).text = "'" + name + "'!" + re.sub(r'([A-Z]+)(\d+)', r'$\1$\2', area)
        if 'fields' in specification:
            ET.SubElement(definitions, tag('definedName'), {'name': '_xlnm.Print_Titles', 'localSheetId': str(index)}).text = "'" + name + "'!$6:$6,'" + name + "'!$A:$B"
        header_footer = xml.find(tag('headerFooter'))
        if header_footer is None:
            header_footer = ET.SubElement(xml, tag('headerFooter'))
        existing_footer = header_footer.find(tag('oddFooter'))
        if existing_footer is None:
            existing_footer = ET.SubElement(header_footer, tag('oddFooter'))
        product_name = json.loads((ROOT / 'lib' / 'campus-prices.json').read_text(encoding='utf-8'))['productName']
        existing_footer.text = '&L' + product_name.replace('&', '&&') + ' ' + RELEASE['version'] + ' ' + RELEASE['status'] + '&C&A&RPage &P of &N'
        order = ['sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData', 'sheetCalcPr', 'sheetProtection', 'protectedRanges', 'scenarios', 'autoFilter', 'sortState', 'dataConsolidate', 'customSheetViews', 'mergeCells', 'phoneticPr', 'conditionalFormatting', 'dataValidations', 'hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks', 'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst']
        children = list(xml)
        for child in children:
            xml.remove(child)
        for child in sorted(children, key=lambda node: order.index(node.tag.split('}')[-1]) if node.tag.split('}')[-1] in order else len(order)):
            xml.append(child)
        parts[part] = ET.tostring(xml, encoding='utf-8', xml_declaration=True)
    xfs.set('count', str(len(xfs)))
    for xf in xfs:
        children = list(xf)
        for child in children:
            xf.remove(child)
        for child in sorted(children, key=lambda node: {'alignment': 0, 'protection': 1, 'extLst': 2}.get(node.tag.split('}')[-1], 3)):
            xf.append(child)
    calc = book.find(tag('calcPr'))
    if calc is None:
        calc = ET.SubElement(book, tag('calcPr'))
    calc.attrib.update({'calcMode': 'auto', 'fullCalcOnLoad': '1', 'forceFullCalc': '1'})
    parts['xl/workbook.xml'] = ET.tostring(book, encoding='utf-8', xml_declaration=True)
    parts['xl/styles.xml'] = ET.tostring(styles, encoding='utf-8', xml_declaration=True)
    temporary = target.with_suffix('.prepared.xlsx')
    with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as destination:
        for name, value in parts.items():
            destination.writestr(name, value)
    temporary.replace(target)
    report.append({'file': item['file'], 'sheets': len(sheets), 'formulas': formula_count, 'artifactCachedErrors': errors, 'externalWorkbookLinks': False, 'macroFree': True, 'printAreas': True, 'formulaProtection': True})
(OUTPUT / 'static-verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps([{'file': entry['file'], 'cachedErrors': len(entry['artifactCachedErrors'])} for entry in report]))
