import { z } from "zod";

// Keep generation validation separate from the display/storage item limit.
export const explanationResponseSchema = z.object({
  summary: z.string().min(1).max(1500),
  evidence: z.array(z.string().min(1).max(500)),
  unknowns: z.array(z.string().min(1).max(500)),
});

export function normalizeExplanation(value: unknown) {
  const parsed = explanationResponseSchema.parse(value);
  return {
    ...parsed,
    evidence: parsed.evidence.slice(0, 8),
    unknowns: parsed.unknowns.slice(0, 8),
  };
}
