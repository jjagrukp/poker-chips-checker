import { z } from 'zod';

// Chip-photo analysis contract v1 (spec 06 §4), shared by the endpoint (api/) and the client.
// AI output is untrusted: both sides parse it with this schema. Keep this file free of `@/`
// imports so the serverless bundle can import it by relative path.

export const PHOTO_SCHEMA_VERSION = 1;
export const MAX_PROPOSALS = 12;

/** Client limits (spec 06 §1). */
export const MAX_RAW_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 1.5 * 1024 * 1024;
export const MAX_EDGE_PX = 1600;
export const JPEG_QUALITY = 0.85;
/** Server limit (spec 06 §2): a little above the client's so honest uploads always fit. */
export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export const IMAGE_ISSUES = [
  'blurry',
  'dark',
  'glare',
  'overlapping_stacks',
  'partial',
  'other',
] as const;

const text = (max: number) => z.string().trim().max(max);

export const ChipProposalSchema = z.object({
  proposalId: text(40).min(1),
  primaryColour: text(30).min(1),
  secondaryColours: z.array(text(30)).max(4),
  pattern: text(60).nullable(),
  printedValue: z.number().int().positive().max(1_000_000_000).nullable(),
  estimatedCount: z.number().int().min(0).max(10_000).nullable(),
  countConfidence: z.enum(['low', 'medium', 'high']),
  notes: text(200).nullable(),
});
export type ChipProposal = z.infer<typeof ChipProposalSchema>;

export const PhotoAnalysisSchema = z.object({
  schemaVersion: z.literal(PHOTO_SCHEMA_VERSION),
  status: z.enum(['ok', 'not_chips', 'unclear']),
  chipTypes: z.array(ChipProposalSchema).max(MAX_PROPOSALS),
  imageIssues: z.array(z.enum(IMAGE_ISSUES)).max(IMAGE_ISSUES.length),
  message: text(300).nullable(),
});
export type PhotoAnalysis = z.infer<typeof PhotoAnalysisSchema>;

/** Error codes the endpoint returns as `{ error }`; the client maps each to a message. */
export const PHOTO_ERROR_CODES = [
  'disabled',
  'method',
  'origin',
  'unsupported_type',
  'too_large',
  'bad_image',
  'rate_limited',
  'daily_cap',
  'timeout',
  'upstream',
  'invalid_response',
] as const;
export type PhotoErrorCode = (typeof PHOTO_ERROR_CODES)[number];
export const PhotoErrorSchema = z.object({ error: z.enum(PHOTO_ERROR_CODES) });

export const PhotoConfigSchema = z.object({ aiPhotoEnabled: z.boolean() });
export type PhotoConfig = z.infer<typeof PhotoConfigSchema>;

const nullable = (type: string) => ({ type: [type, 'null'] });

/**
 * JSON Schema for the model's tool input (strict tool use): the model fills the analysis
 * fields; `schemaVersion` is added by the server. Limits the schema can't express are
 * enforced by `PhotoAnalysisSchema` afterwards.
 */
export const REPORT_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'chipTypes', 'imageIssues', 'message'],
  properties: {
    status: { type: 'string', enum: ['ok', 'not_chips', 'unclear'] },
    chipTypes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'proposalId',
          'primaryColour',
          'secondaryColours',
          'pattern',
          'printedValue',
          'estimatedCount',
          'countConfidence',
          'notes',
        ],
        properties: {
          proposalId: { type: 'string' },
          primaryColour: { type: 'string' },
          secondaryColours: { type: 'array', items: { type: 'string' } },
          pattern: nullable('string'),
          printedValue: nullable('integer'),
          estimatedCount: nullable('integer'),
          countConfidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          notes: nullable('string'),
        },
      },
    },
    imageIssues: { type: 'array', items: { type: 'string', enum: [...IMAGE_ISSUES] } },
    message: nullable('string'),
  },
} as const;
