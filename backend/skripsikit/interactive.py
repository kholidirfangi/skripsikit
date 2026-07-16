from .detection import get_all_headings


def print_section_points(section_points):
    print("\n" + "=" * 65)
    print("DAFTAR SECTION BREAK SAAT INI:")
    print("=" * 65)
    if not section_points:
        print("  (kosong)")
    for n, point in enumerate(section_points, 1):
        if point['confidence'] == 'RENDAH':
            flag = " ⚠"
        elif point['confidence'] == 'sedang':
            flag = " •"
        else:
            flag = "  "
        print(f"{flag}{n}. [{point['type']:11}] {point['text']} (confidence: {point['confidence']})")
    print("=" * 65)


def interactive_review(doc, section_points):
    while True:
        print_section_points(section_points)
        if any(p['confidence'] in ('RENDAH', 'sedang') for p in section_points):
            print("⚠ Ada item yang bukan confidence tinggi, cek lagi apakah itu benar BAB.")

        print("\nPilihan:")
        print("  lanjut               -> konfirmasi daftar ini dan proses dokumen")
        print("  hapus <nomor,...>    -> hapus item, bisa banyak sekaligus (hapus 2,3,5)")
        print("  tambah               -> lihat semua heading, pilih untuk ditambahkan manual")
        print("  keluar               -> batalkan")

        command = input("\n> ").strip().lower()

        if command == 'lanjut':
            if not section_points:
                print("✗ Daftar masih kosong, tidak bisa lanjut.")
                continue
            return section_points

        elif command == 'keluar':
            return None

        elif command.startswith('hapus'):
            args_text = command[len('hapus'):].strip()
            if not args_text:
                print("✗ Format salah. Contoh: hapus 3  atau  hapus 2,3,5")
                continue

            raw_numbers = args_text.replace(',', ' ').split()
            if not all(x.isdigit() for x in raw_numbers):
                print("✗ Semua nomor harus berupa angka.")
                continue

            numbers = sorted(set(int(x) for x in raw_numbers), reverse=True)
            invalid = [n for n in numbers if n < 1 or n > len(section_points)]
            if invalid:
                print(f"✗ Nomor tidak ada di daftar: {invalid}")
                continue

            removed_texts = []
            for n in numbers:
                removed = section_points.pop(n - 1)
                removed_texts.append(removed['text'])
            for text in reversed(removed_texts):
                print(f"✓ Dihapus: {text}")

        elif command == 'tambah':
            all_headings = get_all_headings(doc)
            print("\n" + "-" * 65)
            for h in all_headings:
                print(f"  index {h['index']:4} | {h['style']:10} | {h['text']}")
            print("-" * 65)
            idx_input = input("Masukkan index heading yang mau ditambahkan: ").strip()
            if not idx_input.isdigit():
                print("✗ Index harus angka.")
                continue
            idx = int(idx_input)
            if any(p['index'] == idx for p in section_points):
                print("✗ Index ini sudah ada di daftar.")
                continue
            try:
                para_text = doc.paragraphs[idx].text.strip() or '(kosong)'
            except IndexError:
                print("✗ Index tidak valid.")
                continue
            type_input = input("Tipe? (1=BAB, 2=BACK_MATTER): ").strip()
            section_type = 'BAB' if type_input == '1' else 'BACK_MATTER' if type_input == '2' else None
            if section_type is None:
                print("✗ Pilihan tidak valid, batal menambah.")
                continue
            section_points.append({'index': idx, 'text': para_text, 'type': section_type, 'confidence': 'manual'})
            section_points.sort(key=lambda p: p['index'])
            print(f"✓ Ditambahkan: {para_text}")

        else:
            print("✗ Perintah tidak dikenali.")