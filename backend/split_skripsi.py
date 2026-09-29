import os
import re
import subprocess
import sys

from pypdf import PdfReader, PdfWriter


# =========================================================
# REGEX
# =========================================================

# BAB I, BAB II, BAB III, ...
BAB_RE = re.compile(
    r"^\s*BAB\s+([IVXLCDM]+|\d{1,2})(?:\s|$)",
    re.IGNORECASE,
)

# DAFTAR PUSTAKA
PUSTAKA_RE = re.compile(
    r"^\s*DAFTAR\s+PUSTAKA(?:\s|$)",
    re.IGNORECASE,
)

# LAMPIRAN
LAMPIRAN_RE = re.compile(
    r"^\s*LAMPIRAN(?:\s|$)",
    re.IGNORECASE,
)

# Contoh:
# BAB I .............. 5
# BAB II ............. 15
DOTS_RE = re.compile(r"\.{4,}")


# =========================================================
# TEXT NORMALIZATION
# =========================================================

def normalize_line(line):
    """
    Membersihkan satu baris hasil extract_text().
    """
    line = line.replace("\xa0", " ")
    line = line.replace("\u200b", "")

    # Normalisasi beberapa karakter dash
    line = line.replace("–", "-")
    line = line.replace("—", "-")

    # Gabungkan whitespace berlebihan
    line = re.sub(r"\s+", " ", line)

    return line.strip()


def normalize_heading_text(text):
    """
    Normalisasi teks heading.
    """
    text = text.replace("\xa0", " ")
    text = text.replace("\u200b", "")

    text = re.sub(r"\s+", " ", text)

    return text.strip().upper()


def get_lines(text):
    """
    Mengubah hasil extract_text() menjadi list baris bersih.
    """
    lines = []

    for raw_line in text.splitlines():
        line = normalize_line(raw_line)

        if line:
            lines.append(line)

    return lines


# =========================================================
# DAFTAR ISI DETECTION
# =========================================================

def is_toc_page(lines):
    """
    Mendeteksi apakah halaman kemungkinan adalah Daftar Isi.

    Contoh:

        BAB I ................. 5
        BAB II ................ 15
        BAB III ............... 25

    Halaman seperti ini tidak boleh dianggap sebagai
    awal BAB / Daftar Pustaka / Lampiran.
    """

    bab_count = 0
    dot_count = 0

    for line in lines:
        if BAB_RE.match(line):
            bab_count += 1

        if DOTS_RE.search(line):
            dot_count += 1

    return bab_count >= 2 and dot_count >= 2


# =========================================================
# STRONG TOC DETECTION
# =========================================================

def looks_like_toc_reference(line):
    """
    Mendeteksi pola khas Daftar Isi.

    Contoh:

        DAFTAR PUSTAKA ............ 80
        LAMPIRAN .................. 90
    """

    if DOTS_RE.search(line):
        # Biasanya angka halaman berada di bagian akhir.
        if re.search(r"\d+\s*$", line):
            return True

    return False


def is_probable_toc_page(lines):
    """
    Versi lebih luas dari deteksi Daftar Isi.

    Digunakan khusus untuk mencegah:
        DAFTAR PUSTAKA ........ 80
        LAMPIRAN .............. 90

    dianggap sebagai heading asli.
    """

    if is_toc_page(lines):
        return True

    toc_count = 0

    for line in lines:
        if looks_like_toc_reference(line):
            toc_count += 1

    return toc_count >= 3


# =========================================================
# BAB DETECTION
# =========================================================

def detect_bab(lines):
    """
    Mendeteksi BAB pada bagian atas halaman.

    BAB I
    BAB II
    BAB III
    BAB IV
    BAB V
    """

    # Heading BAB biasanya berada di bagian atas.
    for line in lines[:12]:

        match = BAB_RE.match(line)

        if match:
            number = match.group(1).upper()

            return f"BAB {number}"

    return None


# =========================================================
# DAFTAR PUSTAKA HELPERS
# =========================================================

def has_pustaka_heading(lines):
    """
    Mendeteksi heading DAFTAR PUSTAKA.

    Bisa berupa:

        DAFTAR PUSTAKA

    atau:

        DAFTAR
        PUSTAKA
    """

    # Cek satu baris
    for line in lines[:25]:

        normalized = normalize_heading_text(line)

        if PUSTAKA_RE.match(normalized):
            return True

    # Cek heading yang terpecah menjadi dua baris
    top_lines = [
        normalize_heading_text(line)
        for line in lines[:25]
    ]

    for index in range(len(top_lines) - 1):

        combined = (
            top_lines[index]
            + " "
            + top_lines[index + 1]
        )

        if re.fullmatch(
            r"DAFTAR\s+PUSTAKA",
            combined,
        ):
            return True

    return False


