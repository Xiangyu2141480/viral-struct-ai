import './struct-migrate.css';
import App from './_struct/App';

export default function DemoPage() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, overflow: 'auto', background: 'var(--bg)' }}>
      <App />
    </div>
  );
}
