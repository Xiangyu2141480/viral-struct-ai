import type { TransferSafeAcceptanceCriteria } from './types';

const HARD_REJECT_PATTERNS = [
  /背景杂乱/,
  /杂乱背景/,
  /产品被遮挡/,
  /遮挡/,
  /严重失焦/,
  /失焦/,
  /画面太暗/,
  /太暗/,
  /过暗/,
  /其它品牌/,
  /其他品牌/,
  /未授权品牌/,
  /未经证实/,
  /价格/,
  /促销/,
  /医疗/,
  /功效保证/,
  /保证治愈/,
  /安全风险/,
  /IP/,
  /版权/,
  /明星/,
  /公众人物/
];

export interface SplitRejectIfForTransferInput extends TransferSafeAcceptanceCriteria {
  slotText?: string;
  targetCategory?: string;
  /**
   * Source-product-specific terms derived from the SCANNED source structure graph (deriveSourceIdentityBanlist).
   * A rejectIf clause naming any of these is a source-identity leak, not a generic transfer-safe constraint.
   */
  sourceBannedTerms: readonly string[];
}

export interface SplitRejectIfForTransferResult {
  hardRejectIf: string[];
  sourceSpecificRejectIf: string[];
}

export function splitRejectIfForTransfer(args: SplitRejectIfForTransferInput): SplitRejectIfForTransferResult {
  const hard = new Set<string>(args.hardRejectIf ?? []);
  const sourceSpecific = new Set<string>(args.sourceSpecificRejectIf ?? []);

  for (const item of args.rejectIf ?? []) {
    if (isSourceSpecificReject(item, args.sourceBannedTerms, args.slotText)) {
      sourceSpecific.add(item);
      continue;
    }
    if (isHardReject(item)) {
      hard.add(item);
      continue;
    }
    hard.add(item);
  }

  for (const item of [...hard]) {
    if (isSourceSpecificReject(item, args.sourceBannedTerms, args.slotText)) {
      hard.delete(item);
      sourceSpecific.add(item);
    }
  }

  return {
    hardRejectIf: [...hard],
    sourceSpecificRejectIf: [...sourceSpecific]
  };
}

export function isSourceSpecificReject(text: string, sourceBannedTerms: readonly string[], slotText = ''): boolean {
  if (sourceBannedTerms.length === 0) return false;
  const combined = `${text}\n${slotText}`.toLowerCase();
  return sourceBannedTerms.some((term) => term && combined.includes(term.toLowerCase()));
}

export function isHardReject(text: string): boolean {
  return HARD_REJECT_PATTERNS.some((pattern) => pattern.test(text));
}
