export function ComparisonCard({ left, right }: { left: string; right: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, height: '100%', padding: 80, alignItems: 'center' }}>
      <div style={{ border: '4px solid white', borderRadius: 32, padding: 40, fontSize: 48 }}>{left}</div>
      <div style={{ border: '4px solid white', borderRadius: 32, padding: 40, fontSize: 48 }}>{right}</div>
    </div>
  );
}
