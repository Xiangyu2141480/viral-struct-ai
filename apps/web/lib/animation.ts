export const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

type MatchMediaLike = {
  matchMedia(query: string): Pick<MediaQueryList, 'matches'>;
};

type MotionQuery = Pick<MediaQueryList, 'matches'> | null | undefined;

export interface AnimationPlan {
  from: Record<string, string | number>;
  to: Record<string, string | number | boolean>;
}

export function shouldReduceMotion(query: MotionQuery): boolean {
  return Boolean(query?.matches);
}

export function prefersReducedMotion(target?: MatchMediaLike): boolean {
  const source = target ?? (typeof window !== 'undefined' ? window : undefined);
  if (!source?.matchMedia) return false;

  try {
    return shouldReduceMotion(source.matchMedia(reducedMotionQuery));
  } catch {
    return false;
  }
}

export function buildRevealAnimationPlan(index = 0): AnimationPlan {
  return {
    from: {
      opacity: 0,
      y: 10
    },
    to: {
      opacity: 1,
      y: 0,
      duration: 0.42,
      delay: Math.min(index * 0.035, 0.18),
      ease: 'power2.out'
    }
  };
}

export function buildHighlightAnimationPlan(): AnimationPlan {
  return {
    from: {
      backgroundColor: 'rgba(251, 191, 36, 0.18)',
      boxShadow: '0 0 0 1px rgba(251, 191, 36, 0.42)'
    },
    to: {
      backgroundColor: 'rgba(251, 191, 36, 0.04)',
      boxShadow: '0 0 0 0 rgba(251, 191, 36, 0)',
      duration: 0.28,
      repeat: 1,
      yoyo: true,
      ease: 'power1.out'
    }
  };
}

export function buildPulseAnimationPlan(): AnimationPlan {
  return {
    from: {
      scale: 1
    },
    to: {
      scale: 1.015,
      duration: 0.32,
      repeat: 1,
      yoyo: true,
      ease: 'power1.out'
    }
  };
}
