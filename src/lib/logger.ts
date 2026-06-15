import pino from 'pino';
import { config } from '../config/env.js';

/**
 * Application logger. Level driven by config.LOG_LEVEL.
 * Never log secrets, tokens, or full PII payloads.
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'password', 'token', '*.password', '*.token'],
    censor: '[redacted]',
  },
});
