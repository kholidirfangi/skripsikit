'use client';

import { ListOrdered, ArrowRight } from 'lucide-react';

export default function Header() {
  function scrollToTool() {
    document.getElementById('tool')?.scrollIntoView({ behavior: 'smooth' });
  }

  return (
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-20">
      <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="relative w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center shrink-0">
            <ListOrdered className="w-5 h-5 text-white" strokeWidth={2.25} />
          </div>
          <div className="leading-tight">
            <p className="font-semibold text-slate-900 text-[15px]">SkripsiKit</p>
            <p className="text-xs text-slate-400 hidden sm:block">
              Penomoran halaman skripsi otomatis
            </p>
          </div>
        </div>

        <button
          onClick={scrollToTool}
          className="inline-flex items-center gap-1.5 bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors"
        >
          Coba Sekarang
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
}