import GridBackground from "@/components/GridBackground";
import ParticleCanvas from "@/components/ParticleCanvas";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import LogoMarquee from "@/components/LogoMarquee";
import AgentsBento from "@/components/AgentsBento";
import HowItWorks from "@/components/HowItWorks";
import CreditSystem from "@/components/CreditSystem";
import PricingSection from "@/components/PricingSection";
import Testimonials from "@/components/Testimonials";
import FAQ from "@/components/FAQ";
import CTASection from "@/components/CTASection";
import Footer from "@/components/Footer";
import ScrollReveal from "@/components/ScrollReveal";

export default function Home() {
  return (
    <>
      <GridBackground />
      <ParticleCanvas />
      <Navbar />
      <Hero />
      <LogoMarquee />
      <AgentsBento />
      <HowItWorks />
      <CreditSystem />
      <PricingSection />
      <Testimonials />
      <FAQ />
      <CTASection />
      <Footer />
      <ScrollReveal />
    </>
  );
}
