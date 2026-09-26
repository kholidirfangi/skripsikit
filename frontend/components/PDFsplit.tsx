"use client";

import { useState, useRef, useCallback } from "react";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import type * as PdfJsLib from "pdfjs-dist";

// pdfjs-dist 5.x relies internally on Uint8Array.prototype.toHex/toBase64,
// a very recent JS engine feature not yet available in every browser —
// causing "toHex is not a function". We polyfill it defensively: once on
// the main thread, and once inside the pdf.js worker (a separate JS realm,
// so the main-thread patch alone doesn't reach it).
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
  // Prepend the polyfill as plain statements before the worker's own code.
  // ES modules allow top-level statements alongside import/export, so this
  // is safe even though the file is a module.
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

type Section = { name: string; from: number; to: number };

const BAB_RE = /\bBAB\s+([IVXLCDM]+|\d{1,2})\b/gi;
const PUSTAKA_RE = /DAFTAR\s+PUSTAKA/i;
const LAMPIRAN_RE = /\bLAMPIRAN\b/i;

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
      const pages = doc.numPages;
      setNumPages(pages);
      setStatus(`Menganalisis ${pages} halaman...`);

      const texts: string[] = [];
      for (let i = 1; i <= pages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        texts.push(
          content.items.map((it) => ("str" in it ? it.str : "")).join(" "),
        );
      }

      const candidates: { page: number; type: string; label: string }[] = [];
      texts.forEach((t, i) => {
        const babMatches = t.match(BAB_RE) || [];
        const uniqueBab = new Set(
          babMatches.map((s) => s.toUpperCase().replace(/\s+/g, " ")),
        );
        const m = t.match(/\bBAB\s+([IVXLCDM]+|\d{1,2})\b/i);
        if (uniqueBab.size === 1 && babMatches.length <= 2 && m) {
          candidates.push({
            page: i + 1,
            type: "bab",
            label: "BAB " + m[1].toUpperCase(),
          });
        } else if (PUSTAKA_RE.test(t) && uniqueBab.size === 0) {
          candidates.push({
            page: i + 1,
            type: "pustaka",
            label: "Daftar Pustaka",
          });
        } else if (
          LAMPIRAN_RE.test(t) &&
          uniqueBab.size === 0 &&
          !PUSTAKA_RE.test(t)
        ) {
          candidates.push({ page: i + 1, type: "lampiran", label: "Lampiran" });
        }
      });

      const seen = new Set<string>();
      const deduped = candidates.filter((c) =>
        seen.has(c.label) ? false : (seen.add(c.label), true),
      );
      deduped.sort((a, b) => a.page - b.page);

      const built: Section[] = [];
      built.push({
        name: "Halaman Awal",
        from: 1,
        to: deduped[0] ? deduped[0].page - 1 : pages,
      });
      deduped.forEach((cur, i) => {
        const next = deduped[i + 1];
        built.push({
          name: cur.label,
          from: cur.page,
          to: next ? next.page - 1 : pages,
        });
      });

      setSections(built);
      setStatus(
        deduped.length
          ? "Terdeteksi otomatis — cek & koreksi sebelum split."
          : "Tidak ada heading terdeteksi. Isi manual.",
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
      let n = 1;
      for (const s of sections) {
        if (s.from < 1 || s.to < s.from || s.to > numPages) continue;
        const src = await PDFDocument.load(bytesRef.current);
        const out = await PDFDocument.create();
        const idx = Array.from(
          { length: s.to - s.from + 1 },
          (_, k) => s.from - 1 + k,
        );
        const copied = await out.copyPages(src, idx);
        copied.forEach((p) => out.addPage(p));
        const bytes = await out.save();
        const cleanName = s.name.replace(/[^\w\- ]/g, "").trim().toUpperCase();
        const fname = `${n}. ${cleanName}.pdf`;
        zip.file(fname, bytes);
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