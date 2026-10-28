"use client";

import { useState } from "react";
import {
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  Download,
  Plus,
  Search,
} from "lucide-react";
import {
  SectionPoint,
  DetectResponse,
  SummaryItem,
  Step,
  DocumentParagraph,
} from "@/app/lib/types";
import StepIndicator from "./StepIndicator";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

const confidenceStyle: Record<SectionPoint["confidence"], string> = {
  tinggi: "bg-emerald-50 text-emerald-700 border-emerald-200",
  sedang: "bg-amber-50 text-amber-700 border-amber-200",
  RENDAH: "bg-red-50 text-red-700 border-red-200",
  manual: "bg-blue-50 text-blue-700 border-blue-200",
};

const typeLabel: Record<SectionPoint["type"], string> = {
  BAB: "Bab",
  BACK_MATTER: "Lampiran/Pustaka",
};

export default function SkripsiKitTool() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [detectResult, setDetectResult] = useState<DetectResponse | null>(null);
  const [sectionPoints, setSectionPoints] = useState<SectionPoint[]>([]);
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedParaIndex, setSelectedParaIndex] = useState<number | null>(null);
  const [selectedType, setSelectedType] = useState<"BAB" | "BACK_MATTER">("BAB");

  function resetAll() {
    setStep("upload");
    setFile(null);
    setDetectResult(null);
    setSectionPoints([]);
    setSummary([]);
    setError(null);
    setShowAddModal(false);
    setSearchQuery("");
    setSelectedParaIndex(null);
    setSelectedType("BAB");
  }

  function handleAddPoint() {
    if (selectedParaIndex === null || !detectResult?.available_paragraphs) return;
    const targetPara = detectResult.available_paragraphs.find(
      (p) => p.index === selectedParaIndex
    );
    if (!targetPara) return;

    const newPoint: SectionPoint = {
      index: targetPara.index,
      text: targetPara.text,
      type: selectedType,
      confidence: "manual",
    };

    setSectionPoints((prev) => {
      const updated = [...prev, newPoint];
      updated.sort((a, b) => a.index - b.index);
      return updated;
    });

    setShowAddModal(false);
    setSelectedParaIndex(null);
    setSearchQuery("");
  }

  async function handleDetect() {
    if (!file) return;
    setDetecting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API_URL}/api/detect`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok)
        throw new Error(
          "Gagal membaca struktur dokumen. Pastikan file .docx valid.",
        );

      const data: DetectResponse = await res.json();

      if (!data.section_points || data.section_points.length === 0) {
        setError(
          "Tidak ada BAB/Daftar Pustaka terdeteksi otomatis. Coba periksa format heading di dokumen kamu.",
        );
      }

      setDetectResult(data);
      setSectionPoints(data.section_points ?? []);
      setStep("review");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Terjadi kesalahan tak terduga.",
      );
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
      formData.append("file_id", detectResult.file_id);
      formData.append("section_points", JSON.stringify(sectionPoints));

      const res = await fetch(`${API_URL}/api/process`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Gagal memproses dokumen.");

      const data = await res.json();
      setSummary(data.summary ?? []);
      setStep("done");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Terjadi kesalahan tak terduga.",
      );
    } finally {
      setProcessing(false);
    }
  }

  function handleDownloadAndFinish() {
    if (!detectResult) return;
    const downloadUrl = `${API_URL}/api/download/${detectResult.file_id}`;

    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = "skripsi_formatted.docx";
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

      {step === "upload" && (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
          <h1 className="text-2xl font-bold text-center">
            Penomoran Skripsi Otomatis
          </h1>
          <p className="text-center text-sm text-gray-500 mb-5">
            Beri nomor skripsimu dalam hitungan detik
          </p>
          <label
            htmlFor="file-upload"
            className="cursor-pointer flex flex-col items-center gap-4 py-10 border-2 border-dashed border-slate-200 rounded-xl hover:border-slate-300 hover:bg-slate-50 transition-colors"
          >
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
              <Upload className="w-6 h-6 text-slate-500" />
            </div>
            <div>
              <p className="font-medium text-slate-900">
                {file ? file.name : "Klik untuk pilih file skripsi"}
              </p>
              <p className="text-sm text-slate-500 mt-1">
                Format .docx, maksimal 25MB
              </p>
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

      {step === "review" && detectResult && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="font-semibold text-slate-900">
                {sectionPoints.length} bagian terdeteksi
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Periksa daftar di bawah. Hapus item yang salah atau tambahkan BAB secara manual jika terlewat.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowAddModal(true);
                setSelectedParaIndex(null);
                setSearchQuery("");
              }}
              className="inline-flex items-center gap-1.5 self-start sm:self-auto px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4 text-slate-600" />
              Tambah BAB Manual
            </button>
          </div>

          <ul className="divide-y divide-slate-100">
            {sectionPoints.map((point) => (
              <li
                key={point.index}
                className="flex items-center justify-between gap-4 px-6 py-3.5 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full border shrink-0 ${confidenceStyle[point.confidence]}`}
                  >
                    {typeLabel[point.type]}
                  </span>
                  <span className="text-sm text-slate-700 truncate">
                    {point.text.replace(/\n/g, " ")}
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
            <button
              onClick={resetAll}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
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

      {/* Modal Tambah Titik BAB Manual */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Tambah Titik BAB Manual
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Pilih judul BAB atau paragraf pemisah dari dokumen yang terlewat oleh deteksi.
                </p>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Tipe Section */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Tipe Bagian
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedType("BAB")}
                  className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-colors ${
                    selectedType === "BAB"
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span className="font-semibold block">BAB</span>
                  <span className="text-[11px] opacity-75">Halaman 1 bawah, lanjut kanan atas</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedType("BACK_MATTER")}
                  className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-colors ${
                    selectedType === "BACK_MATTER"
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span className="font-semibold block">Lampiran / Pustaka</span>
                  <span className="text-[11px] opacity-75">Format bagian akhir skripsi</span>
                </button>
              </div>
            </div>

            {/* Pencarian Paragraf */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Cari & Pilih Judul / Paragraf Dokumen
              </label>
              <div className="relative mb-2">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Ketik kata kunci, misal: 'BAB II' atau 'TINJAUAN'..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Daftar kandidat paragraf */}
              <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {(() => {
                  const existingIndices = new Set(sectionPoints.map((p) => p.index));
                  const candidates = (detectResult?.available_paragraphs ?? []).filter(
                    (p) =>
                      !existingIndices.has(p.index) &&
                      (!searchQuery.trim() ||
                        p.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        p.style.toLowerCase().includes(searchQuery.toLowerCase()))
                  );

                  if (candidates.length === 0) {
                    return (
                      <div className="p-4 text-center text-xs text-slate-400">
                        {searchQuery ? "Tidak ada paragraf yang cocok." : "Semua paragraf sudah ada di daftar."}
                      </div>
                    );
                  }

                  return candidates.map((p) => {
                    const isSelected = selectedParaIndex === p.index;
                    return (
                      <div
                        key={p.index}
                        onClick={() => setSelectedParaIndex(p.index)}
                        className={`p-2.5 text-xs cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-blue-50 text-blue-900 border-l-4 border-blue-600"
                            : "hover:bg-slate-50 text-slate-700"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">{p.text}</span>
                          <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                            {p.style}
                          </span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Aksi Modal */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={selectedParaIndex === null}
                onClick={handleAddPoint}
                className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Tambahkan ke Daftar
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <p className="text-sm text-emerald-800">
              Dokumen berhasil diformat. Berikut ringkasan penomoran yang
              diterapkan.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <span className="text-sm font-medium text-slate-700">
                Ringkasan Format
              </span>
            </div>
            <ul className="divide-y divide-slate-100">
              {summary.map((item, i) => (
                <li key={i} className="px-6 py-4">
                  <p className="text-sm font-medium text-slate-900">
                    {item.label}
                  </p>
                  <p className="text-sm text-slate-500 mt-0.5">{item.format}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={resetAll}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
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
