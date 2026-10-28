from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt

from .constants import SECTPR_CHILD_ORDER_TAGS

SECTPR_CHILD_ORDER = [qn(f'w:{tag}') for tag in SECTPR_CHILD_ORDER_TAGS]

PAGE_FIELD_PREFIXES = ('PAGE', 'NUMPAGES', 'SECTIONPAGES')


def _is_page_field(instr):
    return instr.strip().upper().startswith(PAGE_FIELD_PREFIXES)


def _remove_page_fields_in_element(element):
    """Hapus semua field nomor halaman (kompleks & fldSimple) di header/footer. Return jumlah yang dihapus."""
    removed = 0

    # 1) Field sederhana: <w:fldSimple w:instr="PAGE">
    for fld in element.xpath('.//w:fldSimple'):
        if _is_page_field(fld.get(qn('w:instr')) or ''):
            fld.getparent().remove(fld)
            removed += 1

    # 2) Field kompleks: begin -> instrText -> (separate -> hasil) -> end,
    #    bisa tersebar di beberapa run, atau semuanya dalam satu run.
    for p in element.xpath('.//w:p'):
        stack = []          # field yang sedang terbuka
        to_remove = set()

        for run in p.xpath('.//w:r'):
            for f in stack:
                f['runs'].add(run)

            for child in run.iterchildren():
                if child.tag == qn('w:fldChar'):
                    t = child.get(qn('w:fldCharType'))
                    if t == 'begin':
                        new_f = {'runs': {run}, 'instr': ''}
                        stack.append(new_f)
                    elif t == 'end' and stack:
                        f = stack.pop()
                        f['runs'].add(run)
                        if _is_page_field(f['instr']):
                            to_remove |= f['runs']
                            removed += 1
                elif child.tag == qn('w:instrText') and stack:
                    stack[-1]['instr'] += child.text or ''

        for run in to_remove:
            parent = run.getparent()
            if parent is not None:
                parent.remove(run)

    return removed


def strip_existing_page_numbers(doc):
    """
    Bersihkan penomoran lama sebelum penomoran baru diterapkan:
    - field PAGE/NUMPAGES/SECTIONPAGES di semua header & footer
      (default, halaman pertama, halaman genap)
    - format/restart nomor (w:pgNumType) di semua section
    - titlePg (beda halaman pertama) dan pengaturan header/footer ganjil-genap,
      supaya tidak ada sisa pengaturan lama yang bentrok
    Paragraf tidak dihapus, jadi indeks paragraf (section_points) tetap valid.
    Return jumlah field nomor halaman yang dihapus.
    """
    removed = 0

    for section in doc.sections:
        for name in ('header', 'footer',
                     'first_page_header', 'first_page_footer',
                     'even_page_header', 'even_page_footer'):
            part = getattr(section, name)
            # Yang masih "linked" tidak punya definisi sendiri -> sudah
            # tercakup di section sumbernya. Jangan diakses isinya agar
            # python-docx tidak membuat definisi baru.
            if part.is_linked_to_previous:
                continue
            removed += _remove_page_fields_in_element(part._element)

        section.different_first_page_header_footer = False

    for sectPr in doc.element.body.xpath('.//w:sectPr'):
        for old in sectPr.findall(qn('w:pgNumType')):
            sectPr.remove(old)

    doc.settings.odd_and_even_pages_header_footer = False

    return removed


def insert_in_schema_order(sectPr, new_element):
    new_tag_order = SECTPR_CHILD_ORDER.index(new_element.tag)
    insert_pos = len(sectPr)
    for i, child in enumerate(sectPr):
        if child.tag in SECTPR_CHILD_ORDER:
            child_order = SECTPR_CHILD_ORDER.index(child.tag)
            if child_order > new_tag_order:
                insert_pos = i
                break
    sectPr.insert(insert_pos, new_element)


def set_page_number_format(section, fmt, restart=False):
    sectPr = section._sectPr
    for old in sectPr.findall(qn('w:pgNumType')):
        sectPr.remove(old)
    pgNumType = OxmlElement('w:pgNumType')
    pgNumType.set(qn('w:fmt'), fmt)
    if restart:
        pgNumType.set(qn('w:start'), '1')
    insert_in_schema_order(sectPr, pgNumType)