def count_reference_signals(lines):
    """
    Menghitung ciri-ciri halaman Daftar Pustaka.

    Tidak semua skripsi memakai format referensi yang sama,
    jadi kita menggunakan beberapa sinyal sekaligus.
    """

    score = 0

    joined = " ".join(lines)

    # -----------------------------------------------------
    # Tahun publikasi
    # -----------------------------------------------------

    year_matches = re.findall(
        r"\b(?:19|20)\d{2}\b",
        joined,
    )

    score += min(len(year_matches), 6)

    # -----------------------------------------------------
    # DOI
    # -----------------------------------------------------

    if re.search(
        r"\bdoi\b|doi\.org",
        joined,
        re.IGNORECASE,
    ):
        score += 3

    # -----------------------------------------------------
    # URL
    # -----------------------------------------------------

    if re.search(
        r"https?://|www\.",
        joined,
        re.IGNORECASE,
    ):
        score += 2

    # -----------------------------------------------------
    # et al.
    # -----------------------------------------------------

    if re.search(
        r"\bet\s+al\.?\b",
        joined,
        re.IGNORECASE,
    ):
        score += 2

    # -----------------------------------------------------
    # ISBN
    # -----------------------------------------------------

    if re.search(
        r"\bISBN\b",
        joined,
        re.IGNORECASE,
    ):
        score += 2

    # -----------------------------------------------------
    # Banyak baris yang terlihat seperti referensi
    # -----------------------------------------------------

    reference_like = 0

    for line in lines:

        # Jangan menghitung heading
        normalized = normalize_heading_text(line)

        if normalized in (
            "DAFTAR PUSTAKA",
            "DAFTAR",
            "PUSTAKA",
        ):
            continue

        # Ada tahun
        if re.search(
            r"\b(?:19|20)\d{2}\b",
            line,
        ):
            reference_like += 1
            continue

        # Pola nama penulis sederhana:
        # Nama, Nama. Tahun.
        if re.search(
            r"[A-Za-zÀ-ÿ]{2,},\s*[^.]{2,}\.",
            line,
        ):
            reference_like += 1

    score += min(reference_like, 8)

    return score


def score_pustaka_page(lines, page_number, total_pages):
    """
    Memberikan skor kemungkinan sebuah halaman merupakan
    halaman pertama Daftar Pustaka.
    """

    score = 0

    # -----------------------------------------------------
    # Heading
    # -----------------------------------------------------

    if has_pustaka_heading(lines):
        score += 10

    # -----------------------------------------------------
    # Posisi heading
    # -----------------------------------------------------

    for index, line in enumerate(lines[:25]):

        normalized = normalize_heading_text(line)

        if normalized == "DAFTAR PUSTAKA":

            # Semakin dekat ke atas, semakin kuat.
            if index <= 5:
                score += 4
            elif index <= 10:
                score += 2

            break

    # -----------------------------------------------------
    # Ciri referensi
    # -----------------------------------------------------

    score += count_reference_signals(lines)

    # -----------------------------------------------------
    # Penalti Daftar Isi
    # -----------------------------------------------------

    if is_probable_toc_page(lines):
        score -= 15

    # -----------------------------------------------------
    # Posisi halaman
    #
    # Daftar Pustaka biasanya setelah BAB V.
    # Karena fungsi ini dipanggil setelah BAB V,
    # posisi akhir PDF lebih masuk akal.
    # -----------------------------------------------------

    if total_pages > 0:

        ratio = page_number / total_pages

        if ratio > 0.50:
            score += 1

    return score


def find_pustaka_page(texts, start_page):
    """
    Mencari halaman pertama Daftar Pustaka.

    start_page:
        halaman setelah BAB V dimulai.

    Return:
        nomor halaman atau None
    """

    total_pages = len(texts)

    candidates = []

    for index in range(
        max(start_page - 1, 0),
        total_pages,
    ):

        page_number = index + 1

        lines = get_lines(
            texts[index]
        )

        if not lines:
            continue

        # -------------------------------------------------
        # Jangan cari terlalu jauh setelah Lampiran.
        # -------------------------------------------------

        # Jika halaman jelas-jelas Lampiran,
        # Daftar Pustaka harus dicari sebelum itu.
        has_lampiran = has_lampiran_heading(lines)

        if has_lampiran:
            break

        score = score_pustaka_page(
            lines,
            page_number,
            total_pages,
        )

        # Minimal harus punya heading.
        if has_pustaka_heading(lines):
            candidates.append(
                (
                    score,
                    page_number,
                )
            )

    if not candidates:
        return None

    # Ambil kandidat dengan skor tertinggi.
    candidates.sort(
        key=lambda item: (
            item[0],
            -item[1],
        ),
        reverse=True,
    )

    best_score, best_page = candidates[0]

    # Confidence threshold
    #
    # Heading saja = sekitar 10+
    # Heading + ciri referensi = lebih tinggi.
    #
    # Jika terlalu rendah, jangan mengambil risiko.
    if best_score < 10:
        return None

    return best_page


# =========================================================
# LAMPIRAN HELPERS
# =========================================================

