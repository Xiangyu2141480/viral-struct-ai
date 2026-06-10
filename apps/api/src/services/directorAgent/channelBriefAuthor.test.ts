import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorChannelBriefs, type AuthoringChannel, type SharedChannelIntent } from './channelBriefAuthor';

function makeIntent(): SharedChannelIntent {
  return {
    slotId: 'slot_x',
    role: 'usage_demo',
    productName: '康师傅冰红茶',
    category: 'beverage',
    sellingPoints: ['冰爽解腻'],
    transferableIntent: 'transfer assembly grammar into beverage-native motion',
    motionTokens: ['assembly_completion', 'flow_motion'],
    motifType: 'kinetic_assembly_reveal',
    fillStatus: 'needs_hyperframes_enhancement',
    referenceAssetIds: ['asset_003'],
    assetEvidence: ['手旋开瓶盖', '把茶倒入杯中'],
    durationSec: 4
  };
}

// Mock client: routes each per-channel call to a canned JSON based on the system prompt.
function fakeClient(byChannel: Partial<Record<AuthoringChannel, string>>): unknown {
  return {
    chat: {
      completions: {
        create: async (req: { messages: Array<{ content: string }> }) => {
          const sys = req.messages[0]?.content ?? '';
          const channel: AuthoringChannel = sys.includes('补拍')
            ? 'reshoot'
            : sys.includes('HyperFrames')
              ? 'hyperframes'
              : 'aigc';
          return { choices: [{ message: { content: byChannel[channel] ?? '{}' } }] };
        }
      }
    }
  };
}

const opts = (client: unknown, channels: AuthoringChannel[]) => ({
  intent: makeIntent(),
  channels,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientFactory: () => client as any,
  model: 'fake-model'
});

test('reshoot: a filmable brief is accepted', async () => {
  const client = fakeClient({
    reshoot: JSON.stringify({
      title: '开盖倒茶',
      guidanceNL: '一只手旋开瓶盖，把茶倒入玻璃杯，再喝一口，全程只露手部，自然真实',
      framing: '竖屏近景，产品居中',
      mustCapture: ['开盖', '倒入杯中'],
      avoid: ['其它品牌']
    })
  });
  const res = await authorChannelBriefs(opts(client, ['reshoot']));
  assert.ok(res.reshoot, 'reshoot should be authored');
  assert.match(res.reshoot.guidanceNL, /倒入玻璃杯/);
});

test('reshoot: a surreal brief is rejected and falls back (omitted)', async () => {
  const client = fakeClient({
    reshoot: JSON.stringify({
      title: '冰爽级联',
      guidanceNL: '冰块和柠檬片从画面四周凭空级联汇聚到产品周围，随后冷雾爆发',
      framing: '竖屏',
      mustCapture: ['冰块级联汇聚'],
      avoid: []
    })
  });
  const res = await authorChannelBriefs(opts(client, ['reshoot']));
  assert.equal(res.reshoot, undefined, 'surreal reshoot must be dropped');
  assert.ok(res.warnings.some((w) => w.includes('reshoot')));
});

test('hyperframes: an edit-only brief is accepted', async () => {
  const client = fakeClient({
    hyperframes: JSON.stringify({
      title: '剪辑增强',
      editingGuidanceNL: '把 asset_003 推近到开盖动作，0.0-1.5s 卡点，1.5s 落下卖点卡，尾帧定格标签',
      cardType: 'benefit_card',
      copy: { headline: '冰爽解腻' }
    })
  });
  const res = await authorChannelBriefs(opts(client, ['hyperframes']));
  assert.ok(res.hyperframes, 'hyperframes should be authored');
  assert.match(res.hyperframes.editingGuidanceNL, /卖点卡/);
});

test('hyperframes: a brief that describes new VFX/generation is rejected', async () => {
  const client = fakeClient({
    hyperframes: JSON.stringify({
      title: '冰雾特效',
      editingGuidanceNL: '让冰块飞入画面并爆发出冷雾，配料级联汇聚到产品',
      cardType: 'fx_card'
    })
  });
  const res = await authorChannelBriefs(opts(client, ['hyperframes']));
  assert.equal(res.hyperframes, undefined, 'generation-style hyperframes must be dropped');
});

test('aigc: surreal transfer is allowed', async () => {
  const client = fakeClient({
    aigc: JSON.stringify({
      prompt: '竖屏9:16：冰块、柠檬片、红茶水滴级联汇聚到产品周围，冷雾爆发后收束到CTA尾帧',
      negativePrompt: '无文字，无其它品牌'
    })
  });
  const res = await authorChannelBriefs(opts(client, ['aigc']));
  assert.ok(res.aigc, 'aigc surreal prompt should be authored');
  assert.match(res.aigc.prompt, /级联汇聚/);
});

test('aigc: a source-product leak in the positive prompt is rejected', async () => {
  const client = fakeClient({
    aigc: JSON.stringify({
      prompt: '竖屏9:16：MacBook 笔记本展开变成饮料瓶',
      negativePrompt: ''
    })
  });
  const res = await authorChannelBriefs(opts(client, ['aigc']));
  assert.equal(res.aigc, undefined, 'source-leaking aigc must be dropped');
});

test('a thrown LLM error for one channel does not break the others', async () => {
  const client = {
    chat: {
      completions: {
        create: async (req: { messages: Array<{ content: string }> }) => {
          const sys = req.messages[0]?.content ?? '';
          if (sys.includes('补拍')) throw new Error('boom');
          return {
            choices: [{ message: { content: JSON.stringify({ prompt: '冰块级联汇聚', negativePrompt: '' }) } }]
          };
        }
      }
    }
  };
  const res = await authorChannelBriefs(opts(client, ['reshoot', 'aigc']));
  assert.equal(res.reshoot, undefined);
  assert.ok(res.aigc, 'other channels still author when one throws');
  assert.ok(res.warnings.some((w) => w.includes('reshoot')));
});

test('channel author system prompts carry no hardcoded beverage examples', async () => {
  const captured: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientFactory = () => ({
    chat: { completions: { create: async (req: any) => {
      captured.push(req.messages.map((m: any) => m.content).join('\n'));
      return { choices: [{ message: { content: JSON.stringify({ prompt: 'x', negativePrompt: 'y', guidanceNL: 'g', framing: 'f', editingGuidanceNL: 'e' }) } }] };
    } } }
  }) as any;
  const intent: any = {
    slotId: 's1', role: 'product_closeup', productName: '无线蓝牙耳机', category: '电子',
    sellingPoints: ['主动降噪'], motionTokens: [], fillStatus: 'partial_asset_support',
    referenceAssetIds: [], assetEvidence: [], durationSec: 3, targetEquivalentBeat: '展示产品'
  };
  await authorChannelBriefs({ intent, channels: ['aigc', 'reshoot', 'hyperframes'], clientFactory, model: 'm' });
  assert.doesNotMatch(captured.join('\n'), /冰块|柠檬|红茶|倒茶|开盖|瓶身|多瓶/);
});
