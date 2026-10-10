export default function Loading() {
  return (
    <div className="container state-page" role="status" aria-live="polite">
      <span className="loading-orbit" aria-hidden="true" />
      <p className="eyebrow">A MOMENT, PLEASE</p>
      <h1>Getting things ready.</h1>
      <p>Loading your page. The emergency call link remains available above.</p>
    </div>
  );
}