def has_lampiran_heading(lines):
    """
    Mendeteksi heading awal Lampiran.

    Contoh yang diterima:
        LAMPIRAN
        LAMPIRAN-LAMPIRAN
        LAMPIRAN - LAMPIRAN
        LAMPIRAN 1
        LAMPIRAN 2
        LAMPIRAN A
        LAMPIRAN B
        LAMPIRAN I
        LAMPIRAN II
    """

    top_lines = [
        normalize_heading_text(line)
        for line in lines[:25]
    ]

    for line in top_lines:

        # ---------------------------------------------
        # LAMPIRAN
        # ---------------------------------------------
        if line == "LAMPIRAN":
            return True

        # ---------------------------------------------
        # LAMPIRAN-LAMPIRAN
        # LAMPIRAN - LAMPIRAN
        # LAMPIRAN–LAMPIRAN
        # ---------------------------------------------
        cleaned = re.sub(r"\s*[-–—]\s*", "-", line)

        if cleaned == "LAMPIRAN-LAMPIRAN":
            return True

        # ---------------------------------------------
        # LAMPIRAN 1
        # LAMPIRAN 2
        # LAMPIRAN 10
        # ---------------------------------------------
        if re.fullmatch(
            r"LAMPIRAN\s+\d{1,3}",
            line,
        ):
            return True

        # ---------------------------------------------
        # LAMPIRAN A
        # LAMPIRAN B
        # ---------------------------------------------
        if re.fullmatch(
            r"LAMPIRAN\s+[A-Z]",
            line,
        ):
            return True

        # ---------------------------------------------
        # LAMPIRAN I
        # LAMPIRAN II
        # LAMPIRAN III
        # ---------------------------------------------
        if re.fullmatch(
            r"LAMPIRAN\s+[IVXLCDM]+",
            line,
        ):
            return True

    # ---------------------------------------------
    # Kasus heading terpecah menjadi dua baris.
    #
    # Contoh:
    # LAMPIRAN
    # 1
    #
    # atau:
    # LAMPIRAN
    # A
    # ---------------------------------------------
    for index in range(len(top_lines) - 1):

        first = top_lines[index]
        second = top_lines[index + 1]

        combined = normalize_heading_text(
            first + " " + second
        )

        if re.fullmatch(
            r"LAMPIRAN\s+(?:\d{1,3}|[A-Z]|[IVXLCDM]+)",
            combined,
        ):
            return True

    return False



def score_lampiran_page(lines, page_number):
    """
    Memberikan skor kemungkinan sebuah halaman merupakan
    awal Lampiran.
    """

    score = 0

    # -----------------------------------------------------
    # Heading utama
    # -----------------------------------------------------

    if has_lampiran_heading(lines):
        score += 12

    # -----------------------------------------------------
    # Posisi heading
    # -----------------------------------------------------

    for index, line in enumerate(lines[:25]):

        normalized = normalize_heading_text(line)

        if re.match(
            r"^LAMPIRAN(?:\s+[A-Z]|\s+\d{1,3})?$",
            normalized,
        ):

            if index <= 5:
                score += 4
            elif index <= 10:
                score += 2

            break

    # -----------------------------------------------------
    # Kata-kata yang sering muncul pada Lampiran
    # -----------------------------------------------------

    joined = " ".join(lines).upper()

    appendix_keywords = [
        "KUESIONER",
        "INSTRUMEN",
        "DOKUMENTASI",
        "SURAT",
        "DATA",
        "HASIL",
        "OUTPUT",
        "BUKTI",
        "PEDOMAN",
        "WAWANCARA",
    ]

    keyword_count = 0

    for keyword in appendix_keywords:

        if keyword in joined:
            keyword_count += 1

    score += min(
        keyword_count,
        4,
    )

    # -----------------------------------------------------
    # Penalti Daftar Isi
    # -----------------------------------------------------

    if is_probable_toc_page(lines):
        score -= 15

    return score


