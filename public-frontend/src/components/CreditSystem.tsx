import CreditFeatures from "./CreditFeatures";
import CreditSimulator from "./CreditSimulator";

export default function CreditSystem() {
  return (
    <section className="sec">
      <div className="ey rev">Credit system</div>
      <h2 className="st rev d1">
        Pay for work done, <span className="dim">not seats.</span>
      </h2>
      <p className="ss rev d2">
        Credits are consumed only when agents are working. No idle charges, no
        seat fees.
      </p>
      <div className="cgrid">
        <CreditFeatures />
        <CreditSimulator />
      </div>
    </section>
  );
}
