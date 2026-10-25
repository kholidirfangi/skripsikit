"use client";

import { useState, useRef, useCallback } from "react";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import type * as PdfJsLib from "pdfjs-dist";
import { FileText, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import type { TransferFile } from "../app/lib/types";

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
const BAB_RE =
  /^\s*(BAB|CHAPTER)\s+([IVXLCDM]+|\d{1,2}|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN)(?=\s|$|[.:\-])/i;
const DOTS_RE = /\.{4,}/;

const ROMANS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const NUM_WORDS = [
  "ONE",
  "TWO",
  "THREE",
  "FOUR",
  "FIVE",
  "SIX",
  "SEVEN",
  "EIGHT",
  "NINE",
  "TEN",
];

function toRomanLabel(raw: string): string {
  const u = raw.toUpperCase();
  if (/^\d+$/.test(u)) return ROMANS[+u - 1] ?? u;
  const w = NUM_WORDS.indexOf(u);
  return w >= 0 ? ROMANS[w] : u;
}

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

const TOC_TITLE_RE = /^(?:DAFTAR\s+ISI|TABLE\s+OF\s+CONTENTS?|CONTENTS)$/i;

function isProbableTocPage(lines: PageLines): boolean {
  if (isTocPage(lines)) return true;

  let tocCount = 0;
  let babCount = 0;
  for (const line of lines) {
    if (looksLikeTocReference(line)) tocCount++;
    if (BAB_RE.test(line)) babCount++;
  }
  if (tocCount >= 3) return true;

  // Judul "TABLE OF CONTENTS" + beberapa baris BAB/CHAPTER (walau tanpa titik-titik)
  const hasTocTitle = lines.slice(0, 6).some((l) => TOC_TITLE_RE.test(l));
  return hasTocTitle && babCount >= 2;
}

// ---------------------------------------------------------------------------
// BAB DETECTION
// ---------------------------------------------------------------------------
function detectBab(lines: PageLines): string | null {
  for (const line of lines.slice(0, 12)) {
    if (line.length > 100) continue;
    const m = line.match(BAB_RE);
    if (!m) continue;

    // Hindari kalimat isi seperti "Chapter 2 explains the research method in detail."
    const rest = line.slice(m[0].length).trim();
    if (/\.$/.test(rest) && rest.split(/\s+/).length >= 6) continue;

    return `BAB ${toRomanLabel(m[2])}`;
  }
  return null;
}

type Lang = "id" | "en";

// Detect language based on BAB/CHAPTER usage in the first 12 lines of each page.

function detectLang(pages: PageLines[]): Lang {
  let id = 0;
  let en = 0;
  for (const lines of pages) {
    if (isProbableTocPage(lines)) continue;
    for (const line of lines.slice(0, 12)) {
      const m = line.match(BAB_RE);
      if (!m) continue;
      if (m[1].toUpperCase() === "CHAPTER") en++;
      else id++;
      break;
    }
  }
  return en > id ? "en" : "id";
}

// ---------------------------------------------------------------------------
// DAFTAR PUSTAKA
// ---------------------------------------------------------------------------
const PUSTAKA_LOOSE_RE = /^DAFTAR\s+PUSTAKA(?:\s|$)/;
const PUSTAKA_TITLE_RE =
  /^(?:DAFTAR\s+PUSTAKA|REFERENCES?|BIBLIOGRAPHY|LIST\s+OF\s+REFERENCES|REFERENCE\s+LIST|WORKS\s+CITED)\s*[:.]?$/;

function hasPustakaHeading(lines: PageLines): boolean {
  const top = lines.slice(0, 25).map(normalizeHeadingText);

  for (const t of top) {
    if (PUSTAKA_LOOSE_RE.test(t) || PUSTAKA_TITLE_RE.test(t)) return true;
  }

  // heading terpecah dua baris: "LIST OF" + "REFERENCES", "DAFTAR" + "PUSTAKA"
  for (let i = 0; i < top.length - 1; i++) {
    if (PUSTAKA_TITLE_RE.test(`${top[i]} ${top[i + 1]}`)) return true;
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

// LAMPIRAN, LAMPIRAN 1, LAMPIRAN A, LAMPIRAN-LAMPIRAN, APPENDIX, APPENDIX A,
// APPENDICES, "APPENDIX A: Questionnaire"
const LAMPIRAN_HEAD_RE =
  /^(?:LAMPIRAN|APPENDIX|APPENDICES)(?:-LAMPIRAN)?(?:\s+(?:\d{1,3}|[A-Z]|[IVXLCDM]+))?(?:\s*[:.\-]\s*.{0,60})?$/;

function hasLampiranHeading(lines: PageLines): boolean {
  const top = lines.slice(0, 25).map(normalizeHeadingText);

  for (const line of top) {
    const cleaned = line.replace(/\s*-\s*/g, "-");
    if (LAMPIRAN_HEAD_RE.test(line) || LAMPIRAN_HEAD_RE.test(cleaned)) {
      return true;
    }
  }

  // heading terpecah dua baris: "APPENDIX" + "A"
  for (let i = 0; i < top.length - 1; i++) {
    if (LAMPIRAN_HEAD_RE.test(`${top[i]} ${top[i + 1]}`)) return true;
  }

  return false;
}

function scoreLampiranPage(lines: PageLines): number {
  let score = 0;

  if (hasLampiranHeading(lines)) score += 12;

  const top = lines.slice(0, 25);
  for (let i = 0; i < top.length; i++) {
    if (LAMPIRAN_HEAD_RE.test(normalizeHeadingText(top[i]))) {
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
    "QUESTIONNAIRE",
    "INSTRUMENT",
    "DOCUMENTATION",
    "LETTER",
    "INTERVIEW",
    "TRANSCRIPT",
    "APPROVAL",
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
  "QUESTIONNAIRE",
  "RESEARCH INSTRUMENT",
  "INTERVIEW GUIDE",
  "INTERVIEW TRANSCRIPT",
  "PERMISSION LETTER",
  "RESEARCH PERMIT",
  "RESPONDENT DATA",
  "RESEARCH DATA",
  "INTERVIEW RESULTS",
  "SPSS OUTPUT",
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

function findLampiranPage(
  pages: PageLines[],
  startPage: number,
): number | null {
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

const EN_NAMES: Record<string, string> = {
  "Halaman Awal": "Front Matter",
  "Daftar Pustaka": "References",
  Lampiran: "Appendices",
};

function localizeSections(sections: Section[], lang: Lang): Section[] {
  if (lang === "id") return sections;
  return sections.map((s) => ({
    ...s,
    name: s.name.startsWith("BAB ")
      ? s.name.replace("BAB", "CHAPTER")
      : (EN_NAMES[s.name] ?? s.name),
  }));
}

const VALID_BAB = ["BAB I", "BAB II", "BAB III", "BAB IV", "BAB V"];

function detectSections(pages: PageLines[]): Section[] {
  const total = pages.length;
  if (total === 0) return [];
  const lang = detectLang(pages);

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
    return localizeSections(
      [{ name: "Halaman Awal", from: 1, to: total }],
      lang,
    );
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
  return localizeSections(
    sections.filter((s) => s.from >= 1 && s.from <= s.to && s.to <= total),
    lang,
  );
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
  const [fileName, setFileName] = useState("");

  const isInvalid = (s: Section) =>
    s.from < 1 || s.to < s.from || s.to > numPages;

  const validCount = sections.filter((s) => !isInvalid(s)).length;

  const resetAll = () => {
    bytesRef.current = null;
    setSections([]);
    setNumPages(0);
    setFileName("");
    setStatus("");
  };

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name);
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

  const buildSplitFiles = async (): Promise<TransferFile[]> => {
    const src = await PDFDocument.load(bytesRef.current!);
    const files: TransferFile[] = [];
    let n = 1;
    for (const s of sections) {
      if (isInvalid(s)) continue;
      const out = await PDFDocument.create();
      const idx = Array.from(
        { length: s.to - s.from + 1 },
        (_, k) => s.from - 1 + k,
      );
      const copied = await out.copyPages(src, idx);
      copied.forEach((p) => out.addPage(p));
      const cleanName = s.name
        .replace(/[<>:"/\\|?*]/g, "")
        .trim()
        .toUpperCase();
      files.push({
        name: `${n}. ${cleanName}.pdf`,
        bytes: await out.save(),
        pages: s.to - s.from + 1,
      });
      n++;
    }
    return files;
  };

  const splitAndDownload = async () => {
    if (!bytesRef.current) return;
    setBusy(true);
    setStatus("Memproses split...");
    try {
      const zip = new JSZip();
      for (const f of await buildSplitFiles()) zip.file(f.name, f.bytes);
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
    <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-10">
      <h1 className="text-xl sm:text-2xl font-bold text-center">
        Split Skripsi per BAB
      </h1>
      <p className="text-center text-sm text-gray-500 mb-5">
        Pisahkan skripsi Anda berdasarkan bab dalam sekali klik
      </p>

      {/* Dropzone: tampil sebelum ada file */}
      {numPages === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-10 text-center">
          <label className="cursor-pointer flex flex-col items-center gap-4 py-8 sm:py-10 px-3 border-2 border-dashed border-slate-200 rounded-xl hover:border-slate-300 hover:bg-slate-50 active:bg-slate-50 transition-colors">
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
              <Upload className="w-6 h-6 text-slate-500" />
            </div>
            <p className="text-sm sm:text-base">
              Klik atau pilih file PDF skripsi
            </p>
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                if (e.target.files?.[0]) handleFile(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </label>
          {status && <p className="text-sm text-gray-500 mt-3">{status}</p>}
        </div>
      )}

      {/* Info file: tampil setelah file dibaca */}
      {numPages > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 sm:px-4 py-3 shadow-sm">
          <div className="w-10 h-10 shrink-0 rounded-lg bg-red-50 flex items-center justify-center">
            <FileText className="w-5 h-5 text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-medium text-slate-800">
              {fileName}
            </p>
            <p className="text-xs text-slate-500">{numPages} halaman</p>
          </div>
          <button
            onClick={resetAll}
            disabled={busy}
            className="shrink-0 flex items-center gap-1.5 text-xs border rounded-md px-2.5 py-2 hover:bg-slate-100 disabled:opacity-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden xs:inline sm:inline">Ganti file</span>
          </button>
        </div>
      )}

      {numPages > 0 && status && (
        <p className="text-sm text-slate-500 text-center mt-3">{status}</p>
      )}

      {/* Daftar bagian */}
      {numPages > 0 && (
        <div className="rounded-lg p-3 sm:p-4 space-y-3 mt-5">
          <div>
            <p className="font-medium text-sm">
              Struktur terdeteksi ({sections.length} bagian)
            </p>
            <p className="text-xs text-slate-500">
              Ubah nama atau rentang halaman bila perlu. Kartu merah berarti
              rentang tidak valid dan akan dilewati.
            </p>
          </div>

          <ul className="space-y-2">
            {sections.map((s, i) => {
              const invalid = isInvalid(s);
              return (
                <li
                  key={i}
                  className={`flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 rounded-lg px-3 py-3 sm:py-2.5 text-sm shadow-sm ${
                    invalid
                      ? "border-red-300 bg-red-50"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  {/* Baris 1 (HP): nomor + nama */}
                  <div className="flex items-center gap-2 sm:flex-1 sm:min-w-0">
                    <span className="w-6 shrink-0 text-right font-medium text-slate-500">
                      {i + 1}.
                    </span>
                    <input
                      className="flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-2 py-2 sm:py-1.5 text-base sm:text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                      value={s.name}
                      onChange={(e) =>
                        updateSection(i, { name: e.target.value })
                      }
                      aria-label="Nama bagian"
                    />
                  </div>

                  {/* Baris 2 (HP): halaman + info + hapus */}
                  <div className="flex items-center gap-2 pl-8 sm:pl-0">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span>Hal.</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={numPages}
                        className="w-16 rounded-md border border-slate-200 bg-white px-2 py-2 sm:py-1.5 text-base sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                        value={s.from}
                        onChange={(e) =>
                          updateSection(i, { from: +e.target.value })
                        }
                        aria-label="Dari halaman"
                      />
                      <span>–</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={numPages}
                        className="w-16 rounded-md border border-slate-200 bg-white px-2 py-2 sm:py-1.5 text-base sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                        value={s.to}
                        onChange={(e) =>
                          updateSection(i, { to: +e.target.value })
                        }
                        aria-label="Sampai halaman"
                      />
                    </div>

                    <span
                      className={`flex-1 sm:flex-none sm:w-24 text-xs text-right ${
                        invalid ? "text-red-500" : "text-slate-500"
                      }`}
                    >
                      {invalid ? "Tidak valid" : `${s.to - s.from + 1} hal.`}
                    </span>

                    <button
                      onClick={() => removeSection(i)}
                      className="shrink-0 p-2 sm:p-1.5 text-red-500 border border-red-200 rounded-md hover:bg-red-50 active:bg-red-50"
                      aria-label="Hapus"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {sections.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">
              Belum ada bagian. Klik &quot;Tambah bagian&quot; untuk mulai.
            </p>
          )}

          <div className="flex justify-between gap-2 sm:flex-row">
            <button
              onClick={addSection}
              className="flex items-center justify-center gap-1 text-sm sm:text-xs border rounded-md px-3 py-2.5 sm:py-1.5 hover:bg-slate-100"
            >
              <Plus className="w-3.5 h-3.5" />
              Tambah bagian
            </button>
            <button
              onClick={splitAndDownload}
              disabled={busy || validCount === 0}
              className="bg-gray-950 text-white text-sm rounded-md px-3 py-2.5 sm:py-1.5 disabled:opacity-50"
            >
              Split & Unduh ZIP ({validCount})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
