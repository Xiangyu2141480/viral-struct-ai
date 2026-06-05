import type { GeneratedVisualAsset, SafetyStatus, StoryboardFrameType } from '@viral-struct/shared';

const palette: Record<StoryboardFrameType, { bg: string; accent: string; label: string }> = {
  opening_hook: { bg: '#fff7ed', accent: '#f97316', label: 'Opening Hook' },
  product_closeup: { bg: '#eff6ff', accent: '#2563eb', label: 'Product Closeup' },
  benefit_usage: { bg: '#ecfdf5', accent: '#059669', label: 'Benefit / Usage' },
  gap_repair: { bg: '#fef2f2', accent: '#dc2626', label: 'Gap Repair' },
  cta_cover: { bg: '#f5f3ff', accent: '#7c3aed', label: 'CTA / Cover' }
};

export function renderStoryboardPlaceholder(input: {
  id: string;
  promptId: string;
  frameType: StoryboardFrameType;
  productName: string;
  title: string;
  summary: string;
  safetyStatus: SafetyStatus;
}): GeneratedVisualAsset {
  const colors = palette[input.frameType];
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1280" role="img" aria-label="${escapeXml(input.title)}">`,
    `<rect width="720" height="1280" fill="${colors.bg}"/>`,
    `<rect x="48" y="48" width="624" height="1184" rx="28" fill="#ffffff" stroke="${colors.accent}" stroke-width="8"/>`,
    `<circle cx="586" cy="170" r="58" fill="${colors.accent}" opacity="0.16"/>`,
    `<rect x="96" y="126" width="318" height="44" rx="22" fill="${colors.accent}" opacity="0.16"/>`,
    `<text x="116" y="157" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="${colors.accent}">${escapeXml(colors.label)}</text>`,
    `<text x="96" y="280" font-family="Arial, sans-serif" font-size="56" font-weight="800" fill="#111827">${escapeXml(input.productName)}</text>`,
    `<foreignObject x="96" y="340" width="528" height="360">`,
    `<div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,sans-serif;font-size:38px;line-height:1.25;font-weight:760;color:#111827;">${escapeHtml(input.title)}</div>`,
    `</foreignObject>`,
    `<rect x="96" y="740" width="528" height="210" rx="24" fill="${colors.accent}" opacity="0.10"/>`,
    `<foreignObject x="126" y="770" width="468" height="160">`,
    `<div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,sans-serif;font-size:28px;line-height:1.28;color:#374151;">${escapeHtml(input.summary)}</div>`,
    `</foreignObject>`,
    `<rect x="96" y="1040" width="528" height="78" rx="20" fill="${colors.accent}"/>`,
    `<text x="126" y="1090" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#ffffff">Prompt-ready storyboard draft</text>`,
    `<text x="96" y="1168" font-family="Arial, sans-serif" font-size="22" fill="#6b7280">Placeholder SVG · Safety: ${escapeXml(input.safetyStatus.status)}</text>`,
    `</svg>`
  ].join('');

  return {
    id: `${input.id}_placeholder`,
    type: 'placeholder_svg',
    url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    mimeType: 'image/svg+xml',
    generationSource: 'placeholder',
    promptId: input.promptId,
    label: 'Prompt-ready storyboard draft'
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeHtml(value: string): string {
  return escapeXml(value).replaceAll('\n', '<br/>');
}
