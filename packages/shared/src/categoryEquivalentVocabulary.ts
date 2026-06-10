import { z } from 'zod';
import { SourceSpecificTransferSubtypeSchema } from './orchestratedTimeline';

/** The structural roles the gap-resolution + reusable-pack layers express per product. */
export const VocabularyRoleKeySchema = z.enum([
  'opening_attention',
  'product_closeup',
  'usage_demo',
  'benefit_visual',
  'cta_visual',
  'social_proof',
  'transition'
]);
export type VocabularyRoleKey = z.infer<typeof VocabularyRoleKeySchema>;

export const SubtypeEquivalentSchema = z
  .object({ label: z.string().min(1), actions: z.array(z.string().min(1)).min(2) })
  .strict();
export type SubtypeEquivalent = z.infer<typeof SubtypeEquivalentSchema>;

export const RoleEquivalentSchema = z
  .object({
    label: z.string().min(1),
    reshootShot: z.string().min(1),
    mustCapture: z.array(z.string().min(1)).min(1),
    animationHints: z.array(z.string().min(1)).min(1),
    aigcScene: z.string().min(1)
  })
  .strict();
export type RoleEquivalent = z.infer<typeof RoleEquivalentSchema>;

export const CategoryEquivalentVocabularySchema = z
  .object({
    product: z.string().min(1),
    /** All 8 abstract-grammar subtypes -> product-native label + concrete actions (replaces PROFILES). */
    bySubtype: z.record(SourceSpecificTransferSubtypeSchema, SubtypeEquivalentSchema),
    /** All 7 structural roles -> product-native shot vocabulary (replaces gap-builder role templates). */
    byRole: z.record(VocabularyRoleKeySchema, RoleEquivalentSchema),
    /** Motion-grammar token -> product-native NL (replaces the beverage token map). */
    tokenActions: z.record(z.string(), z.string()),
    /** Connective phrasing for the compression beat NL (replaces hardcoded idioms). */
    connective: z.object({ afterUseResult: z.string().min(1), productHero: z.string().min(1) }).strict()
  })
  .strict();
export type CategoryEquivalentVocabulary = z.infer<typeof CategoryEquivalentVocabularySchema>;

/** Canonical anchor lists the translator must cover (kept here so the prompt + validator share one source). */
export const VOCAB_SUBTYPES = SourceSpecificTransferSubtypeSchema.options;
export const VOCAB_ROLES = VocabularyRoleKeySchema.options;
