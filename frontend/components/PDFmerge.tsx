"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { TransferFile } from "../app/lib/types";
import { PDFDocument } from "pdf-lib";
import { ArrowDown, ArrowUp, GripVertical, Trash2, Upload } from "lucide-react";

type MergeItem = {
  id: string;
  name: string;
  size: number;
  source: File | Uint8Array;
  pages: number | null; // null = gagal dibaca
  error?: string;
};

async function readBytes(source: File | Uint8Array): Promise<Uint8Array> {
  return source instanceof File
    ? new Uint8Array(await source.arrayBuffer())
    : source;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function PDFMerge({
  incoming,
  onConsumed,
}: {
  incoming?: TransferFile[] | null;
  onConsumed?: () => void;
}) {
  const [items, setItems] = useState<MergeItem[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastIncoming, setLastIncoming] = useState(incoming);

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  // Simpan callback di ref supaya effect tidak jalan ulang
  // hanya karena parent membuat fungsi baru di tiap render.
  const onConsumedRef = useRef(onConsumed);
  useEffect(() => {
    onConsumedRef.current = onConsumed;
  }, [onConsumed]);

  // Proses transfer baru saat render, bukan dengan setState di dalam effect.
  if (incoming !== lastIncoming) {
    setLastIncoming(incoming);
    if (incoming?.length) {
      setItems((prev) => [
        ...prev,
        ...incoming.map((f) => ({
          id: crypto.randomUUID(),
          name: f.name,
          size: f.bytes.byteLength,
          source: f.bytes,
          pages: f.pages,
        })),
      ]);
      setStatus("");
    }
  }

  // Beri tahu PDFsplit setelah hasil transfer diterima.
  useEffect(() => {
    if (!incoming?.length) return;
    onConsumedRef.current?.();
  }, [incoming]);

  const reorder = (from: number, to: number) =>
    setItems((prev) => {
      if (from === to || from < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });

  const endDrag = () => {
    setDragIdx(null);
    setOverIdx(null);
  };

  const addFiles = useCallback(async (fileList: FileList) => {
    setBusy(true);
    setStatus("Membaca file...");
    const added: MergeItem[] = [];

    for (const file of Array.from(fileList)) {
      const isPdf =
        file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (!isPdf) continue;

      const base = {
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        source: file as File | Uint8Array,
      };

      try {
        const doc = await PDFDocument.load(await file.arrayBuffer());
        added.push({ ...base, pages: doc.getPageCount() });
      } catch (err: unknown) {
        added.push({
          ...base,
          pages: null,
          error: err instanceof Error ? err.message : "File tidak valid",
        });
      }
    }

    setItems((prev) => [...prev, ...added]);
    setStatus(
      added.length ? "" : "Tidak ada file PDF yang valid yang dipilih.",
    );
    setBusy(false);
  }, []);

  const move = (idx: number, dir: -1 | 1) => reorder(idx, idx + dir);

  const remove = (id: string) =>
    setItems((prev) => prev.filter((it) => it.id !== id));

  const mergeAndDownload = async () => {
    const valid = items.filter((it) => it.pages !== null);
    if (valid.length < 2) {
      setStatus("Pilih minimal 2 file PDF yang valid.");
      return;
    }

    setBusy(true);
    try {
      const out = await PDFDocument.create();

      for (let i = 0; i < valid.length; i++) {
        setStatus(`Menggabungkan ${i + 1}/${valid.length}: ${valid[i].name}`);
        const src = await PDFDocument.load(await readBytes(valid[i].source));
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }

      const bytes = await out.save();
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "skripsi_gabungan.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      setStatus("Selesai! File gabungan sedang diunduh.");
    } catch (err: unknown) {
      setStatus(
        "Gagal menggabungkan: " +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setBusy(false);
    }
  };

  const totalPages = items.reduce((sum, it) => sum + (it.pages ?? 0), 0);
  const validCount = items.filter((it) => it.pages !== null).length;

  return (
    <div className="max-w-4xl mx-auto px-6 pb-10">
      <h1 className="text-2xl font-bold text-center">Gabung PDF Skripsi</h1>
      <p className="text-center text-sm text-gray-500 mb-5">
        Gabungkan beberapa file PDF (cover, bab, lampiran) menjadi satu
      </p>

      <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
        <label className="cursor-pointer flex flex-col items-center gap-4 py-10 border-2 border-dashed border-slate-200 rounded-xl hover:border-slate-300 hover:bg-slate-50 transition-colors">
          <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
            <Upload className="w-6 h-6 text-slate-500" />
          </div>
          <p>Klik atau pilih beberapa file PDF</p>
          <input
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = ""; // supaya file yang sama bisa dipilih lagi
            }}
          />
        </label>
        {status && <p className="text-sm text-gray-500 mt-2">{status}</p>}
      </div>

      {items.length > 0 && (
        <div className="border rounded-lg p-4 space-y-3 mt-5">
          <div>
            <p className="font-medium text-sm">
              Urutan penggabungan ({items.length} file, {totalPages} halaman)
            </p>
            <p className="text-xs text-slate-500">
              Seret ikon ⋮⋮ untuk mengubah urutan, atau pakai tombol panah.
            </p>
          </div>

          <ul className="space-y-2">
            {items.map((it, i) => {
              const isDragging = dragIdx === i;
              const isTarget =
                overIdx === i && dragIdx !== null && dragIdx !== i;
              // Geser ke bawah -> mendarat di bawah target; ke atas -> di atas target
              const landsBelow = isTarget && dragIdx! < i;

              return (
                <li
                  key={it.id}
                  draggable
                  onDragStart={(e) => {
                    setDragIdx(i);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (overIdx !== i) setOverIdx(i);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIdx !== null) reorder(dragIdx, i);
                    endDrag();
                  }}
                  onDragEnd={endDrag}
                  className={`relative flex items-center gap-3 rounded-lg border bg-white px-3 py-2.5 text-sm shadow-sm transition ${
                    isDragging
                      ? "opacity-50 border-dashed border-slate-400 bg-slate-50"
                      : isTarget
                        ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                        : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  {isTarget && (
                    <span
                      className={`pointer-events-none absolute left-0 right-0 h-1 rounded-full bg-blue-600 ${
                        landsBelow ? "-bottom-1.5" : "-top-1.5"
                      }`}
                    />
                  )}

                  <GripVertical className="w-5 h-5 text-slate-400 cursor-grab active:cursor-grabbing shrink-0" />
                  <span className="w-6 text-right font-medium text-slate-500">
                    {i + 1}.
                  </span>

                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-slate-800">
                      {it.name}
                    </p>
                    <p
                      className={
                        it.error
                          ? "text-xs text-red-500"
                          : "text-xs text-slate-500"
                      }
                    >
                      {it.error
                        ? `Gagal dibaca: ${it.error}`
                        : `${it.pages} halaman · ${formatSize(it.size)}`}
                    </p>
                  </div>

                  <button
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="p-1.5 border rounded-md hover:bg-slate-100 disabled:opacity-30"
                    aria-label="Naikkan"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === items.length - 1}
                    className="p-1.5 border rounded-md hover:bg-slate-100 disabled:opacity-30"
                    aria-label="Turunkan"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => remove(it.id)}
                    className="p-1.5 text-red-500 border border-red-200 rounded-md hover:bg-red-50"
                    aria-label="Hapus"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex gap-2">
            <button
              onClick={() => setItems([])}
              disabled={busy}
              className="text-xs border rounded px-2 py-1 disabled:opacity-50"
            >
              Kosongkan
            </button>
            <button
              onClick={mergeAndDownload}
              disabled={busy || validCount < 2}
              className="ml-auto bg-gray-950 text-white text-sm rounded px-3 py-1.5 disabled:opacity-50"
            >
              Gabung & Unduh PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
