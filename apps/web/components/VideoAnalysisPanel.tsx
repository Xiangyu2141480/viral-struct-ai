'use client';

import { useEffect, useMemo, useState } from 'react';
import type { VideoAnalysis } from '@viral-struct/shared';
import { apiGet, apiPost, apiPostForm, mediaUrl } from '../lib/api';
import { useWorkflowStore } from '../lib/workflowStore';

interface SeedVideo {
  filename: string;
  displayName: string;
  sizeBytes: number;
}

interface SeedVideoResponse {
  videos: SeedVideo[];
}

interface UploadResponse {
  videoId: string;
  originalName: string;
  path: string;
}

type AnalyzeMode = 'seed' | 'upload';

export function VideoAnalysisPanel() {
  const analysis = useWorkflowStore((state) => state.videoAnalysis);
  const setVideoAnalysis = useWorkflowStore((state) => state.setVideoAnalysis);
  const resetWorkflow = useWorkflowStore((state) => state.resetWorkflow);
  const [mode, setMode] = useState<AnalyzeMode>('seed');
  const [seeds, setSeeds] = useState<SeedVideo[]>([]);
  const [selectedSeed, setSelectedSeed] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [manualTranscript, setManualTranscript] = useState('');
  const [loadingSeeds, setLoadingSeeds] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    apiGet<SeedVideoResponse>('/api/videos/seeds')
      .then((res) => {
        if (!mounted) {
          return;
        }

        setSeeds(res.videos);
        setSelectedSeed((current) => current || res.videos[0]?.filename || '');
      })
      .catch((err: unknown) => {
        if (mounted) {
          setError(errorMessage(err));
        }
      })
      .finally(() => {
        if (mounted) {
          setLoadingSeeds(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const canAnalyze = useMemo(() => {
    if (analyzing) {
      return false;
    }

    return mode === 'seed' ? Boolean(selectedSeed) : Boolean(file);
  }, [analyzing, file, mode, selectedSeed]);

  async function handleAnalyze() {
    setAnalyzing(true);
    setError(null);

    try {
      if (mode === 'seed') {
        const result = await apiPost<VideoAnalysis>('/api/videos/seeds/analyze', {
          filename: selectedSeed,
          manualTranscript
        });
        setVideoAnalysis(result);
        return;
      }

      if (!file) {
        throw new Error('请选择一个本地视频文件。');
      }

      const form = new FormData();
      form.append('video', file);
      const upload = await apiPostForm<UploadResponse>('/api/videos/upload', form);
      const result = await apiPost<VideoAnalysis>(`/api/videos/${upload.videoId}/analyze`, {
        manualTranscript
      });
      setVideoAnalysis(result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <section className="card">
      <h1>步骤 1：样例视频输入与解析</h1>
      <p>选择 seed video 或上传样例视频，系统会读取真实元信息、抽取封面和关键帧，并保留手动字幕 fallback。</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <div className="card">
          <h3>输入样例视频</h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button type="button" onClick={() => setMode('seed')} disabled={mode === 'seed'}>
              Seed 视频
            </button>
            <button type="button" onClick={() => setMode('upload')} disabled={mode === 'upload'}>
              上传视频
            </button>
          </div>

          {mode === 'seed' ? (
            <label style={{ display: 'grid', gap: 6 }}>
              <span>选择 seed video</span>
              <select
                value={selectedSeed}
                onChange={(event) => setSelectedSeed(event.target.value)}
                disabled={loadingSeeds || seeds.length === 0}
              >
                {seeds.map((seed) => (
                  <option key={seed.filename} value={seed.filename}>
                    {seed.displayName} ({formatBytes(seed.sizeBytes)})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label style={{ display: 'grid', gap: 6 }}>
              <span>上传样例视频</span>
              <input type="file" accept="video/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </label>
          )}

          <label style={{ display: 'grid', gap: 6, marginTop: 12 }}>
            <span>手动字幕 fallback</span>
            <textarea
              value={manualTranscript}
              onChange={(event) => setManualTranscript(event.target.value)}
              placeholder="ASR 未接入时可粘贴字幕；系统会按句子或换行切分时间段"
              style={{ width: '100%', minHeight: 120 }}
            />
          </label>

          <button type="button" onClick={handleAnalyze} disabled={!canAnalyze} style={{ marginTop: 12 }}>
            {analyzing ? '解析中...' : '开始真实解析'}
          </button>
          <button type="button" onClick={resetWorkflow} disabled={analyzing} style={{ marginTop: 12, marginLeft: 8 }}>
            重置流程
          </button>

          {error ? <p style={{ color: '#fca5a5' }}>{error}</p> : null}
        </div>

        <div className="card">
          <h3>解析结果</h3>
          {analysis ? <AnalysisSummary analysis={analysis} /> : <p>尚未解析。选择一个样例视频后开始分析。</p>}
        </div>
      </div>

      {analysis ? (
        <div style={{ marginTop: 16 }}>
          <FrameGrid analysis={analysis} />
          <ShotList analysis={analysis} />
          <TranscriptList analysis={analysis} />
          <p>
            <a href="/graph">查看结构图谱 →</a>
          </p>
        </div>
      ) : null}
    </section>
  );
}

function AnalysisSummary({ analysis }: { analysis: VideoAnalysis }) {
  const { metadata } = analysis;
  const sourceLabel = analysis.analysisSource === 'real_ffmpeg' ? '真实 FFmpeg 解析' : 'Mock fallback';

  return (
    <div>
      <p>
        <strong>来源：</strong>
        {sourceLabel}
      </p>
      <ul>
        <li>视频 ID：{metadata.videoId}</li>
        <li>时长：{formatSeconds(metadata.duration)}</li>
        <li>FPS：{metadata.fps}</li>
        <li>
          分辨率：{metadata.width} × {metadata.height}
        </li>
        <li>比例：{metadata.aspectRatio}</li>
        <li>镜头草案：{analysis.shots.length} 段</li>
        <li>关键帧：{analysis.keyframes.length} 张</li>
        <li>字幕段落：{analysis.transcript.length} 段</li>
      </ul>
      {analysis.warnings?.length ? (
        <div style={{ color: '#fde68a' }}>
          {analysis.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FrameGrid({ analysis }: { analysis: VideoAnalysis }) {
  const frameAspectRatio = `${analysis.metadata.width} / ${analysis.metadata.height}`;

  return (
    <section className="card">
      <h3>真实关键帧</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        {analysis.keyframes.map((frame) => (
          <div key={`${frame.time}-${frame.url}`} style={{ display: 'grid', gap: 6 }}>
            {frame.url.startsWith('/mock') ? (
              <div style={{ border: '1px dashed rgba(255,255,255,0.3)', padding: 16 }}>Mock frame</div>
            ) : (
              <img
                src={mediaUrl(frame.url)}
                alt={frame.description ?? `frame at ${frame.time}s`}
                style={{
                  width: '100%',
                  aspectRatio: frameAspectRatio,
                  objectFit: 'contain',
                  borderRadius: 8,
                  background: 'rgba(15,23,42,0.8)'
                }}
              />
            )}
            <span>
              {formatSeconds(frame.time)} · {frame.description}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ShotList({ analysis }: { analysis: VideoAnalysis }) {
  return (
    <section className="card" style={{ marginTop: 16 }}>
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
    <section className="card" style={{ marginTop: 16 }}>
      <h3>字幕概览</h3>
      {analysis.transcript.length ? (
        <ol>
          {analysis.transcript.map((segment) => (
            <li key={`${segment.start}-${segment.end}-${segment.text}`}>
              {formatSeconds(segment.start)} - {formatSeconds(segment.end)}：{segment.text}
            </li>
          ))}
        </ol>
      ) : (
        <p>暂无字幕。可在上方粘贴手动字幕再重新解析。</p>
      )}
    </section>
  );
}

function formatSeconds(value: number): string {
  return `${Number(value.toFixed(2))}s`;
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)}KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
