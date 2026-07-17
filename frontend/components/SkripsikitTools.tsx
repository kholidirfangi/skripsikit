'use client';

import { useState } from 'react';
import {
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  Download,
} from 'lucide-react';
import { SectionPoint, DetectResponse, SummaryItem, Step } from '@/app/lib/types';
import StepIndicator from './StepIndicator';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

const confidenceStyle: Record<SectionPoint['confidence'], string> = {
  tinggi: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  sedang: 'bg-amber-50 text-amber-700 border-amber-200',
  RENDAH: 'bg-red-50 text-red-700 border-red-200',
  manual: 'bg-blue-50 text-blue-700 border-blue-200',
};

const typeLabel: Record<SectionPoint['type'], string> = {
  BAB: 'Bab',
  BACK_MATTER: 'Lampiran/Pustaka',
};

export default function SkripsiKitTool() {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [detectResult, setDetectResult] = useState<DetectResponse | null>(null);
  const [sectionPoints, setSectionPoints] = useState<SectionPoint[]>([]);
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  function resetAll() {
    setStep('upload');
    setFile(null);
    setDetectResult(null);
    setSectionPoints([]);
    setSummary([]);
    setError(null);
  }

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

      if (!res.ok) throw new Error('Gagal membaca struktur dokumen. Pastikan file .docx valid.');

      const data: DetectResponse = await res.json();

      if (!data.section_points || data.section_points.length === 0) {
        setError('Tidak ada BAB/Daftar Pustaka terdeteksi otomatis. Coba periksa format heading di dokumen kamu.');
      }

      setDetectResult(data);
      setSectionPoints(data.section_points ?? []);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan tak terduga.');
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

      if (!res.ok) throw new Error('Gagal memproses dokumen.');

      const data = await res.json();
      setSummary(data.summary ?? []);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan tak terduga.');
    } finally {
      setProcessing(false);
    }
  }

  function handleDownloadAndFinish() {
    if (!detectResult) return;
    const downloadUrl = `${API_URL}/api/download/${detectResult.file_id}`;

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = 'skripsi_formatted.docx';
    document.body.appendChild(a);
    a.click();
    a.remove();

    resetAll();
  }

  return (
    <section id="tool" className="max-w-4xl mx-auto px-6 pb-10">
      <StepIndicator step={step} />

      {error && (
        <div className="mb-6 flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {step === 'upload' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
          <label
            htmlFor="file-upload"
            className="cursor-pointer flex flex-col items-center gap-4 py-10 border-2 border-dashed border-slate-200 rounded-xl hover:border-slate-300 hover:bg-slate-50 transition-colors"
          >
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
              <Upload className="w-6 h-6 text-slate-500" />
            </div>
            <div>
              <p className="font-medium text-slate-900">
                {file ? file.name : 'Klik untuk pilih file skripsi'}
              </p>
              <p className="text-sm text-slate-500 mt-1">Format .docx, maksimal 25MB</p>
            </div>
            <input
              id="file-upload"
              type="file"
              accept=".docx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
          </label>

          <button
            onClick={handleDetect}
            disabled={!file || detecting}
            className="mt-6 inline-flex items-center gap-2 bg-slate-900 text-white px-6 py-2.5 rounded-lg font-medium text-sm hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {detecting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Menganalisis struktur dokumen...
              </>
            ) : (
              <>
                <FileText className="w-4 h-4" />
                Deteksi Struktur BAB
              </>
            )}
          </button>
        </div>
      )}

      {step === 'review' && detectResult && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100">
            <h2 className="font-semibold text-slate-900">
              {sectionPoints.length} bagian terdeteksi
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Periksa daftar di bawah. Hapus item yang salah terdeteksi sebelum lanjut.
            </p>
          </div>

          <ul className="divide-y divide-slate-100">
            {sectionPoints.map((point) => (
              <li
                key={point.index}
                className="flex items-center justify-between gap-4 px-6 py-3.5 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border shrink-0 ${confidenceStyle[point.confidence]}`}>
                    {typeLabel[point.type]}
                  </span>
                  <span className="text-sm text-slate-700 truncate">
                    {point.text.replace(/\n/g, ' ')}
                  </span>
                </div>
                <button
                  onClick={() => handleRemove(point.index)}
                  className="shrink-0 p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                  aria-label="Hapus"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
            {sectionPoints.length === 0 && (
              <li className="px-6 py-8 text-center text-sm text-slate-400">
                Semua item sudah dihapus.
              </li>
            )}
          </ul>

          <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
            <button onClick={resetAll} className="text-sm text-slate-500 hover:text-slate-700">
              Batal, mulai ulang
            </button>
            <button
              onClick={handleProcess}
              disabled={processing || sectionPoints.length === 0}
              className="inline-flex items-center gap-2 bg-slate-900 text-white px-5 py-2.5 rounded-lg font-medium text-sm hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {processing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Memproses dokumen...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Proses Sekarang
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <p className="text-sm text-emerald-800">
              Dokumen berhasil diformat. Berikut ringkasan penomoran yang diterapkan.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <span className="text-sm font-medium text-slate-700">Ringkasan Format</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {summary.map((item, i) => (
                <li key={i} className="px-6 py-4">
                  <p className="text-sm font-medium text-slate-900">{item.label}</p>
                  <p className="text-sm text-slate-500 mt-0.5">{item.format}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-between">
            <button onClick={resetAll} className="text-sm text-slate-500 hover:text-slate-700">
              Proses file lain
            </button>
            <button
              onClick={handleDownloadAndFinish}
              className="inline-flex items-center gap-2 bg-emerald-600 text-white px-6 py-2.5 rounded-lg font-medium text-sm hover:bg-emerald-700 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download Hasil (.docx)
            </button>
          </div>
        </div>
      )}
    </section>
  );
}