def score_appendix_transition(texts, index, pustaka_page):
    """
    Menilai kemungkinan sebuah halaman merupakan awal Lampiran
    ketika heading Lampiran tidak jelas atau tidak ada.

    Menggunakan:
    - posisi setelah Daftar Pustaka
    - perubahan pola isi
    - keyword appendix
    - dukungan dari halaman berikutnya
    """

    total_pages = len(texts)

    if index < pustaka_page:
        return 0

    lines = get_lines(texts[index])

    if not lines:
        return 0

    score = 0

    # -------------------------------------------------
    # 1. Heading Lampiran yang jelas
    # -------------------------------------------------
    if has_lampiran_heading(lines):
        score += 20

    # -------------------------------------------------
    # 2. Keyword yang umum ditemukan di Lampiran
    # -------------------------------------------------
    joined = " ".join(lines).upper()

    appendix_keywords = [
        "KUESIONER",
        "INSTRUMEN PENELITIAN",
        "INSTRUMEN",
        "DOKUMENTASI",
        "PEDOMAN WAWANCARA",
        "TRANSKRIP WAWANCARA",
        "SURAT IZIN",
        "SURAT PERMOHONAN",
        "SURAT KETERANGAN",
        "DATA RESPONDEN",
        "DATA PENELITIAN",
        "HASIL WAWANCARA",
        "HASIL KUESIONER",
        "OUTPUT SPSS",
    ]

    keyword_hits = 0

    for keyword in appendix_keywords:
        if keyword in joined:
            keyword_hits += 1

    score += min(keyword_hits * 3, 9)

    # -------------------------------------------------
    # 3. Kurangi skor jika halaman masih terlihat
    #    seperti halaman Daftar Pustaka
    # -------------------------------------------------
    reference_score = count_reference_signals(lines)

    if reference_score >= 6:
        score -= 8
    elif reference_score >= 3:
        score -= 3

    # -------------------------------------------------
    # 4. Cek halaman berikutnya.
    #
    # Jika halaman berikutnya juga terlihat seperti
    # Lampiran, confidence meningkat.
    # -------------------------------------------------
    appendix_like_next = 0

    for offset in (1, 2):
        next_index = index + offset

        if next_index >= total_pages:
            continue

        next_lines = get_lines(texts[next_index])

        if not next_lines:
            continue

        next_joined = " ".join(next_lines).upper()

        if has_lampiran_heading(next_lines):
            appendix_like_next += 1
            continue

        next_keyword_hits = 0

        for keyword in appendix_keywords:
            if keyword in next_joined:
                next_keyword_hits += 1

        if next_keyword_hits > 0:
            appendix_like_next += 1

        # Halaman dengan sedikit sinyal referensi juga
        # bisa menjadi indikasi bahwa blok pustaka sudah selesai.
        next_reference_score = count_reference_signals(
            next_lines
        )

        if next_reference_score <= 2:
            appendix_like_next += 1

    if appendix_like_next >= 1:
        score += 4

    if appendix_like_next >= 2:
        score += 4

    # -------------------------------------------------
    # 5. Jangan terlalu percaya halaman yang sangat awal
    #    setelah Daftar Pustaka.
    #
    # Kadang masih ada halaman pustaka berikutnya.
    # -------------------------------------------------
    distance = index + 1 - pustaka_page

    if distance == 1:
        score -= 2

    # -------------------------------------------------
    # 6. Jika halaman sangat akhir dokumen dan punya
    #    sinyal appendix, beri sedikit tambahan.
    # -------------------------------------------------
    if total_pages > 0:
        ratio = (index + 1) / total_pages

        if ratio >= 0.75:
            score += 2

    return score


def find_lampiran_page(texts, start_page):
    """
    Mencari halaman pertama Lampiran.

    start_page:
        halaman setelah kandidat Daftar Pustaka.

    Strategi:
        1. Prioritaskan heading Lampiran yang jelas.
        2. Jika tidak ada, gunakan deteksi transisi isi.
        3. Memeriksa halaman berikutnya agar tidak mudah
           salah mendeteksi halaman Daftar Pustaka.

    Return:
        nomor halaman atau None
    """

    total_pages = len(texts)

    if total_pages == 0:
        return None

    # -------------------------------------------------
    # Tahap 1:
    # Cari heading Lampiran yang benar-benar jelas.
    # -------------------------------------------------
    explicit_candidates = []

    for index in range(
        max(start_page - 1, 0),
        total_pages,
    ):
        page_number = index + 1

        lines = get_lines(
            texts[index]
        )

        if not lines:
            continue

        if not has_lampiran_heading(lines):
            continue

        score = score_lampiran_page(
            lines,
            page_number,
        )

        explicit_candidates.append(
            (
                score,
                page_number,
            )
        )

    if explicit_candidates:

        explicit_candidates.sort(
            key=lambda item: (
                item[0],
                -item[1],
            ),
            reverse=True,
        )

        best_score, best_page = explicit_candidates[0]

        if best_score >= 12:
            return best_page

    # -------------------------------------------------
    # Tahap 2:
    # Tidak menemukan heading Lampiran.
    #
    # Sekarang cari perubahan pola isi setelah
    # Daftar Pustaka.
    # -------------------------------------------------
    transition_candidates = []

    # Kita tidak perlu mencari sampai halaman terakhir
    # dengan terlalu agresif. Semua halaman tetap boleh
    # diperiksa karena beberapa skripsi memiliki Lampiran
    # yang sangat panjang.
    for index in range(
        max(start_page - 1, 0),
        total_pages,
    ):

        page_number = index + 1

        lines = get_lines(
            texts[index]
        )

        if not lines:
            continue

        score = score_appendix_transition(
            texts,
            index,
            start_page - 1,
        )

        if score <= 0:
            continue

        transition_candidates.append(
            (
                score,
                page_number,
            )
        )

    if not transition_candidates:
        return None

    transition_candidates.sort(
        key=lambda item: (
            item[0],
            -item[1],
        ),
        reverse=True,
    )

    best_score, best_page = transition_candidates[0]

    # -------------------------------------------------
    # Threshold sengaja dibuat cukup tinggi.
    #
    # Kalau confidence rendah, lebih baik None
    # daripada salah memasukkan halaman ke Lampiran.
    # -------------------------------------------------
    if best_score < 8:
        return None

    return best_page



