import { z } from 'zod';

// Issue messages are message-catalogue keys, so modules stay UI-free and translatable.
export const IssueSchema = z.object({
  code: z.string().min(1),
  messageKey: z.string().min(1),
  params: z.record(z.unknown()).optional(),
  path: z.string().optional(),
});
export type Issue = z.infer<typeof IssueSchema>;

export interface ValidationReport {
  errors: Issue[];
  warnings: Issue[];
}

export function emptyReport(): ValidationReport {
  return { errors: [], warnings: [] };
}

export function mergeReports(...reports: ValidationReport[]): ValidationReport {
  return {
    errors: reports.flatMap((r) => r.errors),
    warnings: reports.flatMap((r) => r.warnings),
  };
}

/** Errors block; warnings only inform. */
export function isValid(report: ValidationReport): boolean {
  return report.errors.length === 0;
}
