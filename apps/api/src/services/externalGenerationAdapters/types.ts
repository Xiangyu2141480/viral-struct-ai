import type {
  GenerationProvider,
  MissingMaterialGenerationJob,
  MissingMaterialGenerationMode
} from '@viral-struct/shared';

export interface ExternalGenerationProviderDescriptor {
  provider: GenerationProvider;
  providerLabel: string;
  supportedModes: MissingMaterialGenerationMode[];
  submitsExternally: boolean;
}

export interface ExternalGenerationPlanAdapter {
  descriptor: ExternalGenerationProviderDescriptor;
  annotateJob(job: MissingMaterialGenerationJob): MissingMaterialGenerationJob;
}
