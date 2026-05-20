export function SellingPointCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 80 }}>
      <div style={{ border: '8px solid white', borderRadius: 40, padding: 60, textAlign: 'center' }}>
        <h2 style={{ fontSize: 84 }}>{title}</h2>
        <p style={{ fontSize: 42 }}>{subtitle}</p>
      </div>
    </div>
  );
}
