import Footer from "@/components/Footer";
import Header from "@/components/Headers";
import Hero from "@/components/Hero";
import PDFsplit from "@/components/PDFsplit";
import SkripsiKitTool from "@/components/SkripsikitTools";

export default function Home() {
  return (
    <div className="min-h-screen bg-linear-to-b from-slate-50 to-white">
      <Header />
      <Hero />
      <SkripsiKitTool />
      <PDFsplit />
      <Footer />
    </div>
  );
}
