'use client';

import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '../lib/animation';

export function AnimatedScore({
  value,
  decimals = 2
}: {
  value: number;
  decimals?: number;
}) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const target = Number.isFinite(value) ? value : 0;
    if (prefersReducedMotion()) {
      setDisplayValue(target);
      return undefined;
    }

    const counter = { value: 0 };
    let cancelled = false;
    let tween: { kill: () => void } | undefined;

    void import('gsap')
      .then(({ gsap }) => {
        if (cancelled) return;
        tween = gsap.to(counter, {
          value: target,
          duration: 0.72,
          ease: 'power2.out',
          onUpdate: () => setDisplayValue(counter.value),
          onComplete: () => setDisplayValue(target)
        });
      })
      .catch(() => {
        setDisplayValue(target);
      });

    return () => {
      cancelled = true;
      tween?.kill();
    };
  }, [value]);

  return <span>{displayValue.toFixed(decimals)}</span>;
}
