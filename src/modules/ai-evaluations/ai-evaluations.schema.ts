import { z } from 'zod';
import { AiVerdict } from '@prisma/client';

/**
 * AI evaluation module — request validation + LLM output validation.
 * The JSON schema sent to Anthropic (structured outputs) carries no numeric
 * range constraints (unsupported there); ranges are enforced by Zod post-parse.
 */

export const ApplicationIdParamSchema = z.object({ id: z.string().cuid() });

/** Validates the parsed structured-output payload returned by the model. */
export const AiResultSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    verdict: z.nativeEnum(AiVerdict),
    strengths: z.array(z.string().min(1)).min(1).max(8),
    gaps: z.array(z.string().min(1)).max(8),
    reasoning: z.string().min(1),
  })
  .strict();

export type AiResult = z.infer<typeof AiResultSchema>;

/** Schema sent to Anthropic via output_config.format (structured outputs). */
export const AI_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', description: 'Score global de correspondance, 0 à 100' },
    verdict: {
      type: 'string',
      enum: ['STRONG_MATCH', 'GOOD_MATCH', 'PARTIAL_MATCH', 'WEAK_MATCH'],
    },
    strengths: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string' },
  },
  required: ['score', 'verdict', 'strengths', 'gaps', 'reasoning'],
  additionalProperties: false,
} as const;

/** Response DTO — what the API returns (no internal fields, no storage keys). */
export interface AiEvaluationDto {
  id: string;
  applicationId: string;
  score: number;
  verdict: AiVerdict;
  strengths: string[];
  gaps: string[];
  reasoning: string;
  cvUsed: boolean;
  model: string;
  promptVersion: string;
  tokensInput: number | null;
  tokensOutput: number | null;
  createdAt: Date;
  createdBy: { id: string; firstName: string; lastName: string };
}

export interface AiStatusDto {
  configured: boolean;
}
