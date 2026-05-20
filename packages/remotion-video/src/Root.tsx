import { Composition } from 'remotion';
import { ViralAdComposition } from './ViralAdComposition';

export function RemotionRoot() {
  return (
    <Composition
      id="ViralAd"
      component={ViralAdComposition}
      durationInFrames={450}
      fps={30}
      width={1080}
      height={1920}
    />
  );
}
