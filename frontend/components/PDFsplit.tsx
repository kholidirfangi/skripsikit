"use client";

import { useState, useRef, useCallback } from "react";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import type * as PdfJsLib from "pdfjs-dist";

// ---------------------------------------------------------------------------
// Polyfill Uint8Array.toHex/toBase64 (dibutuhkan pdfjs-dist 5.x)
// ---------------------------------------------------------------------------
interface Uint8ArrayHexBase64Proto {
  toHex?: () => string;
  toBase64?: () => string;
}
interface Uint8ArrayHexBase64Ctor {
  fromHex?: (hex: string) => Uint8Array;
  fromBase64?: (b64: string) => Uint8Array;
}

function ensureTypedArrayPolyfills() {
  const proto = Uint8Array.prototype as unknown as Uint8ArrayHexBase64Proto;
  const ctor = Uint8Array as unknown as Uint8ArrayHexBase64Ctor;
  if (typeof proto.toHex !== "function") {
    proto.toHex = function (this: Uint8Array) {
      return Array.from(this, (b) => b.toString(16).padStart(2, "0")).join("");
    };
    ctor.fromHex = (hex: string) => {
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++)
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
      return bytes;
    };
  }
  if (typeof proto.toBase64 !== "function") {
    proto.toBase64 = function (this: Uint8Array) {
      let bin = "";
      this.forEach((b) => (bin += String.fromCharCode(b)));
      return btoa(bin);
    };
    ctor.fromBase64 = (b64: string) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    };
  }
}

const WORKER_POLYFILL_SRC = `
if (typeof Uint8Array.prototype.toHex !== "function") {
  Uint8Array.prototype.toHex = function () {
    return Array.from(this, (b) => b.toString(16).padStart(2, "0")).join("");
  };
  Uint8Array.fromHex = function (hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    return bytes;
  };
}
if (typeof Uint8Array.prototype.toBase64 !== "function") {
  Uint8Array.prototype.toBase64 = function () {
    let bin = "";
    this.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
  };
  Uint8Array.fromBase64 = function (b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };
}
`;

let pdfjsPromise: Promise<typeof PdfJsLib> | null = null;

async function getPatchedWorkerUrl(): Promise<string> {
  const originalUrl = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const res = await fetch(originalUrl);
  const code = await res.text();
  const blob = new Blob([WORKER_POLYFILL_SRC, "\n", code], {
    type: "text/javascript",
  });
  return URL.createObjectURL(blob);
}

function getPdfjs() {
  if (!pdfjsPromise) {
    ensureTypedArrayPolyfills();
    pdfjsPromise = import("pdfjs-dist").then(async (mod) => {
      mod.GlobalWorkerOptions.workerSrc = await getPatchedWorkerUrl();
      return mod;
    });
  }
  return pdfjsPromise;
}

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------
type Section = { name: string; from: number; to: number };
/** Satu halaman = daftar baris yang sudah dibersihkan (tanpa baris kosong). */
type PageLines = string[];

// ---------------------------------------------------------------------------
// REGEX
// ---------------------------------------------------------------------------
const BAB_RE = /^\s*BAB\s+([IVXLCDM]+|\d{1,2})(?:\s|$)/i;
const DOTS_RE = /\.{4,}/;

