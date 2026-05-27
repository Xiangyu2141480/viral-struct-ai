import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ViralStructureGraph } from '@viral-struct/shared';
import { ViralStructureGraphSchema } from '@viral-struct/shared';
import { getAnalysisDir } from './videoPaths';

export interface StructureGraphArtifact {
  graph: ViralStructureGraph;
  artifactPath: string;
  videoId: string;
}

export async function loadStructureGraphArtifact(videoId: string | undefined): Promise<StructureGraphArtifact | null> {
  const analysisId = normalizeVideoId(videoId);
  if (!analysisId) {
    return null;
  }

  const artifactPath = path.join(getAnalysisDir(), analysisId, 'structure_graph.json');
  try {
    await access(artifactPath);
    const raw = await readFile(artifactPath, 'utf-8');
    const graph = ViralStructureGraphSchema.parse(JSON.parse(raw));
    return { graph, artifactPath, videoId: analysisId };
  } catch {
    return null;
  }
}

function normalizeVideoId(videoId: string | undefined): string | null {
  if (!videoId) {
    return null;
  }

  const base = path.basename(videoId.trim());
  if (!base || base === '.' || base === '..') {
    return null;
  }

  const ext = path.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}
