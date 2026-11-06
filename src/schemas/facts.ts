import {z} from 'zod';

export const FactStatusSchema = z.enum(['verified', 'unverified', 'stale', 'refuted']);

export const FactSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]+$/),
  /** French sentence a script may rely on. */
  statement: z.string().min(10),
  /** e.g. "feature:funnels", "pricing", "plan:startup", "free-plan". */
  tags: z.array(z.string()).min(1),
  /** Key of the official page in data/facts/sources.json. */
  sourceId: z.string(),
  /** Verbatim excerpt that must be present in the stored snapshot of that page. */
  evidence: z.string().nullable(),
  status: FactStatusSchema,
  verifiedAt: z.string().nullable(),
  /** Days before the fact must be re-verified (prices: short). */
  ttlDays: z.number().int().min(1).max(90),
  notes: z.string().optional(),
});
export type Fact = z.infer<typeof FactSchema>;

export const FactsDbSchema = z.object({
  updatedAt: z.string().nullable(),
  facts: z.array(FactSchema),
});
export type FactsDb = z.infer<typeof FactsDbSchema>;

export const SourceSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  kind: z.enum(['pricing', 'features', 'help', 'legal', 'affiliate']),
  note: z.string().optional(),
  /** Pages whose content is drawn by JavaScript (prices) are read in a real browser. */
  render: z
    .object({
      waitMs: z.number().int().min(0).max(20000).default(3000),
      /** Click halfway between the first two visible matches (a switch drawn between its two labels). */
      clickBetween: z.string().optional(),
      /** Text that must be on the page once loaded (and clicked): proves the page is in the expected state. */
      expectText: z.string().optional(),
    })
    .optional(),
});

export const SourcesSchema = z.object({sources: z.array(SourceSchema).min(1)});
export type Source = z.infer<typeof SourceSchema>;

export const SnapshotMetaSchema = z.object({
  sourceId: z.string(),
  url: z.string(),
  finalUrl: z.string(),
  fetchedAt: z.string(),
  status: z.number(),
  sha256: z.string(),
  chars: z.number(),
  method: z.enum(['http', 'browser']).default('http'),
});
export type SnapshotMeta = z.infer<typeof SnapshotMetaSchema>;
