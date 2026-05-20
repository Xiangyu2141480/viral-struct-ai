export function TitleCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', textAlign: 'center', padding: 80 }}>
      <div>
        <h1 style={{ fontSize: 96, margin: 0 }}>{title}</h1>
        <p style={{ fontSize: 42 }}>{subtitle}</p>
      </div>
    </div>
  );
}