def add_page_number_field(paragraph, alignment, font_name='Times New Roman', font_size=12):
    """Isi paragraph header/footer dengan field code nomor halaman, font eksplisit."""
    paragraph.alignment = alignment
    for run in list(paragraph.runs):
        run._element.getparent().remove(run._element)

    run = paragraph.add_run()
    run.font.name = font_name
    run.font.size = Pt(font_size)

    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = OxmlElement('w:rFonts')
        rPr.append(rFonts)
    rFonts.set(qn('w:ascii'), font_name)
    rFonts.set(qn('w:hAnsi'), font_name)
    rFonts.set(qn('w:cs'), font_name)

    fldChar_begin = OxmlElement('w:fldChar')
    fldChar_begin.set(qn('w:fldCharType'), 'begin')
    instrText = OxmlElement('w:instrText')
    instrText.set(qn('xml:space'), 'preserve')
    instrText.text = ' PAGE '
    fldChar_end = OxmlElement('w:fldChar')
    fldChar_end.set(qn('w:fldCharType'), 'end')

    run._element.append(fldChar_begin)
    run._element.append(instrText)
    run._element.append(fldChar_end)


def clear_paragraph(paragraph):
    for run in list(paragraph.runs):
        run._element.getparent().remove(run._element)


def setup_preliminary(section, restart=False):
    set_page_number_format(section, 'lowerRoman', restart=restart)

    section.footer.is_linked_to_previous = False
    footer_para = section.footer.paragraphs[0] if section.footer.paragraphs else section.footer.add_paragraph()
    add_page_number_field(footer_para, WD_ALIGN_PARAGRAPH.CENTER)

    section.header.is_linked_to_previous = False
    header_para = section.header.paragraphs[0] if section.header.paragraphs else section.header.add_paragraph()
    clear_paragraph(header_para)


def setup_chapter_section(section, is_first_chapter):
    set_page_number_format(section, 'decimal', restart=is_first_chapter)
    section.different_first_page_header_footer = True

    section.footer.is_linked_to_previous = False
    footer_para = section.footer.paragraphs[0] if section.footer.paragraphs else section.footer.add_paragraph()
    clear_paragraph(footer_para)

    section.header.is_linked_to_previous = False
    header_para = section.header.paragraphs[0] if section.header.paragraphs else section.header.add_paragraph()
    add_page_number_field(header_para, WD_ALIGN_PARAGRAPH.RIGHT)

    section.first_page_footer.is_linked_to_previous = False
    fp_footer_para = (section.first_page_footer.paragraphs[0]
                       if section.first_page_footer.paragraphs
                       else section.first_page_footer.add_paragraph())
    add_page_number_field(fp_footer_para, WD_ALIGN_PARAGRAPH.CENTER)

    section.first_page_header.is_linked_to_previous = False
    fp_header_para = (section.first_page_header.paragraphs[0]
                       if section.first_page_header.paragraphs
                       else section.first_page_header.add_paragraph())
    clear_paragraph(fp_header_para)


def configure_page_numbers(doc, section_points):
    """
    Petakan tiap heading BAB langsung ke section index yang memuatnya,
    lalu terapkan format. Return ringkasan (list of dict) untuk
    ditampilkan ke user di web -- pengganti print ke terminal CLI.
    """

    # Hapus penomoran bawaan file dulu agar tidak dobel
    strip_existing_page_numbers(doc)
    
    sections = doc.sections
    point_by_index = {p['index']: p for p in section_points}

    mapped = []
    current_section = 0
    for i, para in enumerate(doc.paragraphs):
        if i in point_by_index:
            mapped.append((point_by_index[i], current_section))
        pPr = para._element.find(qn('w:pPr'))
        if pPr is not None and pPr.find(qn('w:sectPr')) is not None:
            current_section += 1

    summary = []
    if not mapped:
        return summary

    first_chapter_section = mapped[0][1]

    for i in range(0, first_chapter_section):
        setup_preliminary(sections[i], restart=(i == 0))
    summary.append({
        "label": "Bagian awal dokumen (sebelum BAB I)",
        "format": "Angka Romawi (i, ii, iii, ...) — posisi bawah tengah",
    })

    for pos, (point, idx) in enumerate(mapped):
        is_first = (pos == 0)
        setup_chapter_section(sections[idx], is_first_chapter=is_first)
        summary.append({
            "label": point['text'].replace('\n', ' '),
            "format": "Angka Arab — halaman pertama bawah tengah, halaman berikutnya kanan atas",
        })

    return summary