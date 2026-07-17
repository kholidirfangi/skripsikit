import { Wand2, ShieldCheck, ListChecks } from "lucide-react";

const points = [
  {
    icon: Wand2,
    title: "Deteksi otomatis",
    desc: "BAB, Daftar Pustaka, dan Lampiran terdeteksi otomatis dari struktur dokumen kamu.",
  },
  {
    icon: ListChecks,
    title: "Kamu yang konfirmasi",
    desc: "Periksa dan koreksi hasil deteksi sebelum diproses, supaya hasilnya sesuai.",
  },
  {
    icon: ShieldCheck,
    title: "Sesuai kaidah skripsi",
    desc: "Romawi di halaman awal, Arab mulai BAB I — posisi bawah tengah & kanan atas otomatis.",
  },
];

export default function Hero() {
  return (
    <section className="max-w-4xl mx-auto px-6 pt-14 pb-10 text-center">
      <h2 className="text-4xl font-bold text-slate-900 tracking-tight">
        Rapikan nomor halaman skripsi <br />
        <span className="bg-linear-to-r from-blue-600 to-emerald-500 bg-clip-text text-transparent">
          dalam hitungan detik
        </span>
      </h2>
      <p className="mt-4 text-slate-500 max-w-xl mx-auto leading-relaxed">
        Upload file Word skripsi kamu, SkripsiKit otomatis mengatur format angka
        Romawi dan Arab sesuai kaidah penulisan karya ilmiah — tanpa perlu atur
        section break manual di Word.
      </p>

      <div className="grid sm:grid-cols-3 gap-4 mt-10 text-left">
        {points.map(({ icon: Icon, title, desc }) => (
          <div
            key={title}
            className="bg-white border border-slate-200 rounded-xl p-4"
          >
            <Icon className="w-7 h-7 text-slate-700 mb-2" />
            <p className="text-md font-medium text-slate-900">{title}</p>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              {desc}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
