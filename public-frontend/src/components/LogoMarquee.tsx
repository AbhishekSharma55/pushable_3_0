import { logos } from "@/data/logos";

export default function LogoMarquee() {
  return (
    <div className="logos-wrap">
      <div className="logos-inner">
        <span className="logos-lbl">Trusted by</span>
        <div className="mq-wrap">
          <div className="mq-track">
            {logos.map((name, i) => (
              <span key={`a-${i}`} className="logo-i">
                {name}
              </span>
            ))}
            {logos.map((name, i) => (
              <span key={`b-${i}`} className="logo-i">
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