# =========================================================
# CLASSIFY PAGE
# =========================================================

def classify(
    text,
    page_number=None,
    total_pages=None,
):
    """
    Menentukan apakah halaman merupakan awal BAB.

    Untuk Daftar Pustaka dan Lampiran, deteksi utama
    dilakukan oleh detect_sections(), bukan di sini.

    Return:

        "BAB I"
        "BAB II"
        "BAB III"
        "BAB IV"
        "BAB V"

    atau:

        None
    """

    lines = get_lines(text)

    if not lines:
        return None

    # Jangan mendeteksi BAB dari Daftar Isi.
    if is_probable_toc_page(lines):
        return None

    return detect_bab(lines)


# =========================================================
# DETECT SECTIONS
# =========================================================

def detect_sections(texts):
    """
    Mendeteksi struktur PDF.

    Strategi:

    1. Cari BAB I-V.
    2. Halaman Awal = semua halaman sebelum BAB I.
    3. Cari Daftar Pustaka setelah BAB V.
    4. Cari Lampiran setelah Daftar Pustaka.
    5. Jika tidak ditemukan, jangan membuat potongan
       yang berisiko salah.
    """

    total_pages = len(texts)

    if total_pages == 0:
        return []

    # =====================================================
    # 1. DETEKSI BAB I-V
    # =====================================================

    bab_found = []

    for index, text in enumerate(texts):

        page_number = index + 1

        label = classify(
            text,
            page_number=page_number,
            total_pages=total_pages,
        )

        if not label:
            continue

        # Hanya BAB I-V
        match = re.match(
            r"^BAB\s+([IVX]+|\d{1,2})$",
            label,
            re.IGNORECASE,
        )

        if not match:
            continue

        # Jangan ambil BAB yang sama dua kali.
        if any(
            existing_label == label
            for _, existing_label in bab_found
        ):
            continue

        bab_found.append(
            (
                page_number,
                label,
            )
        )

    bab_found.sort(
        key=lambda item: item[0]
    )

    # =====================================================
    # 2. CARI BAB I
    # =====================================================

    first_bab_page = None

    for page_number, label in bab_found:

        if label.upper() == "BAB I":
            first_bab_page = page_number
            break

    # =====================================================
    # 3. CARI BAB V
    # =====================================================

    bab_v_page = None

    for page_number, label in bab_found:

        if label.upper() == "BAB V":
            bab_v_page = page_number
            break

    # =====================================================
    # 4. HASIL AWAL
    # =====================================================

    sections = []

    # -----------------------------------------------------
    # Halaman Awal
    # -----------------------------------------------------

    if first_bab_page is not None:

        if first_bab_page > 1:

            sections.append(
                [
                    "Halaman Awal",
                    1,
                    first_bab_page - 1,
                ]
            )

    # Jika BAB I tidak ditemukan,
    # jangan membuat asumsi berlebihan.
    elif not bab_found:

        sections.append(
            [
                "Halaman Awal",
                1,
                total_pages,
            ]
        )

        return sections

    # =====================================================
    # 5. TAMBAHKAN BAB
    # =====================================================

    for index, (
        start_page,
        label,
    ) in enumerate(bab_found):

        # Hanya BAB I-V
        if label.upper() not in (
            "BAB I",
            "BAB II",
            "BAB III",
            "BAB IV",
            "BAB V",
        ):
            continue

        if index + 1 < len(bab_found):

            next_start_page = (
                bab_found[index + 1][0]
            )

            end_page = (
                next_start_page - 1
            )

        else:

            # Untuk BAB terakhir, sementara
            # kita tentukan nanti setelah Daftar Pustaka
            # atau Lampiran ditemukan.
            end_page = total_pages

        sections.append(
            [
                label,
                start_page,
                end_page,
            ]
        )

    # =====================================================
    # 6. CARI DAFTAR PUSTAKA
    # =====================================================

    pustaka_page = None

    if bab_v_page is not None:

        pustaka_page = find_pustaka_page(
            texts,
            start_page=bab_v_page + 1,
        )

    # =====================================================
    # 7. CARI LAMPIRAN
    # =====================================================

    lampiran_page = None

    if pustaka_page is not None:

        lampiran_page = find_lampiran_page(
            texts,
            start_page=pustaka_page + 1,
        )

    elif bab_v_page is not None:

        lampiran_page = find_lampiran_page(
            texts,
            start_page=bab_v_page + 1,
        )

    # =====================================================
    # 8. PERBAIKI END PAGE BAB V
    # =====================================================

    if bab_v_page is not None:

        for section in sections:

            if section[0].upper() == "BAB V":

                if pustaka_page is not None:

                    section[2] = (
                        pustaka_page - 1
                    )

                elif lampiran_page is not None:

                    section[2] = (
                        lampiran_page - 1
                    )

                else:

                    section[2] = total_pages

                break

    # =====================================================
    # 9. DAFTAR PUSTAKA
    # =====================================================

    if pustaka_page is not None:

        if lampiran_page is not None:

            pustaka_end = (
                lampiran_page - 1
            )

        else:

            pustaka_end = total_pages

        if pustaka_end >= pustaka_page:

            sections.append(
                [
                    "Daftar Pustaka",
                    pustaka_page,
                    pustaka_end,
                ]
            )

    # =====================================================
    # 10. LAMPIRAN
    # =====================================================

    if lampiran_page is not None:

        if total_pages >= lampiran_page:

            sections.append(
                [
                    "Lampiran",
                    lampiran_page,
                    total_pages,
                ]
            )

    # =====================================================
    # 11. SORT
    # =====================================================

    sections.sort(
        key=lambda item: item[1]
    )

    # =====================================================
    # 12. VALIDASI
    # =====================================================

    valid_sections = []

    for name, start_page, end_page in sections:

        if (
            1
            <= start_page
            <= end_page
            <= total_pages
        ):
            valid_sections.append(
                [
                    name,
                    start_page,
                    end_page,
                ]
            )

    return valid_sections


