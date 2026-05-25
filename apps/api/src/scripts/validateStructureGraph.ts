/**
 * Standalone validator: parse a JSON file against ViralStructureGraphSchema.
 *
 * Usage:
 *   pnpm --filter @viral-struct/api exec tsx src/scripts/validateStructureGraph.ts <path>
 *   (defaults to seed_assets/analysis/macbook_neo/structure_graph.json)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ViralStructureGraphSchema } from '@viral-struct/shared';

const arg = process.argv[2] ?? 'seed_assets/analysis/macbook_neo/structure_graph.json';
const repoRoot = resolve(import.meta.dirname, '../../../..');
const path = resolve(repoRoot, arg);

const raw = JSON.parse(readFileSync(path, 'utf8'));
const result = ViralStructureGraphSchema.safeParse(raw);

if (!result.success) {
  console.error(`FAIL: ${path}`);
  console.error(JSON.stringify(result.error.issues, null, 2));
  process.exit(1);
}

const g = result.data;
console.log(`OK: ${path}`);
console.log(`  duration: ${g.meta.duration}s  videoType: ${g.meta.videoType}  style: ${g.meta.style}`);
console.log(`  segments: ${g.segments.length}`);
console.log(`  shotSlots: ${g.shotSlots.length}`);
console.log(`  creativeIngredients: ${g.creativeIngredients.length}`);
console.log(`  edges: ${g.edges.length}`);
console.log(`  segment roles: ${g.segments.map((s) => s.role).join(' -> ')}`);
