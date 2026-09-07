import { beforeEach, describe, expect, it, vi } from 'vitest';

// Service tested in isolation — no DB, no network, no env-validating config.
vi.mock('./ai-evaluations.repository.js');
vi.mock('../../lib/storage.js', () => ({ getObjectBytes: vi.fn() }));
vi.mock('../../lib/anthropic.js', () => ({
  AI_MODEL: 'claude-haiku-4-5',
  isAiConfigured: vi.fn(() => true),
  getAnthropicClient: vi.fn(),
}));
vi.mock('../../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import * as repo from './ai-evaluations.repository.js';
import * as storage from '../../lib/storage.js';
import * as anthropicLib from '../../lib/anthropic.js';
import * as service from './ai-evaluations.service.js';

const mockRepo = vi.mocked(repo);
const mockStorage = vi.mocked(storage);
const mockAnthropic = vi.mocked(anthropicLib);

const messagesCreate = vi.fn();

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app1',
    jobPostId: 'post1',
    firstName: 'Jean',
    lastName: 'Dupont',
    email: 'jean@test.fr',
    answers: [{ key: 'q1', label: 'Années d’expérience ?', type: 'SHORT_TEXT', value: '5 ans' }],
    declaredSkills: [{ name: 'React' }],
    status: 'SUBMITTED',
    jobPost: {
      id: 'post1',
      title: 'Dev Full-Stack',
      description: 'Construire le produit',
      requirements: 'TypeScript',
      employmentType: 'CDI',
      seniorityLevel: 'CONFIRMED',
      minYearsExperience: 3,
      requiredSkills: [{ name: 'React' }, { name: 'Node' }],
    },
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof repo.findApplicationForEval>>;
}

function cvDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc1',
    mimeType: 'application/pdf',
    sizeBytes: 50_000,
    storageKey: 'application/app1/cv.pdf',
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof repo.findCvDocument>>;
}

function modelResponse(result: Record<string, unknown> = {}) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          score: 82,
          verdict: 'STRONG_MATCH',
          strengths: ['Solide expérience React'],
          gaps: ['Peu de Node'],
          reasoning: 'Profil très proche du besoin.',
          ...result,
        }),
      },
    ],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1200, output_tokens: 300 },
  };
}

function persistedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'eval1',
    applicationId: 'app1',
    score: 82,
    verdict: 'STRONG_MATCH',
    strengths: ['Solide expérience React'],
    gaps: ['Peu de Node'],
    reasoning: 'Profil très proche du besoin.',
    cvUsed: true,
    model: 'claude-haiku-4-5',
    promptVersion: 'v1',
    tokensInput: 1200,
    tokensOutput: 300,
    createdById: 'actor1',
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: { id: 'actor1', firstName: 'Rh', lastName: 'User' },
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof repo.createEvaluation>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAnthropic.isAiConfigured.mockReturnValue(true);
  mockAnthropic.getAnthropicClient.mockReturnValue({
    messages: { create: messagesCreate },
  } as never);
  mockRepo.findApplicationForEval.mockResolvedValue(application());
  mockRepo.findCvDocument.mockResolvedValue(cvDocument());
  mockRepo.createEvaluation.mockResolvedValue(persistedRow());
  mockRepo.writeAuditLog.mockResolvedValue(undefined);
  mockStorage.getObjectBytes.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
  messagesCreate.mockResolvedValue(modelResponse());
});

describe('triggerEvaluation — happy path with CV', () => {
  it('sends the CV as a base64 PDF block, persists and audits', async () => {
    const result = await service.triggerEvaluation('app1', 'actor1');

    expect(result).toMatchObject({ id: 'eval1', score: 82, verdict: 'STRONG_MATCH', cvUsed: true });
    expect(mockStorage.getObjectBytes).toHaveBeenCalledWith('application/app1/cv.pdf');

    const request = messagesCreate.mock.calls[0]?.[0] as {
      model: string;
      output_config: { format: { type: string } };
      messages: Array<{ content: Array<{ type: string }> }>;
    };
    expect(request.model).toBe('claude-haiku-4-5');
    expect(request.output_config.format.type).toBe('json_schema');
    expect(request.messages[0]?.content.some((b) => b.type === 'document')).toBe(true);

    expect(mockRepo.createEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ cvUsed: true, tokensInput: 1200, tokensOutput: 300 }),
    );
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'APPLICATION', action: 'AI_EVALUATION_CREATED' }),
    );
  });
});