# =========================================================
# SPLIT PDF
# =========================================================

def split_pdf(
    path,
    sections,
    outdir,
):
    """
    Membuat PDF terpisah berdasarkan section.
    """

    reader = PdfReader(path)

    os.makedirs(
        outdir,
        exist_ok=True,
    )

    files = []

    for number, (
        name,
        start_page,
        end_page,
    ) in enumerate(
        sections,
        1,
    ):

        writer = PdfWriter()

        # pypdf menggunakan index mulai dari 0.
        #
        # Halaman 1 -> index 0
        # Halaman 2 -> index 1

        for page_index in range(
            start_page - 1,
            end_page,
        ):

            writer.add_page(
                reader.pages[page_index]
            )

        # =================================================
        # BERSIHKAN NAMA FILE
        # =================================================

        clean_name = re.sub(
            r'[<>:"/\\|?*]',
            "",
            name,
        ).strip()

        clean_name = clean_name.upper()

        filename = (
            f"{number}. "
            f"{clean_name}.pdf"
        )

        filepath = os.path.join(
            outdir,
            filename,
        )

        with open(
            filepath,
            "wb",
        ) as file:

            writer.write(file)

        files.append(filepath)

    return files


# =========================================================
# OPEN FOLDER
# =========================================================

def open_folder(path):
    """
    Membuka folder hasil split.
    """

    if sys.platform.startswith("win"):

        os.startfile(path)

    elif sys.platform == "darwin":

        subprocess.run(
            ["open", path],
            check=False,
        )

    else:

        subprocess.run(
            ["xdg-open", path],
            check=False,
        )


# =========================================================
# GUI
# =========================================================

