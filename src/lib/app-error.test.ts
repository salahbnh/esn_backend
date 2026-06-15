import { describe, expect, it } from 'vitest';
import { AppError } from './app-error.js';

describe('AppError', () => {
  it('carries statusCode, code, message and optional details', () => {
    const err = new AppError(418, 'TEAPOT', 'I am a teapot', { hint: 'short and stout' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe('TEAPOT');
    expect(err.message).toBe('I am a teapot');
    expect(err.details).toEqual({ hint: 'short and stout' });
  });

  it('exposes typed factory helpers with correct status codes', () => {
    expect(AppError.badRequest('x').statusCode).toBe(400);
    expect(AppError.unauthorized().statusCode).toBe(401);
    expect(AppError.forbidden().statusCode).toBe(403);
    expect(AppError.notFound().statusCode).toBe(404);
    expect(AppError.conflict('x').statusCode).toBe(409);
    expect(AppError.internal().statusCode).toBe(500);
  });

  it('defaults details to undefined when not provided', () => {
    expect(AppError.notFound().details).toBeUndefined();
  });
});
