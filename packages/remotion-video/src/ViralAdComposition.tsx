import { AbsoluteFill, Sequence } from 'remotion';
import { TitleCard } from './components/TitleCard';
import { SellingPointCard } from './components/SellingPointCard';
import { ComparisonCard } from './components/ComparisonCard';
import { CTACard } from './components/CTACard';

export function ViralAdComposition() {
  return (
    <AbsoluteFill style={{ backgroundColor: '#0b1020', color: 'white', fontFamily: 'sans-serif' }}>
      <Sequence from={0} durationInFrames={60}>
        <TitleCard title="热到没胃口？" subtitle="冰爽解腻来得快" />
      </Sequence>
      <Sequence from={60} durationInFrames={120}>
        <SellingPointCard title="柠檬茶香" subtitle="冷藏后更清爽" />
      </Sequence>
      <Sequence from={180} durationInFrames={120}>
        <ComparisonCard left="普通饮料：甜腻没重点" right="冰红茶：冰爽又解腻" />
      </Sequence>
      <Sequence from={300} durationInFrames={150}>
        <CTACard title="想要冰爽解腻" cta="就来一瓶康师傅冰红茶" />
      </Sequence>
    </AbsoluteFill>
  );
}
