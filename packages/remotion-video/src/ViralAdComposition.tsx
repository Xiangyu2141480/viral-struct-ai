import { AbsoluteFill, Sequence } from 'remotion';
import { TitleCard } from './components/TitleCard';
import { SellingPointCard } from './components/SellingPointCard';
import { ComparisonCard } from './components/ComparisonCard';
import { CTACard } from './components/CTACard';

export function ViralAdComposition() {
  return (
    <AbsoluteFill style={{ backgroundColor: '#0b1020', color: 'white', fontFamily: 'sans-serif' }}>
      <Sequence from={0} durationInFrames={60}>
        <TitleCard title="咖啡凉太快？" subtitle="通勤党别再将就" />
      </Sequence>
      <Sequence from={60} durationInFrames={120}>
        <SellingPointCard title="保温 8 小时" subtitle="早上到下午都能喝热咖啡" />
      </Sequence>
      <Sequence from={180} durationInFrames={120}>
        <ComparisonCard left="普通杯：易漏易凉" right="便携杯：倒置不漏" />
      </Sequence>
      <Sequence from={300} durationInFrames={150}>
        <CTACard title="通勤党想喝热咖啡" cta="就选它" />
      </Sequence>
    </AbsoluteFill>
  );
}
