import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env.js';
import { AppError } from './app-error.js';

/**
 * Lazy Anthropic client. ANTHROPIC_API_KEY is OPTIONAL: the app must boot and
 * run fully without it — AI endpoints degrade to a typed 503 until a key is
 * pasted into .env and the server restarted. Never construct the client at
 * module load; always go through getAnthropicClient().
 */

export const AI_MODEL = 'claude-haiku-4-5';

let client: Anthropic | null = null;

export function isAiConfigured(): boolean {
  return Boolean(config.ANTHROPIC_API_KEY);
}

export function getAnthropicClient(): Anthropic {
  if (!config.ANTHROPIC_API_KEY) {
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      'AI evaluation is not configured on this server (missing ANTHROPIC_API_KEY)',
    );
  }
  if (!client) {
    client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }
  return client;
}
