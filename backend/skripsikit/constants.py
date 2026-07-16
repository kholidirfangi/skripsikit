import re

KNOWN_CHAPTER_KEYWORDS = [
    'PENDAHULUAN',
    'KERANGKA TEORITIS', 'KAJIAN TEORI', 'KAJIAN TEORETIS', 'LANDASAN TEORI', 'TINJAUAN PUSTAKA',
    'METODE PENELITIAN', 'METODOLOGI PENELITIAN',
    'HASIL PENELITIAN DAN PEMBAHASAN', 'HASIL DAN PEMBAHASAN', 'PEMBAHASAN',
    'PENUTUP', 'KESIMPULAN DAN SARAN', 'KESIMPULAN',
]

KNOWN_BACK_MATTER_KEYWORDS = [
    'DAFTAR PUSTAKA', 'DAFTAR REFERENSI', 'BIBLIOGRAPHY',
    'LAMPIRAN', 'LAMPIRAN-LAMPIRAN', 'APPENDIX', 'ATTACHMENT',
]

BAB_PATTERN = re.compile(r'^BAB\s+[IVXLCDM]+\b', re.IGNORECASE)

# Style yang TIDAK boleh ikut fallback deteksi BAB manual (Pass 2),
# karena isinya daftar isi/sub-konten, bukan heading section asli.
EXCLUDED_STYLES_FOR_FALLBACK = {
    'toc 1', 'toc 2', 'toc 3', 'toc 4',
    'List Paragraph', 'table of figures', 'Caption',
}

# Urutan elemen sectPr sesuai spesifikasi OOXML (WAJIB, tidak boleh diacak)
SECTPR_CHILD_ORDER_TAGS = [
    'headerReference', 'footerReference', 'footnotePr', 'endnotePr',
    'type', 'pgSz', 'pgMar', 'paperSrc', 'pgBorders',
    'lnNumType', 'pgNumType', 'cols', 'formProt', 'vAlign',
    'noEndnote', 'titlePg', 'textDirection', 'bidi',
    'rtlGutter', 'docGrid', 'printerSettings', 'sectPrChange',
]