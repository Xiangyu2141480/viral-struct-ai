import { TimelineView } from '../../components/TimelineView';
import { QualityReportPanel } from '../../components/QualityReportPanel';

export default function ResultPage() {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <TimelineView />
      <QualityReportPanel />
    </div>
  );
}
