import type { VideoAnalysis } from '@viral-struct/shared';

export async function analyzeVideoMock(
  videoId: string,
  manualTranscript?: string
): Promise<VideoAnalysis> {
  const transcriptText =
    manualTranscript ||
    '你还在这样选杯子吗？普通杯不保温还容易漏。这款便携咖啡杯保温八小时，单手开盖，倒置不漏，通勤党放心带。';

  return {
    metadata: {
      videoId,
      duration: 15,
      fps: 30,
      width: 1080,
      height: 1920,
      aspectRatio: '9:16'
    },
    shots: [
      { id: 'shot_1', start: 0, end: 2, description: '快速吸引注意的开头镜头' },
      { id: 'shot_2', start: 2, end: 4, description: '痛点展示' },
      { id: 'shot_3', start: 4, end: 8, description: '商品特写与卖点展示' },
      { id: 'shot_4', start: 8, end: 12, description: '对比或证明' },
      { id: 'shot_5', start: 12, end: 15, description: 'CTA 结尾' }
    ],
    keyframes: [
      { time: 1, url: '/mock/frame_1.jpg', description: '大标题 + 产品推近' },
      { time: 3, url: '/mock/frame_2.jpg', description: '痛点字幕' },
      { time: 6, url: '/mock/frame_3.jpg', description: '卖点卡片' },
      { time: 10, url: '/mock/frame_4.jpg', description: '对比卡片' },
      { time: 14, url: '/mock/frame_5.jpg', description: 'CTA 卡片' }
    ],
    transcript: [
      { start: 0, end: 2, text: transcriptText.slice(0, 12) },
      { start: 2, end: 4, text: '普通杯不保温还容易漏' },
      { start: 4, end: 8, text: '这款便携咖啡杯保温八小时' },
      { start: 8, end: 12, text: '单手开盖，倒置不漏' },
      { start: 12, end: 15, text: '通勤党放心带' }
    ]
  };
}
