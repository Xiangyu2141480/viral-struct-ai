import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContentBrief } from './structAdapter';
import type { SourceVideo, TargetProduct } from './structTypes';

const sourceVideo: SourceVideo = {
  id: 'source_001',
  title: '样例视频',
  platform: 'douyin',
  duration: 6,
  views: '0',
  likes: '0',
  finish_rate: 0,
  ctr: 0,
  cvr: 0,
  protocol_version: 'test',
  segments: [],
  transitions: [],
  rhythm: { avg_shot: 2, cuts: 3, hook_density: 'medium', bgm_bpm: 100, caption_density: 'medium' },
  packaging: { title_template: 'title', captions: 'captions', bgm: 'bgm', cover: 'cover' },
};

test('buildContentBrief prefers parsed product fields over legacy TargetProduct placeholders', () => {
  const product: TargetProduct = {
    name: '康师傅冰红茶',
    category: '柠檬味即饮红茶饮料',
    price: '',
    stock: 0,
    asset_count: 3,
    industry: '夏天通勤和爱聚餐的年轻人',
    description: '康师傅冰红茶，一款柠檬味即饮红茶饮料，适合饭后解腻和朋友聚会。',
    sellingPoints: ['冰爽解腻', '柠檬茶香', '大瓶分享', '冰镇更清爽'],
    cta: '现在就来一瓶',
    stylePreference: '高节奏、夏日清爽、真实质感',
  };

  const brief = buildContentBrief(product, sourceVideo);

  assert.equal(brief.productName, '康师傅冰红茶');
  assert.equal(brief.scenario, '柠檬味即饮红茶饮料');
  assert.deepEqual(brief.sellingPoints, ['冰爽解腻', '柠檬茶香', '大瓶分享', '冰镇更清爽']);
  assert.equal(brief.cta, '现在就来一瓶');
  assert.equal(brief.stylePreference, '高节奏、夏日清爽、真实质感');
});
