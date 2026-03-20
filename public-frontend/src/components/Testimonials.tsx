import {
  testimonials,
  testimonialAfterText,
} from "@/data/testimonials";

export default function Testimonials() {
  const cards = [...testimonials, ...testimonials];

  return (
    <div className="testi-sec">
      <div style={{ textAlign: "center", marginBottom: "48px" }}>
        <div className="ey" style={{ display: "inline-block" }}>
          Testimonials
        </div>
        <h2 className="st" style={{ textAlign: "center", marginTop: "12px" }}>
          Teams ship faster
          <br />
          with Pushable.ai
        </h2>
      </div>
      <div style={{ overflow: "hidden", position: "relative" }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "80px",
            background: "linear-gradient(to right,var(--bg2),transparent)",
            zIndex: 2,
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: "80px",
            background: "linear-gradient(to left,var(--bg2),transparent)",
            zIndex: 2,
          }}
        />
        <div className="tmarq">
          {cards.map((t, i) => (
            <div key={i} className="tc">
              <div className="tstars">★★★★★</div>
              <p className="ttext">
                {t.text}
                <strong>{t.highlight}</strong>
                {testimonialAfterText[t.initials]}
              </p>
              <div className="tauth">
                <div className="tav">{t.initials}</div>
                <div>
                  <div className="tname">{t.name}</div>
                  <div className="trole">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
