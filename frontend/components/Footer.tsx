export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white mt-16">
      <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
        <p>© {new Date().getFullYear()} SkripsiKit — dibuat oleh Kholid Irfangi</p>
        <p>File kamu tidak disimpan permanen di server</p>
      </div>
    </footer>
  );
}