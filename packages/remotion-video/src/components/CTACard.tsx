export function CTACard({ title, cta }: { title: string; cta: string }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', textAlign: 'center', padding: 80 }}>
      <div>
        <h2 style={{ fontSize: 72 }}>{title}</h2>
        <p style={{ fontSize: 96, fontWeight: 900 }}>{cta}</p>
      </div>
    </div>
  );
}
