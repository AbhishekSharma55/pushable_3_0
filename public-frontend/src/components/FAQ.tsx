"use client";

import { useState } from "react";
import { faqItems } from "@/data/faq";

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="sec">
      <div style={{ textAlign: "center" }}>
        <div className="ey rev" style={{ display: "inline-block" }}>
          FAQ
        </div>
        <h2 className="st rev d1" style={{ textAlign: "center" }}>
          Common questions.
        </h2>
      </div>
      <div className="faqlist rev d2">
        {faqItems.map((item, i) => (
          <div key={i} className={`fi ${openIndex === i ? "open" : ""}`}>
            <button className="fq" onClick={() => toggle(i)}>
              {item.question}
              <span className="ficon">+</span>
            </button>
            <div className="fa">{item.answer}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
