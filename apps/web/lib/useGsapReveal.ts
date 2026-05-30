'use client';

import { useEffect, useRef } from 'react';
import {
  buildHighlightAnimationPlan,
  buildPulseAnimationPlan,
  buildRevealAnimationPlan,
  prefersReducedMotion
} from './animation';

type RevealMode = 'reveal' | 'highlight' | 'pulse';

interface UseGsapRevealOptions {
  selector?: string;
  mode?: RevealMode;
  dependencyKey?: string | number | null;
  disabled?: boolean;
  stagger?: boolean;
}

export function useGsapReveal<T extends HTMLElement>({
  selector,
  mode = 'reveal',
  dependencyKey,
  disabled = false,
  stagger = true
}: UseGsapRevealOptions = {}) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || disabled || prefersReducedMotion()) {
      return undefined;
    }

    let cancelled = false;
    let context: { revert: () => void } | undefined;

    void import('gsap')
      .then(({ gsap }) => {
        if (cancelled || !root.isConnected) return;

        context = gsap.context(() => {
          const targets = selector
            ? Array.from(root.querySelectorAll<HTMLElement>(selector))
            : [root];

          if (!targets.length) return;

          if (mode === 'highlight') {
            const plan = buildHighlightAnimationPlan();
            gsap.fromTo(targets, plan.from, plan.to);
            return;
          }

          if (mode === 'pulse') {
            const plan = buildPulseAnimationPlan();
            gsap.fromTo(targets, plan.from, plan.to);
            return;
          }

          targets.forEach((target, index) => {
            const plan = buildRevealAnimationPlan(stagger ? index : 0);
            gsap.fromTo(target, plan.from, plan.to);
          });
        }, root);
      })
      .catch(() => {
        // Animation is presentation-only. Rendering must remain usable if GSAP fails to load.
      });

    return () => {
      cancelled = true;
      context?.revert();
    };
  }, [dependencyKey, disabled, mode, selector, stagger]);

  return ref;
}