def run_gui():

    import tkinter as tk

    from tkinter import filedialog
    from tkinter import messagebox
    from tkinter import ttk

    # =====================================================
    # WINDOW
    # =====================================================

    root = tk.Tk()

    root.title(
        "SkripsiKit - Split PDF Skripsi"
    )

    root.geometry(
        "700x540"
    )

    root.minsize(
        620,
        480,
    )

    # =====================================================
    # STYLE
    # =====================================================

    style = ttk.Style()

    try:
        style.theme_use(
            "clam"
        )
    except tk.TclError:
        pass

    style.configure(
        "TFrame",
        background="#F5F6F5",
    )

    style.configure(
        "TLabel",
        background="#F5F6F5",
        foreground="#202522",
        font=(
            "Segoe UI",
            9,
        ),
    )

    style.configure(
        "Title.TLabel",
        background="#F5F6F5",
        foreground="#202522",
        font=(
            "Segoe UI",
            14,
            "bold",
        ),
    )

    style.configure(
        "Muted.TLabel",
        background="#F5F6F5",
        foreground="#68716B",
        font=(
            "Segoe UI",
            9,
        ),
    )

    style.configure(
        "Header.TLabel",
        background="#E9ECEA",
        foreground="#404741",
        font=(
            "Segoe UI",
            9,
            "bold",
        ),
    )

    style.configure(
        "TButton",
        font=(
            "Segoe UI",
            9,
        ),
        padding=(
            10,
            6,
        ),
    )

    style.configure(
        "Primary.TButton",
        font=(
            "Segoe UI",
            9,
            "bold",
        ),
        padding=(
            14,
            7,
        ),
    )

    style.configure(
        "TEntry",
        padding=4,
    )

    style.configure(
        "TSpinbox",
        padding=4,
    )

    # =====================================================
    # STATE
    # =====================================================

    state = {
        "path": None,
        "n": 0,
        "rows": [],
    }

    status = tk.StringVar(
        value="Pilih file PDF skripsi."
    )

    # =====================================================
    # MAIN
    # =====================================================

    main = ttk.Frame(
        root,
        padding=(
            20,
            18,
            20,
            12,
        ),
    )

    main.pack(
        fill="both",
        expand=True,
    )

    # =====================================================
    # TOP
    # =====================================================

    top = ttk.Frame(
        main
    )

    top.pack(
        fill="x",
        pady=(
            0,
            14,
        ),
    )

    # -----------------------------------------------------
    # TITLE
    # -----------------------------------------------------

    title_area = ttk.Frame(
        top
    )

    title_area.pack(
        side="left",
        fill="x",
        expand=True,
    )

    ttk.Label(
        title_area,
        text="SkripsiKit",
        style="Title.TLabel",
    ).pack(
        anchor="w"
    )

    ttk.Label(
        title_area,
        text="Split PDF Skripsi",
        style="Muted.TLabel",
    ).pack(
        anchor="w",
        pady=(
            1,
            0,
        ),
    )

    # =====================================================
    # CHOOSE PDF
    # =====================================================

    def choose():

        path = filedialog.askopenfilename(
            title="Pilih PDF Skripsi",
            filetypes=[
                (
                    "PDF Files",
                    "*.pdf",
                )
            ],
        )

        if not path:
            return

        # =================================================
        # READ PDF
        # =================================================

        try:

            reader = PdfReader(
                path
            )

            total_pages = len(
                reader.pages
            )

            texts = []

            for index, page in enumerate(
                reader.pages,
                1,
            ):

                status.set(
                    f"Membaca halaman "
                    f"{index}/{total_pages}..."
                )

                root.update()

                text = (
                    page.extract_text()
                    or ""
                )

                texts.append(
                    text
                )

        except Exception as error:

            messagebox.showerror(
                "Gagal membaca PDF",
                str(error),
            )

            return

        # =================================================
        # UPDATE STATE
        # =================================================

        state.update(
            path=path,
            n=total_pages,
        )

        # =================================================
        # CLEAR OLD ROWS
        # =================================================

        for frame, _ in state["rows"]:

            frame.destroy()

        state["rows"].clear()

        # =================================================
        # DETECT SECTIONS
        # =================================================

        sections = detect_sections(
            texts
        )

        # =================================================
        # ADD DETECTED ROWS
        # =================================================

        for (
            name,
            start_page,
            end_page,
        ) in sections:

            add_row(
                name,
                start_page,
                end_page,
            )

        status.set(
            f"{os.path.basename(path)} - "
            f"{total_pages} halaman. "
            f"Periksa bagian dokumen."
        )

        update_scroll_region()

    ttk.Button(
        top,
        text="Pilih PDF...",
        command=choose,
    ).pack(
        side="right"
    )

    # =====================================================
    # FILE STATUS
    # =====================================================

    file_status = ttk.Frame(
        main
    )

    file_status.pack(
        fill="x",
        pady=(
            0,
            10,
        ),
    )

    ttk.Label(
        file_status,
        textvariable=status,
        style="Muted.TLabel",
    ).pack(
        anchor="w"
    )

    # =====================================================
    # TABLE CONTAINER
    # =====================================================

    table = ttk.Frame(
        main,
        relief="solid",
        borderwidth=1,
    )

    table.pack(
        fill="both",
        expand=True,
    )

    # =====================================================
    # TABLE HEADER
    # =====================================================

    head = ttk.Frame(
        table
    )

    head.pack(
        fill="x"
    )

    ttk.Label(
        head,
        text="Nama Bagian",
        style="Header.TLabel",
        anchor="w",
        padding=(
            10,
            8,
        ),
    ).pack(
        side="left",
        fill="x",
        expand=True,
    )

    ttk.Label(
        head,
        text="Dari",
        style="Header.TLabel",
        width=8,
        anchor="center",
        padding=(
            5,
            8,
        ),
    ).pack(
        side="left"
    )

    ttk.Label(
        head,
        text="Sampai",
        style="Header.TLabel",
        width=8,
        anchor="center",
        padding=(
            5,
            8,
        ),
    ).pack(
        side="left"
    )

    ttk.Label(
        head,
        text="",
        style="Header.TLabel",
        width=9,
        padding=(
            5,
            8,
        ),
    ).pack(
        side="left"
    )

    # =====================================================
    # SEPARATOR
    # =====================================================

    ttk.Separator(
        table,
        orient="horizontal",
    ).pack(
        fill="x"
    )

    # =====================================================
    # SCROLL AREA
    # =====================================================

    scroll_container = ttk.Frame(
        table
    )

    scroll_container.pack(
        fill="both",
        expand=True,
    )

    canvas = tk.Canvas(
        scroll_container,
        highlightthickness=0,
        background="#FFFFFF",
    )

    scrollbar = ttk.Scrollbar(
        scroll_container,
        orient="vertical",
        command=canvas.yview,
    )

    body = ttk.Frame(
        canvas
    )

    body_window = canvas.create_window(
        (
            0,
            0,
        ),
        window=body,
        anchor="nw",
    )

    canvas.configure(
        yscrollcommand=scrollbar.set
    )

    canvas.pack(
        side="left",
        fill="both",
        expand=True,
    )

    scrollbar.pack(
        side="right",
        fill="y",
    )

    def update_scroll_region(
        event=None
    ):

        canvas.configure(
            scrollregion=canvas.bbox(
                "all"
            )
        )

    body.bind(
        "<Configure>",
        update_scroll_region,
    )

    def resize_body(
        event
    ):

        canvas.itemconfigure(
            body_window,
            width=event.width,
        )

    canvas.bind(
        "<Configure>",
        resize_body,
    )

    # =====================================================
    # ADD ROW
    # =====================================================

    def add_row(
        name="Bagian Baru",
        start_page=1,
        end_page=None,
    ):

        if end_page is None:
            end_page = state["n"] or 1

        frame = ttk.Frame(
            body
        )

        frame.pack(
            fill="x",
            pady=(
                3,
                3,
            ),
            padx=6,
        )

        name_var = tk.StringVar(
            value=name
        )

        start_var = tk.IntVar(
            value=start_page
        )

        end_var = tk.IntVar(
            value=end_page
        )

        ttk.Entry(
            frame,
            textvariable=name_var,
        ).pack(
            side="left",
            fill="x",
            expand=True,
            padx=(
                4,
                8,
            ),
        )

        ttk.Spinbox(
            frame,
            from_=1,
            to=max(
                state["n"],
                1,
            ),
            width=6,
            textvariable=start_var,
            justify="center",
        ).pack(
            side="left",
            padx=3,
        )

        ttk.Spinbox(
            frame,
            from_=1,
            to=max(
                state["n"],
                1,
            ),
            width=6,
            textvariable=end_var,
            justify="center",
        ).pack(
            side="left",
            padx=3,
        )

        row = (
            frame,
            (
                name_var,
                start_var,
                end_var,
            ),
        )

        state["rows"].append(
            row
        )

        def remove():

            if row in state["rows"]:

                state["rows"].remove(
                    row
                )

            frame.destroy()

            update_scroll_region()

        ttk.Button(
            frame,
            text="Hapus",
            width=7,
            command=remove,
        ).pack(
            side="left",
            padx=(
                8,
                4,
            ),
        )

        update_scroll_region()

    # =====================================================
    # SPLIT
    # =====================================================

    def do_split():

        if not state["path"]:

            messagebox.showwarning(
                "Belum ada file",
                "Pilih PDF dulu.",
            )

            return

        sections = []

        # =================================================
        # READ TABLE
        # =================================================

        for frame, variables in state["rows"]:

            name_var, start_var, end_var = variables

            try:

                name = (
                    name_var
                    .get()
                    .strip()
                    or "Bagian"
                )

                start_page = (
                    start_var.get()
                )

                end_page = (
                    end_var.get()
                )

            except tk.TclError:

                continue

            # =================================================
            # VALIDATE
            # =================================================

            if (
                1
                <= start_page
                <= end_page
                <= state["n"]
            ):

                sections.append(
                    (
                        name,
                        start_page,
                        end_page,
                    )
                )

        # =================================================
        # NO VALID SECTION
        # =================================================

        if not sections:

            messagebox.showwarning(
                "Tidak valid",
                "Tidak ada rentang halaman yang valid.",
            )

            return

        # =================================================
        # OUTPUT DIRECTORY
        # =================================================

        outdir = (
            os.path.splitext(
                state["path"]
            )[0]
            + "_split"
        )

        # =================================================
        # SPLIT
        # =================================================

        try:

            files = split_pdf(
                state["path"],
                sections,
                outdir,
            )

        except Exception as error:

            messagebox.showerror(
                "Gagal split",
                str(error),
            )

            return

        # =================================================
        # SUCCESS
        # =================================================

        status.set(
            f"Selesai: {len(files)} file."
        )

        open_folder(
            outdir
        )

    # =====================================================
    # BOTTOM
    # =====================================================

    bottom = ttk.Frame(
        main
    )

    bottom.pack(
        fill="x",
        pady=(
            12,
            0,
        ),
    )

    ttk.Button(
        bottom,
        text="+ Tambah bagian",
        command=add_row,
    ).pack(
        side="left"
    )

    ttk.Button(
        bottom,
        text="Split Semua",
        style="Primary.TButton",
        command=do_split,
    ).pack(
        side="right"
    )

    # =====================================================
    # START GUI
    # =====================================================

    root.mainloop()



# =========================================================
# MAIN
# =========================================================

if __name__ == "__main__":
    run_gui()

