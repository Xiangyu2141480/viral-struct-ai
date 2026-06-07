import type { MissingMaterialGenerationJob } from '@viral-struct/shared';
import type { ExternalGenerationPlanAdapter } from './types';

export const mockExternalGenerationAdapter: ExternalGenerationPlanAdapter = {
  descriptor: {
    provider: 'mock',
    providerLabel: 'Dry-run adapter / Seedance-ready spec',
    supportedModes: ['image_to_video', 'text_to_video'],
    submitsExternally: false
  },
  annotateJob(job: MissingMaterialGenerationJob): MissingMaterialGenerationJob {
    return {
      ...job,
      provider: 'mock',
      providerLabel: this.descriptor.providerLabel,
      disclaimer: 'External generation plan, not current core output. No Seedance or external video model was called.'
    };
  }
};
