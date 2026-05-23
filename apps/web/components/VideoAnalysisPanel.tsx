'use client';

import { useState } from 'react';
import type { VideoAnalysis } from '@viral-struct/shared';
import { apiPost } from '../lib/api';
import { useWorkflowStore } from '../lib/workflowStore';

export function VideoAnalysisPanel() {
  const analysis = useWorkflowStore((state) => state.videoAnalysis);
  const setVideoAnalysis = useWorkflowStore((state) => state.setVideoAnalysis);
  const resetWorkflow = useWorkflowStore((state) => state.resetWorkflow);
  const [manualTranscript, setManualTranscript] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze() {
    setLoading(true);
    setError(null);

    try {
      const result = await apiPost<VideoAnalysis>('/api/videos/demo/analyze', {
        manualTranscript
      });
      setVideoAnalysis(result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card">
      <h1>步骤 1：样例视频输入与解析</h1>
      <p>先用 M1 mock analysis 建立流程：手动字幕会进入 VideoAnalysis，并在下一步被规则引擎抽成结构图谱。</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <div className="card">
          <h3>样例字幕 fallback</h3>
          <textarea
            value={manualTranscript}
            onChange={(event) => setManualTranscript(event.target.value)}
            placeholder="ASR 失败时可手动粘贴字幕；例如：你还在这样选杯子吗？普通杯不保温还容易漏..."
            style={{ width: '100%', minHeight: 140, marginTop: 12 }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button type="button" onClick={handleAnalyze} disabled={loading}>
              {loading ? '分析中...' : '生成 M1 VideoAnalysis'}
            </button>
            <button type="button" onClick={resetWorkflow} disabled={loading}>
              重置流程
            </button>
          </div>
          {error ? <p style={{ color: '#fca5a5' }}>{error}</p> : null}
        </div>

        <div className="card">
          <h3>{analysis ? 'M1 分析结果' : '默认 mock 分析预览'}</h3>
          {analysis ? <AnalysisSummary analysis={analysis} /> : <DefaultSummary />}
          <a href="/graph">查看结构图谱 →</a>
        </div>
      </div>

      {analysis ? (
        <div style={{ marginTop: 16, display: 'grid', gap: 16 }}>
          <ShotList analysis={analysis} />
          <TranscriptList analysis={analysis} />
        </div>
      ) : null}
    </section>
  );
}

function DefaultSummary() {
  return (
    <ul>
      <li>时长：15s</li>
      <li>比例：9:16</li>
      <li>镜头数：5</li>
      <li>结构：Hook → 痛点 → 卖点 → 对比 → CTA</li>
    </ul>
  );
}

function AnalysisSummary({ analysis }: { analysis: VideoAnalysis }) {
  return (
    <ul>
      <li>视频 ID：{analysis.metadata.videoId}</li>
      <li>时长：{formatSeconds(analysis.metadata.duration)}</li>
      <li>比例：{analysis.metadata.aspectRatio}</li>
      <li>分辨率：{analysis.metadata.width} × {analysis.metadata.height}</li>
      <li>镜头数：{analysis.shots.length}</li>
      <li>关键帧：{analysis.keyframes.length}</li>
      <li>字幕段：{analysis.transcript.length}</li>
    </ul>
  );
}

function ShotList({ analysis }: { analysis: VideoAnalysis }) {
  return (
    <section className="card">
      <h3>镜头草案</h3>
      <ol>
        {analysis.shots.map((shot) => (
          <li key={shot.id}>
            {formatSeconds(shot.start)} - {formatSeconds(shot.end)}：{shot.description}
          </li>
        ))}
      </ol>
    </section>
  );
}

function TranscriptList({ analysis }: { analysis: VideoAnalysis }) {
  return (
    <section className="card">
      <h3>字幕概览</h3>
      <ol>
        {analysis.transcript.map((segment) => (
          <li key={`${segment.start}-${segment.end}-${segment.text}`}>
            {formatSeconds(segment.start)} - {formatSeconds(segment.end)}：{segment.text}
          </li>
        ))}
      </ol>
    </section>
  );
}

function formatSeconds(value: number): string {
  return `${Number(value.toFixed(2))}s`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
