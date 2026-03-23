import Logo from "./Logo";

export default function Footer() {
  return (
    <footer>
      <div className="fi2">
        <div className="ftop">
          <div className="fbrand">
            <a href="/" className="nav-logo" style={{ display: "inline-flex" }}>
              <Logo />
              Pushable<span style={{ opacity: 0.35 }}>.ai</span>
            </a>
            <p className="fdesc">
              AI employees for modern teams. Deploy intelligent agents that
              scale with your business.
            </p>
          </div>
          <div>
            <div className="fct">Product</div>
            <ul className="flinks">
              <li><a href="/agents">Agents</a></li>
              <li><a href="/credits">Credits</a></li>
              <li><a href="/pricing">Pricing</a></li>
              <li><a href="/docs">Docs</a></li>
            </ul>
          </div>
          <div>
            <div className="fct">Company</div>
            <ul className="flinks">
              <li><a href="/about">About</a></li>
              <li><a href="/contact">Contact</a></li>
              <li><a href="/blog">Blog</a></li>
              {/* <li><a href="#">Careers</a></li> */}
            </ul>
          </div>
          <div>
            <div className="fct">Legal</div>
            <ul className="flinks">
              <li><a href="/privacy">Privacy</a></li>
              <li><a href="/terms">Terms</a></li>
              {/* <li><a href="#">Security</a></li>
              <li><a href="#">Status</a></li> */}
            </ul>
          </div>
        </div>
        <div className="fbot">
          <span>© 2026 Pushable.ai — All rights reserved</span>
          {/* <div className="fsoc">
            <a href="#">Twitter</a>
            <a href="#">LinkedIn</a>
            <a href="#">GitHub</a>
          </div> */}
        </div>
      </div>
    </footer>
  );
}
