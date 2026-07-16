'use client';

import { useState } from 'react';

type SectionPoint = {
  index: number;
  text: string;
  type: 'BAB' | 'BACK_MATTER';
  confidence: 'tinggi' | 'sedang' | 'RENDAH' | 'manual';
};

type DetectResponse = {
  file_id: string;
  safe_path: string;
  section_points: SectionPoint[];
};

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [detectResult, setDetectResult] = useState<DetectResponse | null>(null);
  const [sectionPoints, setSectionPoints] = useState<SectionPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleDetect() {
    if (!file) return;
    setDetecting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_URL}/api/detect`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Gagal mendeteksi struktur dokumen');

      const data: DetectResponse = await res.json();
      setDetectResult(data);
      setSectionPoints(data.section_points);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan');
    } finally {
      setDetecting(false);
    }
  }

  function handleRemove(index: number) {
    setSectionPoints((prev) => prev.filter((p) => p.index !== index));
  }

  async function handleProcess() {
    if (!detectResult) return;
    setProcessing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file_id', detectResult.file_id);
      formData.append('safe_path', detectResult.safe_path);
      formData.append('section_points', JSON.stringify(sectionPoints));

      const res = await fetch(`${API_URL}/api/process`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Gagal memproses dokumen');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'skripsi_formatted.docx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">SkripsiKit</h1>

      {/* STEP 1: Upload */}
      <div className="mb-8">
        <input
          type="file"
          accept=".docx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mb-3 block"
        />
        <button
          onClick={handleDetect}
          disabled={!file || detecting}
          className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {detecting ? 'Mendeteksi...' : 'Deteksi Struktur'}
        </button>
      </div>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      {/* STEP 2: Review */}
      {detectResult && (
        <div className="mb-8">
          <h2 className="font-semibold mb-3">
            Hasil Deteksi ({sectionPoints.length} bagian)
          </h2>
          <p className="text-sm text-gray-600 mb-3">
            Cek daftar di bawah. Hapus item yang salah dengan tombol &quot;Hapus&quot;.
          </p>

          <ul className="space-y-2 mb-4">
            {sectionPoints.map((point) => (
              <li
                key={point.index}
                className="flex items-center justify-between border rounded px-3 py-2"
              >
                <div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded mr-2 ${
                      point.confidence === 'tinggi'
                        ? 'bg-green-100 text-green-700'
                        : point.confidence === 'sedang'
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {point.type}
                  </span>
                  <span>{point.text}</span>
                </div>
                <button
                  onClick={() => handleRemove(point.index)}
                  className="text-red-600 text-sm hover:underline"
                >
                  Hapus
                </button>
              </li>
            ))}
          </ul>

          <button
            onClick={handleProcess}
            disabled={processing || sectionPoints.length === 0}
            className="bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            {processing ? 'Memproses...' : 'Proses & Download'}
          </button>
        </div>
      )}
    </main>
  );
}