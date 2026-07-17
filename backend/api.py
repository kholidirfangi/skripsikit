import tempfile
import os
import uuid

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from docx import Document

from skripsikit.sanitize import sanitize_docx
from skripsikit.detection import find_section_points
from skripsikit.section_breaks import create_section_breaks
from skripsikit.page_numbering import configure_page_numbers

app = FastAPI()

# Izinkan Next.js (jalan di port beda saat development) untuk akses API ini
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # nanti di production ganti ke domain asli kamu
    allow_methods=["*"],
    allow_headers=["*"],
)

# Folder sementara untuk simpan file yang sedang diproses
TEMP_DIR = tempfile.gettempdir()


@app.post("/api/detect")
async def detect(file: UploadFile = File(...)):
    """
    Tahap 1: terima upload, jalankan deteksi otomatis, balikin daftar
    section point yang terdeteksi -- ini pengganti "print daftar" di CLI.
    """
    file_id = str(uuid.uuid4())
    saved_path = os.path.join(TEMP_DIR, f"{file_id}.docx")

    with open(saved_path, "wb") as f:
        content = await file.read()
        f.write(content)

    safe_path = sanitize_docx(saved_path)
    doc = Document(safe_path)

    section_points = find_section_points(doc)

    return JSONResponse({
        "file_id": file_id,
        "safe_path": safe_path,
        "section_points": section_points,
    })

@app.post("/api/process")
async def process(file_id: str = Form(...), safe_path: str = Form(...), section_points: str = Form(...)):
    import json
    final_points = json.loads(section_points)

    doc = Document(safe_path)

    create_section_breaks(doc, final_points)
    summary = configure_page_numbers(doc, final_points)

    output_path = os.path.join(TEMP_DIR, f"{file_id}_formatted.docx")
    doc.save(output_path)

    return JSONResponse({
        "file_id": file_id,
        "summary": summary,
    })


@app.get("/api/download/{file_id}")
async def download(file_id: str):
    output_path = os.path.join(TEMP_DIR, f"{file_id}_formatted.docx")
    if not os.path.exists(output_path):
        return JSONResponse({"error": "File tidak ditemukan atau sudah kedaluwarsa"}, status_code=404)

    return FileResponse(
        output_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename="skripsi_formatted.docx",
    )