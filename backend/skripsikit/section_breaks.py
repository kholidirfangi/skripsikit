from copy import deepcopy
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


def get_or_add_pPr(para_element):
    pPr = para_element.find(qn('w:pPr'))
    if pPr is None:
        pPr = OxmlElement('w:pPr')
        para_element.insert(0, pPr)
    return pPr


def get_clean_template_sectPr(doc):
    """
    Ambil section properties dasar (ukuran kertas, margin, dll) dari
    section TERAKHIR dokumen -- satu-satunya sectPr yang dijamin lengkap.
    """
    last_section = doc.sections[-1]
    template = deepcopy(last_section._sectPr)
    for tag in (qn('w:pgNumType'), qn('w:headerReference'), qn('w:footerReference'), qn('w:titlePg')):
        for el in template.findall(tag):
            template.remove(el)
    return template


def create_section_breaks(doc, section_points):
    """Buat break sebelum setiap section_point, geometri di-copy dari template bersih."""
    template_sectPr = get_clean_template_sectPr(doc)

    for point in section_points:
        para_before = doc.paragraphs[point['index'] - 1]
        pPr = get_or_add_pPr(para_before._element)
        old = pPr.find(qn('w:sectPr'))
        if old is not None:
            pPr.remove(old)
        sectPr = deepcopy(template_sectPr)
        pPr.append(sectPr)