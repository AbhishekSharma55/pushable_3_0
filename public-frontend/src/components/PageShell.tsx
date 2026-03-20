import GridBackground from "./GridBackground";
import ParticleCanvas from "./ParticleCanvas";
import Navbar from "./Navbar";
import Footer from "./Footer";
import ScrollReveal from "./ScrollReveal";

export default function PageShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <GridBackground />
      <ParticleCanvas />
      <Navbar />
      {children}
      <Footer />
      <ScrollReveal />
    </>
  );
}