// ---------------------------------------------------------------------------
// TEXT NORMALIZATION
// ---------------------------------------------------------------------------
function normalizeLine(line: string): string {
  return line
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeadingText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Rekonstruksi baris dari hasil pdf.js getTextContent().
 * pdf.js memberi potongan teks (bukan baris), jadi kita gabungkan
 * berdasarkan hasEOL dan perubahan posisi Y.
 */
function itemsToLines(
  items: Array<{
    str?: string;
    hasEOL?: boolean;
    transform?: number[];
  }>,
): PageLines {
  const lines: string[] = [];
  let current = "";
  let lastY: number | null = null;

  for (const it of items) {
    if (typeof it.str !== "string") continue;
    const y = it.transform?.[5];

    if (
      lastY !== null &&
      y !== undefined &&
      Math.abs(y - lastY) > 3 &&
      current
    ) {
      lines.push(current);
      current = "";
    }

    current += (current ? " " : "") + it.str;
    if (y !== undefined) lastY = y;

    if (it.hasEOL) {
      lines.push(current);
      current = "";
      lastY = null;
    }
  }
  if (current) lines.push(current);

  return lines.map(normalizeLine).filter(Boolean);
}

// ---------------------------------------------------------------------------
// DAFTAR ISI DETECTION
// ---------------------------------------------------------------------------
function isTocPage(lines: PageLines): boolean {
  let babCount = 0;
  let dotCount = 0;
  for (const line of lines) {
    if (BAB_RE.test(line)) babCount++;
    if (DOTS_RE.test(line)) dotCount++;
  }
  return babCount >= 2 && dotCount >= 2;
}

function looksLikeTocReference(line: string): boolean {
  return DOTS_RE.test(line) && /\d+\s*$/.test(line);
}

function isProbableTocPage(lines: PageLines): boolean {
  if (isTocPage(lines)) return true;
  let tocCount = 0;
  for (const line of lines) {
    if (looksLikeTocReference(line)) tocCount++;
  }
  return tocCount >= 3;
}

// ---------------------------------------------------------------------------
// BAB DETECTION
// ---------------------------------------------------------------------------
function detectBab(lines: PageLines): string | null {
  for (const line of lines.slice(0, 12)) {
    const m = line.match(BAB_RE);
    if (m) return `BAB ${m[1].toUpperCase()}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// DAFTAR PUSTAKA
// ---------------------------------------------------------------------------
function hasPustakaHeading(lines: PageLines): boolean {
  const top = lines.slice(0, 25).map(normalizeHeadingText);

  for (const t of top) {
    if (/^DAFTAR\s+PUSTAKA(?:\s|$)/.test(t)) return true;
  }

  for (let i = 0; i < top.length - 1; i++) {
    if (/^DAFTAR\s+PUSTAKA$/.test(`${top[i]} ${top[i + 1]}`)) return true;
  }
  return false;
}

function countReferenceSignals(lines: PageLines): number {
  let score = 0;
  const joined = lines.join(" ");

  const years = joined.match(/\b(?:19|20)\d{2}\b/g) || [];
  score += Math.min(years.length, 6);

  if (/\bdoi\b|doi\.org/i.test(joined)) score += 3;
  if (/https?:\/\/|www\./i.test(joined)) score += 2;
  if (/\bet\s+al\.?\b/i.test(joined)) score += 2;
  if (/\bISBN\b/i.test(joined)) score += 2;

  let referenceLike = 0;
  for (const line of lines) {
    const n = normalizeHeadingText(line);
    if (n === "DAFTAR PUSTAKA" || n === "DAFTAR" || n === "PUSTAKA") continue;

    if (/\b(?:19|20)\d{2}\b/.test(line)) {
      referenceLike++;
      continue;
    }
    if (/[A-Za-zÀ-ÿ]{2,},\s*[^.]{2,}\./.test(line)) referenceLike++;
  }
  score += Math.min(referenceLike, 8);

  return score;
}

function scorePustakaPage(
  lines: PageLines,
  pageNumber: number,
  totalPages: number,
): number {
  let score = 0;

  if (hasPustakaHeading(lines)) score += 10;

  const top = lines.slice(0, 25);
  for (let i = 0; i < top.length; i++) {
    if (normalizeHeadingText(top[i]) === "DAFTAR PUSTAKA") {
      if (i <= 5) score += 4;
      else if (i <= 10) score += 2;
      break;
    }
  }

  score += countReferenceSignals(lines);

  if (isProbableTocPage(lines)) score -= 15;

  if (totalPages > 0 && pageNumber / totalPages > 0.5) score += 1;

  return score;
}

function findPustakaPage(pages: PageLines[], startPage: number): number | null {
  const total = pages.length;
  const candidates: { score: number; page: number }[] = [];

  for (let index = Math.max(startPage - 1, 0); index < total; index++) {
    const lines = pages[index];
    if (!lines.length) continue;

    if (hasLampiranHeading(lines)) break;

    if (hasPustakaHeading(lines)) {
      candidates.push({
        score: scorePustakaPage(lines, index + 1, total),
        page: index + 1,
      });
    }
  }

  if (!candidates.length) return null;

  // skor tertinggi dulu; kalau seri, ambil halaman paling awal
  candidates.sort((a, b) => b.score - a.score || a.page - b.page);

  const best = candidates[0];
  return best.score < 10 ? null : best.page;
}

// ---------------------------------------------------------------------------
// LAMPIRAN
// ---------------------------------------------------------------------------
function hasLampiranHeading(lines: PageLines): boolean {
  const top = lines.slice(0, 25).map(normalizeHeadingText);

  for (const line of top) {
    if (line === "LAMPIRAN") return true;

    const cleaned = line.replace(/\s*-\s*/g, "-");
    if (cleaned === "LAMPIRAN-LAMPIRAN") return true;

    if (/^LAMPIRAN\s+\d{1,3}$/.test(line)) return true;
    if (/^LAMPIRAN\s+[A-Z]$/.test(line)) return true;
    if (/^LAMPIRAN\s+[IVXLCDM]+$/.test(line)) return true;
  }

  // heading terpecah dua baris: "LAMPIRAN" + "1"
  for (let i = 0; i < top.length - 1; i++) {
    const combined = normalizeHeadingText(`${top[i]} ${top[i + 1]}`);
    if (/^LAMPIRAN\s+(?:\d{1,3}|[A-Z]|[IVXLCDM]+)$/.test(combined)) return true;
  }

  return false;
}

function scoreLampiranPage(lines: PageLines): number {
  let score = 0;

  if (hasLampiranHeading(lines)) score += 12;

  const top = lines.slice(0, 25);
  for (let i = 0; i < top.length; i++) {
    if (/^LAMPIRAN(?:\s+[A-Z]|\s+\d{1,3})?$/.test(normalizeHeadingText(top[i]))) {
      if (i <= 5) score += 4;
      else if (i <= 10) score += 2;
      break;
    }
  }

  const joined = lines.join(" ").toUpperCase();
  const keywords = [
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
  ];
  const hits = keywords.filter((k) => joined.includes(k)).length;
  score += Math.min(hits, 4);

  if (isProbableTocPage(lines)) score -= 15;

  return score;
}

const APPENDIX_TRANSITION_KEYWORDS = [
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
];

function scoreAppendixTransition(
  pages: PageLines[],
  index: number,
  pustakaPage: number,
): number {
  const total = pages.length;
  if (index < pustakaPage) return 0;

  const lines = pages[index];
  if (!lines.length) return 0;

  let score = 0;

  if (hasLampiranHeading(lines)) score += 20;

  const joined = lines.join(" ").toUpperCase();
  const keywordHits = APPENDIX_TRANSITION_KEYWORDS.filter((k) =>
    joined.includes(k),
  ).length;
  score += Math.min(keywordHits * 3, 9);

  const refScore = countReferenceSignals(lines);
  if (refScore >= 6) score -= 8;
  else if (refScore >= 3) score -= 3;

  let appendixLikeNext = 0;
  for (const offset of [1, 2]) {
    const nextIndex = index + offset;
    if (nextIndex >= total) continue;

    const nextLines = pages[nextIndex];
    if (!nextLines.length) continue;

    if (hasLampiranHeading(nextLines)) {
      appendixLikeNext++;
      continue;
    }

    const nextJoined = nextLines.join(" ").toUpperCase();
    const nextHits = APPENDIX_TRANSITION_KEYWORDS.filter((k) =>
      nextJoined.includes(k),
    ).length;
    if (nextHits > 0) appendixLikeNext++;

    if (countReferenceSignals(nextLines) <= 2) appendixLikeNext++;
  }

  if (appendixLikeNext >= 1) score += 4;
  if (appendixLikeNext >= 2) score += 4;

  const distance = index + 1 - pustakaPage;
  if (distance === 1) score -= 2;

  if (total > 0 && (index + 1) / total >= 0.75) score += 2;

  return score;
}

function findLampiranPage(pages: PageLines[], startPage: number): number | null {
  const total = pages.length;
  if (total === 0) return null;

  // Tahap 1: heading Lampiran yang jelas
  const explicit: { score: number; page: number }[] = [];
  for (let index = Math.max(startPage - 1, 0); index < total; index++) {
    const lines = pages[index];
    if (!lines.length || !hasLampiranHeading(lines)) continue;
    explicit.push({ score: scoreLampiranPage(lines), page: index + 1 });
  }

  if (explicit.length) {
    explicit.sort((a, b) => b.score - a.score || a.page - b.page);
    if (explicit[0].score >= 12) return explicit[0].page;
  }

  // Tahap 2: deteksi transisi isi setelah Daftar Pustaka
  const transition: { score: number; page: number }[] = [];
  for (let index = Math.max(startPage - 1, 0); index < total; index++) {
    if (!pages[index].length) continue;
    const score = scoreAppendixTransition(pages, index, startPage - 1);
    if (score > 0) transition.push({ score, page: index + 1 });
  }

  if (!transition.length) return null;

  transition.sort((a, b) => b.score - a.score || a.page - b.page);
  return transition[0].score < 8 ? null : transition[0].page;
}

// ---------------------------------------------------------------------------
// CLASSIFY & DETECT SECTIONS
// ---------------------------------------------------------------------------
function classify(lines: PageLines): string | null {
  if (!lines.length) return null;
  if (isProbableTocPage(lines)) return null;
  return detectBab(lines);
}

const VALID_BAB = ["BAB I", "BAB II", "BAB III", "BAB IV", "BAB V"];

function detectSections(pages: PageLines[]): Section[] {
  const total = pages.length;
  if (total === 0) return [];

  // 1. Deteksi BAB
  const babFound: { page: number; label: string }[] = [];
  pages.forEach((lines, index) => {
    const label = classify(lines);
    if (!label) return;
    if (!/^BAB\s+([IVX]+|\d{1,2})$/i.test(label)) return;
    if (babFound.some((b) => b.label === label)) return;
    babFound.push({ page: index + 1, label });
  });
  babFound.sort((a, b) => a.page - b.page);

  const firstBabPage = babFound.find((b) => b.label === "BAB I")?.page ?? null;
  const babVPage = babFound.find((b) => b.label === "BAB V")?.page ?? null;

  // 2. Halaman Awal
  const sections: Section[] = [];

  if (firstBabPage !== null) {
    if (firstBabPage > 1) {
      sections.push({ name: "Halaman Awal", from: 1, to: firstBabPage - 1 });
    }
  } else if (babFound.length === 0) {
    return [{ name: "Halaman Awal", from: 1, to: total }];
  }

  // 3. BAB I–V
  babFound.forEach((bab, i) => {
    if (!VALID_BAB.includes(bab.label)) return;
    const next = babFound[i + 1];
    sections.push({
      name: bab.label,
      from: bab.page,
      to: next ? next.page - 1 : total,
    });
  });

  // 4. Daftar Pustaka & Lampiran
  let pustakaPage: number | null = null;
  let lampiranPage: number | null = null;

  if (babVPage !== null) {
    pustakaPage = findPustakaPage(pages, babVPage + 1);
  }
  if (pustakaPage !== null) {
    lampiranPage = findLampiranPage(pages, pustakaPage + 1);
  } else if (babVPage !== null) {
    lampiranPage = findLampiranPage(pages, babVPage + 1);
  }

  // 5. Perbaiki akhir BAB V
  if (babVPage !== null) {
    const babV = sections.find((s) => s.name === "BAB V");
    if (babV) {
      if (pustakaPage !== null) babV.to = pustakaPage - 1;
      else if (lampiranPage !== null) babV.to = lampiranPage - 1;
      else babV.to = total;
    }
  }

  // 6. Daftar Pustaka
  if (pustakaPage !== null) {
    const end = lampiranPage !== null ? lampiranPage - 1 : total;
    if (end >= pustakaPage) {
      sections.push({ name: "Daftar Pustaka", from: pustakaPage, to: end });
    }
  }

  // 7. Lampiran
  if (lampiranPage !== null && total >= lampiranPage) {
    sections.push({ name: "Lampiran", from: lampiranPage, to: total });
  }

  // 8. Sort + validasi
  sections.sort((a, b) => a.from - b.from);
  return sections.filter((s) => s.from >= 1 && s.from <= s.to && s.to <= total);
}

// ---------------------------------------------------------------------------
// COMPONENT
// ---------------------------------------------------------------------------
export default function PDFsplit() {
  const [numPages, setNumPages] = useState(0);
  const [sections, setSections] = useState<Section[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const bytesRef = useRef<Uint8Array | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    setStatus("Membaca PDF...");
    setSections([]);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      bytesRef.current = bytes;
      const pdfjsLib = await getPdfjs();
      const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      const total = doc.numPages;
      setNumPages(total);

      const pages: PageLines[] = [];
      for (let i = 1; i <= total; i++) {
        setStatus(`Membaca halaman ${i}/${total}...`);
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        pages.push(
          itemsToLines(
            content.items as Array<{
              str?: string;
              hasEOL?: boolean;
              transform?: number[];
            }>,
          ),
        );
      }

      setStatus("Menganalisis struktur dokumen...");
      const built = detectSections(pages);

      setSections(built);
      setStatus(
        built.length > 1
          ? "Terdeteksi otomatis — cek & koreksi sebelum split."
          : "Struktur tidak terdeteksi jelas. Isi / koreksi manual.",
      );
    } catch (err: unknown) {
      setStatus(
        "Gagal membaca PDF: " +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const updateSection = (idx: number, patch: Partial<Section>) => {
    setSections((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  };

  const removeSection = (idx: number) =>
    setSections((prev) => prev.filter((_, i) => i !== idx));
  const addSection = () =>
    setSections((prev) => [
      ...prev,
      { name: "Bagian Baru", from: 1, to: numPages },
    ]);

  const splitAndDownload = async () => {
    if (!bytesRef.current) return;
    setBusy(true);
    setStatus("Memproses split...");
    try {
      const zip = new JSZip();
      const src = await PDFDocument.load(bytesRef.current);
      let n = 1;
      for (const s of sections) {
        if (s.from < 1 || s.to < s.from || s.to > numPages) continue;
        const out = await PDFDocument.create();
        const idx = Array.from(
          { length: s.to - s.from + 1 },
          (_, k) => s.from - 1 + k,
        );
        const copied = await out.copyPages(src, idx);
        copied.forEach((p) => out.addPage(p));
        const bytes = await out.save();
        const cleanName = s.name
          .replace(/[<>:"/\\|?*]/g, "")
          .trim()
          .toUpperCase();
        zip.file(`${n}. ${cleanName}.pdf`, bytes);
        n++;
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "skripsi_split.zip";
      a.click();
      setStatus("Selesai! ZIP sedang diunduh.");
    } catch (err: unknown) {
      setStatus(
        "Gagal split: " + (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div>
        <label className="block border-2 border-dashed rounded-lg p-8 text-center cursor-pointer text-sm text-gray-500">
          Klik atau pilih file PDF skripsi
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) =>
              e.target.files?.[0] && handleFile(e.target.files[0])
            }
          />
        </label>
        {status && <p className="text-sm text-gray-500 mt-2">{status}</p>}
      </div>

      {sections.length > 0 && (
        <div className="border rounded-lg p-4 space-y-3">
          <p className="font-medium text-sm">
            Struktur terdeteksi (edit bila perlu)
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-1">Nama</th>
                  <th className="py-1">Dari</th>
                  <th className="py-1">Sampai</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sections.map((s, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-1 pr-2">
                      <input
                        className="w-full border rounded px-1"
                        value={s.name}
                        onChange={(e) =>
                          updateSection(i, { name: e.target.value })
                        }
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="number"
                        min={1}
                        max={numPages}
                        className="w-16 border rounded px-1"
                        value={s.from}
                        onChange={(e) =>
                          updateSection(i, { from: +e.target.value })
                        }
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="number"
                        min={1}
                        max={numPages}
                        className="w-16 border rounded px-1"
                        value={s.to}
                        onChange={(e) =>
                          updateSection(i, { to: +e.target.value })
                        }
                      />
                    </td>
                    <td>
                      <button
                        onClick={() => removeSection(i)}
                        className="text-xs text-red-500"
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button
              onClick={addSection}
              className="text-xs border rounded px-2 py-1"
            >
              + Tambah bagian
            </button>
            <button
              onClick={splitAndDownload}
              disabled={busy}
              className="ml-auto bg-gray-950 text-white text-sm rounded px-3 py-1.5 disabled:opacity-50"
            >
              Split & Unduh ZIP
            </button>
          </div>
        </div>
      )}
    </div>
  );
}