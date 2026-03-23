"use client";

import { useEffect } from "react";

function initReveal() {
  const els = document.querySelectorAll(".rev:not(.v)");
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          setTimeout(() => entry.target.classList.add("v"), i * 50);
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08 }
  );
  els.forEach((el) => io.observe(el));
  return io;
}

export default function ScrollReveal() {
  useEffect(() => {
    const io = initReveal();

    // When the user navigates back/forward (bfcache), re-reveal any
    // elements that are still hidden because the observer was disconnected.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        // Page was restored from bfcache — reveal all remaining .rev elements
        document.querySelectorAll(".rev:not(.v)").forEach((el) => {
          el.classList.add("v");
        });
      }
    };

    window.addEventListener("pageshow", onPageShow);

    return () => {
      io.disconnect();
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return null;
}
