import sys
import os
from docx import Document

from skripsikit.sanitize import sanitize_docx
from skripsikit.detection import find_section_points
from skripsikit.interactive import interactive_review
from skripsikit.section_breaks import create_section_breaks
from skripsikit.page_numbering import configure_page_numbers


def process_document(input_file, output_file):
    safe_path = sanitize_docx(input_file)
    doc = Document(safe_path)
    print(f"Membuka: {input_file}")

    section_points = find_section_points(doc)
    if not section_points:
        print("✗ Tidak ada BAB/DAFTAR PUSTAKA terdeteksi otomatis.")

    final_points = interactive_review(doc, section_points)
    if final_points is None:
        print("\n✗ Dibatalkan.")
        return

    print("\nMembuat section break...")
    create_section_breaks(doc, final_points)

    print("Mengatur nomor halaman & posisi...")
    configure_page_numbers(doc, final_points)

    doc.save(output_file)
    print(f"\n✓ Dokumen berhasil disimpan ke: {output_file}")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        input_file = sys.argv[1]
    else:
        input_file = input("Nama file skripsi: ").strip()

    if not os.path.exists(input_file):
        print(f"✗ File '{input_file}' tidak ditemukan.")
        sys.exit(1)

    base, ext = os.path.splitext(input_file)
    output_file = f"{base}_skripsikit_formatted{ext}"

    try:
        process_document(input_file, output_file)
    except Exception as e:
        print(f"\n✗ Terjadi error: {e}")
        print("  File asli tidak berubah, aman.")