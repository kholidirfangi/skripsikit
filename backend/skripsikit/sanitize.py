import zipfile
import tempfile
import os


def sanitize_docx(input_path):
    """
    Perbaiki checksum (CRC) internal ZIP yang tidak valid, TANPA
    mengubah/membuang data gambar sama sekali. Data gambar tetap
    100% sama seperti aslinya -- cuma "label" checksum-nya diperbaiki.
    """
    with zipfile.ZipFile(input_path, 'r') as zin:
        needs_fix = False
        for item in zin.infolist():
            try:
                zin.read(item.filename)
            except Exception:
                needs_fix = True
                break

    if not needs_fix:
        return input_path

    tmp_fd, tmp_path = tempfile.mkstemp(suffix='.docx')
    os.close(tmp_fd)

    with zipfile.ZipFile(input_path, 'r') as zin:
        with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                with zin.open(item.filename) as f:
                    f._expected_crc = None
                    data = f.read()
                zout.writestr(item, data)

    return tmp_path