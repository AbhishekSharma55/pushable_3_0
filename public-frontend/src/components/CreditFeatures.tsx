export default function CreditFeatures() {
  return (
    <div className="citems rev">
      <div className="ci">
        <div className="ciicon">💳</div>
        <div>
          <div className="cititle">Credits = agent compute</div>
          <div className="cidesc">
            Each agent consumes credits based on task complexity. Simple replies
            cost 0.5 credits. Research tasks up to 15.
          </div>
        </div>
      </div>
      <div className="ci">
        <div className="ciicon">🔄</div>
        <div>
          <div className="cititle">Unused credits roll over</div>
          <div className="cidesc">
            On Growth and Enterprise plans, unused monthly credits carry forward.
            No waste at month-end.
          </div>
        </div>
      </div>
      <div className="ci">
        <div className="ciicon">⚡</div>
        <div>
          <div className="cititle">Top up anytime</div>
          <div className="cidesc">
            Running low? Add credit packs from your dashboard instantly — no plan
            change required.
          </div>
        </div>
      </div>
    </div>
  );
}
