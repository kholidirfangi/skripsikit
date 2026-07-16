from .constants import KNOWN_CHAPTER_KEYWORDS, KNOWN_BACK_MATTER_KEYWORDS, BAB_PATTERN, EXCLUDED_STYLES_FOR_FALLBACK


def find_section_points(doc):
    """
    Deteksi otomatis section break points dengan strategi 3-pass:
    Pass 1: heading berstyle resmi "Heading" (confidence tinggi)
    Pass 2: BAB berformat manual/style lain, misal "Normal" (confidence sedang)
    Pass 3: fallback keyword untuk BAB I yang teksnya hilang karena
            auto-numbering (confidence RENDAH)

    Back-matter keyword (DAFTAR PUSTAKA, LAMPIRAN, dst) dicocokkan
    EXACT MATCH, bukan substring -- supaya "DAFTAR LAMPIRAN" (daftar isi
    lampiran) atau "Lampiran 1 Surat Izin..." (isi list) tidak ikut
    salah terdeteksi sebagai section break.
    """
    all_paras = list(enumerate(doc.paragraphs))
    section_points = []
    first_bab_pos = None

    # Pass 1
    for pos, (i, para) in enumerate(all_paras):
        style = para.style.name
        if not style.startswith('Heading'):
            continue
        text_clean = para.text.strip()
        if not text_clean:
            continue
        text_upper = text_clean.upper()
        if BAB_PATTERN.match(text_upper):
            section_points.append({'index': i, 'text': text_clean, 'type': 'BAB', 'confidence': 'tinggi'})
            if first_bab_pos is None or pos < first_bab_pos:
                first_bab_pos = pos
        elif text_upper in KNOWN_BACK_MATTER_KEYWORDS:
            section_points.append({'index': i, 'text': text_clean, 'type': 'BACK_MATTER', 'confidence': 'tinggi'})

    already_indexed = {p['index'] for p in section_points}

    # Pass 2
    for pos, (i, para) in enumerate(all_paras):
        if i in already_indexed:
            continue
        style = para.style.name
        if style in EXCLUDED_STYLES_FOR_FALLBACK or style.startswith('Heading') or style.startswith('toc'):
            continue
        text_clean = para.text.strip()
        if not text_clean or len(text_clean) > 200 or ':' in text_clean:
            continue
        text_upper = text_clean.upper()
        if BAB_PATTERN.match(text_upper):
            section_points.append({'index': i, 'text': text_clean, 'type': 'BAB', 'confidence': 'sedang'})
            if first_bab_pos is None or pos < first_bab_pos:
                first_bab_pos = pos
        elif text_upper in KNOWN_BACK_MATTER_KEYWORDS:
            section_points.append({'index': i, 'text': text_clean, 'type': 'BACK_MATTER', 'confidence': 'sedang'})

    already_indexed = {p['index'] for p in section_points}

    # Pass 3
    if first_bab_pos is not None and first_bab_pos > 0:
        for pos in range(first_bab_pos):
            i, para = all_paras[pos]
            if i in already_indexed:
                continue
            if not para.style.name.startswith('Heading'):
                continue
            text_clean = para.text.strip()
            if not text_clean:
                continue
            text_upper = text_clean.upper()
            for keyword in KNOWN_CHAPTER_KEYWORDS:
                if text_upper == keyword or text_upper.startswith(keyword):
                    section_points.append({'index': i, 'text': text_clean, 'type': 'BAB', 'confidence': 'RENDAH'})
                    break

    section_points.sort(key=lambda p: p['index'])
    return section_points


def get_all_headings(doc):
    result = []
    for i, para in enumerate(doc.paragraphs):
        if para.style.name.startswith('Heading'):
            text_display = para.text.strip() if para.text.strip() else '(kosong)'
            result.append({'index': i, 'text': text_display, 'style': para.style.name})
    return result