describe('triggerEvaluation — CV fallbacks (evaluate from form only)', () => {
  it('no CV document -> cvUsed=false, no storage fetch', async () => {
    mockRepo.findCvDocument.mockResolvedValue(null);
    await service.triggerEvaluation('app1', 'actor1');
    expect(mockStorage.getObjectBytes).not.toHaveBeenCalled();
    expect(mockRepo.createEvaluation).toHaveBeenCalledWith(expect.objectContaining({ cvUsed: false }));
  });

  it('non-PDF CV -> cvUsed=false, no storage fetch', async () => {
    mockRepo.findCvDocument.mockResolvedValue(cvDocument({ mimeType: 'image/png' }));
    await service.triggerEvaluation('app1', 'actor1');
    expect(mockStorage.getObjectBytes).not.toHaveBeenCalled();
    expect(mockRepo.createEvaluation).toHaveBeenCalledWith(expect.objectContaining({ cvUsed: false }));
  });

  it('CV above 10MB -> cvUsed=false, no storage fetch', async () => {
    mockRepo.findCvDocument.mockResolvedValue(cvDocument({ sizeBytes: 11 * 1024 * 1024 }));
    await service.triggerEvaluation('app1', 'actor1');
    expect(mockStorage.getObjectBytes).not.toHaveBeenCalled();
    expect(mockRepo.createEvaluation).toHaveBeenCalledWith(expect.objectContaining({ cvUsed: false }));
  });
});

describe('triggerEvaluation — error paths', () => {
  it('404 when the application does not exist', async () => {
    mockRepo.findApplicationForEval.mockResolvedValue(null);
    await expect(service.triggerEvaluation('missing', 'actor1')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it('503 AI_NOT_CONFIGURED when the key is absent (no model call)', async () => {
    mockAnthropic.isAiConfigured.mockReturnValue(false);
    await expect(service.triggerEvaluation('app1', 'actor1')).rejects.toMatchObject({
      statusCode: 503,
      code: 'AI_NOT_CONFIGURED',
    });
    expect(messagesCreate).not.toHaveBeenCalled();
    expect(mockRepo.createEvaluation).not.toHaveBeenCalled();
  });

  it('502 AI_PROVIDER_ERROR when the Anthropic call fails', async () => {
    messagesCreate.mockRejectedValue(new Error('overloaded'));
    await expect(service.triggerEvaluation('app1', 'actor1')).rejects.toMatchObject({
      statusCode: 502,
      code: 'AI_PROVIDER_ERROR',
    });
    expect(mockRepo.createEvaluation).not.toHaveBeenCalled();
  });

  it('502 AI_PROVIDER_ERROR when the structured output fails validation (score 150)', async () => {
    messagesCreate.mockResolvedValue(modelResponse({ score: 150 }));
    await expect(service.triggerEvaluation('app1', 'actor1')).rejects.toMatchObject({
      statusCode: 502,
      code: 'AI_PROVIDER_ERROR',
    });
    expect(mockRepo.createEvaluation).not.toHaveBeenCalled();
  });
});

describe('getStatus / listEvaluations', () => {
  it('getStatus reflects isAiConfigured', () => {
    expect(service.getStatus()).toEqual({ configured: true });
    mockAnthropic.isAiConfigured.mockReturnValue(false);
    expect(service.getStatus()).toEqual({ configured: false });
  });

  it('listEvaluations returns DTOs newest-first from the repository', async () => {
    mockRepo.listEvaluations.mockResolvedValue([persistedRow()]);
    const result = await service.listEvaluations('app1');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'eval1', strengths: ['Solide expérience React'] });
  });

  it('listEvaluations throws 404 for an unknown application', async () => {
    mockRepo.findApplicationForEval.mockResolvedValue(null);
    await expect(service.listEvaluations('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});
