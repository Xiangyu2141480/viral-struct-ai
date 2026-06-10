// scanRepository.ts — persistence for SCAN RESULTS (the case-video structure).
//
// Previously a scan's SourceVideo + ViralStructureGraph lived only in the in-memory
// scanJobs/scanArtifacts maps and were evicted after ~60min (lost on restart). This
// repository persists each completed scan so the structure can be re-read, re-opened
// for fine scan, fed to the director, or listed later — the "案例视频结构" store.

import type { ViralStructureGraph } from '@viral-struct/shared';
import type { SourceVideo } from '../structAdapter/structTypes';
import { createCollection, newId, type DbRecord } from './jsonStore';

export type ScanSource = 'rough_scan' | 'sample_analyze' | 'import';

export interface ScanRecord extends DbRecord {
  id: string;
  /** Filesystem-safe video id used by the scan (upload filename / seed id). */
  videoId: string;
  title: string;
  createdAt: string;
  durationSec: number;
  segmentCount: number;
  source: ScanSource;
  /** The UI-model structure consumed by Screen 01 (graphToSourceVideo output). */
  sourceVideo: SourceVideo;
  /** The rich shared-protocol graph when available (rough scan path), for re-feeding the director. */
  structureGraph?: ViralStructureGraph;
  /** Retained input paths (when still on disk) so the structure can be fine-scanned again. */
  videoPath?: string;
  roughScanPath?: string;
}

/** Lightweight projection for list views. */
export interface ScanSummary {
  id: string;
  videoId: string;
  title: string;
  createdAt: string;
  durationSec: number;
  segmentCount: number;
  source: ScanSource;
}

const collection = createCollection<ScanRecord>('scans');

export async function saveScan(input: {
  videoId: string;
  title: string;
  sourceVideo: SourceVideo;
  source: ScanSource;
  structureGraph?: ViralStructureGraph;
  videoPath?: string;
  roughScanPath?: string;
}): Promise<ScanRecord> {
  const record: ScanRecord = {
    id: newId('scan_'),
    videoId: input.videoId,
    title: input.title,
    createdAt: new Date().toISOString(),
    durationSec: input.sourceVideo.duration,
    segmentCount: input.sourceVideo.segments.length,
    source: input.source,
    sourceVideo: input.sourceVideo,
    ...(input.structureGraph ? { structureGraph: input.structureGraph } : {}),
    ...(input.videoPath ? { videoPath: input.videoPath } : {}),
    ...(input.roughScanPath ? { roughScanPath: input.roughScanPath } : {}),
  };
  return collection.put(record);
}

export async function getScan(id: string): Promise<ScanRecord | null> {
  return collection.get(id);
}

export async function listScans(): Promise<ScanSummary[]> {
  const records = await collection.list();
  return records.map((r) => ({
    id: r.id,
    videoId: r.videoId,
    title: r.title,
    createdAt: r.createdAt,
    durationSec: r.durationSec,
    segmentCount: r.segmentCount,
    source: r.source,
  }));
}

export async function deleteScan(id: string): Promise<boolean> {
  return collection.remove(id);
}
