import Link from "next/link";
import { Icon } from "@/components/icon";
import { SimulationNotice } from "@/components/simulation-notice";

export default function HomePage() {
  return (
    <div className="container landing-page">
      <section className="hero" aria-labelledby="hero-heading">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="eyebrow-line" /> YOUR SPACE. YOUR PACE.
          </p>
          <h1 id="hero-heading">
            A little clarity.
            <br />A little more{" "}
            <span className="serif-accent">confidence.</span>
          </h1>
          <p className="hero-description">
            Keep your trusted contacts close, choose when to raise an SOS, and
            see a clear record of what happened. Sakhi keeps you informed,
            without promising protection.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/auth?mode=signup">
              Create your account <Icon name="arrow" />
            </Link>
            <Link className="text-link" href="/auth">
              Already a member? Sign in
            </Link>
          </div>
          <p className="quiet-note">
            <Icon name="lock" /> No location permission needed to get started.
          </p>
        </div>
        <div className="hero-art">
          <div className="orbit orbit-one" aria-hidden="true" />
          <div className="orbit orbit-two" aria-hidden="true" />
          <span className="art-star art-star-one" aria-hidden="true">
            <Icon name="spark" />
          </span>
          <span className="art-star art-star-two" aria-hidden="true">
            <Icon name="spark" />
          </span>
          <div className="welcome-card">
            <div className="card-topline">
              <span className="small-wordmark">sakhi.</span>
              <span className="pill">A mindful beginning</span>
            </div>
            <div className="welcome-emblem" aria-hidden="true">
              <Icon name="spark" />
            </div>
            <p className="art-heading">
              A space to pause.
              <br />A place to begin.
            </p>
            <p className="art-description">
              Simple by design.
              <br />
              Honest about every alert.
            </p>
            <div className="art-divider" />
            <p className="art-footnote">
              <Icon name="check" /> Built around the essentials
            </p>
          </div>
          <span className="art-caption">
            A companion, not a promise of protection.
          </span>
        </div>
      </section>
      <section className="principles" aria-labelledby="principles-heading">
        <div className="section-intro">
          <p className="eyebrow">THOUGHTFULLY SIMPLE</p>
          <h2 id="principles-heading">Start with the essentials.</h2>
        </div>
        <div className="principle-grid">
          <article className="principle">
            <span className="icon-tile">
              <Icon name="lock" />
            </span>
            <h3>Your trusted contacts</h3>
            <p>
              Save the people you trust in your account. You choose who can
              receive an alert; saving their number alone sends nothing.
            </p>
          </article>
          <article className="principle">
            <span className="icon-tile">
              <Icon name="shield" />
            </span>
            <h3>Clarity, not guesswork</h3>
            <p>
              Create an SOS and check its saved status. A simulation is labelled
              as a simulation. Provider acceptance is never called delivery.
            </p>
          </article>
          <article className="principle">
            <span className="icon-tile">
              <Icon name="phone" />
            </span>
            <h3>A direct way to call</h3>
            <p>
              The emergency call link stays at the top of every page. It opens
              your device’s dialer; it does not place a call automatically.
            </p>
          </article>
        </div>
      </section>
      <SimulationNotice />
    </div>
  );
}
