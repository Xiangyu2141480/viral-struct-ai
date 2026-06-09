import type { TransferSafeAcceptanceCriteria } from './types';

const SOURCE_SPECIFIC_REJECT_PATTERNS = [
  /macbook/i,
  /apple/i,
  /laptop/i,
  /keyboard/i,
  /trackpad/i,
  /touchpad/i,
  /screen/i,
  /port/i,
  /camera/i,
  /hinge/i,
  /chassis/i,
  /hardware/i,
  /rocket/i,
  /purchase\s*window/i,
  /笔记本/,
  /键盘/,
  /触控板/,
  /屏幕/,
  /接口/,
  /摄像头/,
  /机身/,
  /硬件/,
  /火箭/,
  /购买窗口/,
  /开合结构/,
  /固定无开合/,
  /无开合结构/
];

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
}

export interface SplitRejectIfForTransferResult {
  hardRejectIf: string[];
  sourceSpecificRejectIf: string[];
}

export function splitRejectIfForTransfer(args: SplitRejectIfForTransferInput): SplitRejectIfForTransferResult {
  const hard = new Set<string>(args.hardRejectIf ?? []);
  const sourceSpecific = new Set<string>(args.sourceSpecificRejectIf ?? []);

  for (const item of args.rejectIf ?? []) {
    if (isSourceSpecificReject(item, args.slotText)) {
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
    if (isSourceSpecificReject(item, args.slotText)) {
      hard.delete(item);
      sourceSpecific.add(item);
    }
  }

  return {
    hardRejectIf: [...hard],
    sourceSpecificRejectIf: [...sourceSpecific]
  };
}

export function isSourceSpecificReject(text: string, slotText = ''): boolean {
  const combined = `${text}\n${slotText}`;
  return SOURCE_SPECIFIC_REJECT_PATTERNS.some((pattern) => pattern.test(combined));
}

export function isHardReject(text: string): boolean {
  return HARD_REJECT_PATTERNS.some((pattern) => pattern.test(text));
}
