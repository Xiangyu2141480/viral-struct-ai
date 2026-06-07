import './_struct/struct-migrate.css';
import App from './_struct/App';

// Root route now renders the StructMigrate UI directly (promoted from /demo).
// The legacy ScoreMap landing + workflow pages were removed; /demo redirects here.
export default function HomePage() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, overflow: 'auto', background: 'var(--bg)' }}>
      <App />
    </div>
  );
}
