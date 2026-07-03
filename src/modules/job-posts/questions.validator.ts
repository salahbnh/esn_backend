import type { QuestionType } from '@prisma/client';
import { AppError } from '../../lib/app-error.js';

/**
 * Pure, DB-free validator for applicant answers against a job's LIVE questions.
 * Shared by the public apply flow. Produces the immutable answer snapshot stored
 * on the Application. All values are plain text/number/boolean (no HTML).
 */

export interface ActiveQuestion {
  key: string;
  label: string;
  type: QuestionType;
  required: boolean;
  options?: string[];
  config?: { min?: number; max?: number; maxLength?: number };
}

export interface AnswerSnapshot {
  key: string;
  label: string;
  type: QuestionType;
  value: string | number | boolean | string[];
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

function badRequest(message: string, code: string): AppError {
  return AppError.badRequest(message, { code });
}

export function validateAnswers(
  questions: ActiveQuestion[],
  rawAnswers: Record<string, unknown>,
): AnswerSnapshot[] {
  const known = new Set(questions.map((q) => q.key));
  for (const key of Object.keys(rawAnswers)) {
    if (!known.has(key)) {
      throw badRequest(`Unknown answer key: ${key}`, 'UNKNOWN_ANSWER_KEY');
    }
  }

  const snapshot: AnswerSnapshot[] = [];
  for (const q of questions) {
    const raw = rawAnswers[q.key];
    if (isEmpty(raw)) {
      if (q.required) throw badRequest(`Missing required answer: ${q.key}`, 'MISSING_REQUIRED_ANSWER');
      continue; // optional + empty → omit from snapshot
    }
    snapshot.push({ key: q.key, label: q.label, type: q.type, value: coerce(q, raw) });
  }
  return snapshot;
}

function coerce(q: ActiveQuestion, raw: unknown): AnswerSnapshot['value'] {
  const maxLen = q.config?.maxLength ?? 2000;
  switch (q.type) {
    case 'SHORT_TEXT':
    case 'LONG_TEXT': {
      if (typeof raw !== 'string') throw badRequest(`${q.key} must be text`, 'INVALID_ANSWER');
      if (raw.length > maxLen) throw badRequest(`${q.key} exceeds max length`, 'ANSWER_TOO_LONG');
      return raw;
    }
    case 'SINGLE_CHOICE': {
      if (typeof raw !== 'string' || !(q.options ?? []).includes(raw)) {
        throw badRequest(`${q.key} must be one of the allowed options`, 'INVALID_OPTION');
      }
      return raw;
    }
    case 'MULTI_CHOICE': {
      const opts = q.options ?? [];
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string' || !opts.includes(v))) {
        throw badRequest(`${q.key} must be a subset of the allowed options`, 'INVALID_OPTION');
      }
      // De-duplicate — a valid selection is a SET of options.
      return [...new Set(raw as string[])];
    }
    case 'BOOLEAN': {
      if (raw === true || raw === 'true') return true;
      if (raw === false || raw === 'false') {
        if (q.required) throw badRequest(`${q.key} must be accepted`, 'MISSING_REQUIRED_ANSWER');
        return false;
      }
      throw badRequest(`${q.key} must be a boolean`, 'INVALID_ANSWER');
    }
    case 'NUMBER': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) throw badRequest(`${q.key} must be a number`, 'INVALID_ANSWER');
      if (q.config?.min !== undefined && n < q.config.min) {
        throw badRequest(`${q.key} below minimum`, 'ANSWER_OUT_OF_RANGE');
      }
      if (q.config?.max !== undefined && n > q.config.max) {
        throw badRequest(`${q.key} above maximum`, 'ANSWER_OUT_OF_RANGE');
      }
      return n;
    }
    default:
      throw badRequest(`Unsupported question type`, 'INVALID_ANSWER');
  }
}
