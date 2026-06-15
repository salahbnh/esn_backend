import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@prisma/client';

// Mock the repository. The service is tested in isolation — no DB, no network.
vi.mock('./clients.repository.js');
// Stub the logger so importing the service (transitively) doesn't pull in the
// env-validating config module (which calls process.exit on missing env).
vi.mock('../../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import * as repo from './clients.repository.js';
import * as service from './clients.service.js';

const mockRepo = vi.mocked(repo);

function client(overrides: Record<string, unknown> = {}): Client {
  return {
    id: 'cli1',
    name: 'Acme Corp',
    industry: 'Tech',
    contactName: null,
    contactEmail: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Client;
}

function clientDetail(overrides: Record<string, unknown> = {}) {
  return { ...client(overrides), _missionCount: 0 } as unknown as Awaited<
    ReturnType<typeof repo.findClientDetailById>
  >;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.writeAuditLog.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// getClient
// ---------------------------------------------------------------------------

describe('getClient', () => {
  it('returns the detail row (with _missionCount)', async () => {
    mockRepo.findClientDetailById.mockResolvedValue(clientDetail());
    const result = await service.getClient('cli1');
    expect(result).toMatchObject({ id: 'cli1', _missionCount: 0 });
  });

  it('throws 404 when the client does not exist', async () => {
    mockRepo.findClientDetailById.mockResolvedValue(null);
    await expect(service.getClient('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// createClient
// ---------------------------------------------------------------------------

describe('createClient', () => {
  it('creates a client and writes a CLIENT audit log', async () => {
    mockRepo.createClient.mockResolvedValue(client());
    const result = await service.createClient(
      { name: 'Acme Corp', industry: 'Tech' },
      'actor1',
    );
    expect(result).toMatchObject({ id: 'cli1', name: 'Acme Corp' });
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'CLIENT',
        entityId: 'cli1',
        action: 'CREATE',
        actorId: 'actor1',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// updateClient
// ---------------------------------------------------------------------------

describe('updateClient', () => {
  it('throws 404 when the client does not exist (no update written)', async () => {
    mockRepo.findClientById.mockResolvedValue(null);
    await expect(
      service.updateClient('missing', { name: 'New' }, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockRepo.updateClient).not.toHaveBeenCalled();
    expect(mockRepo.writeAuditLog).not.toHaveBeenCalled();
  });

  it('updates an existing client and writes a CLIENT audit log', async () => {
    mockRepo.findClientById.mockResolvedValue(client());
    mockRepo.updateClient.mockResolvedValue(client({ name: 'Acme II' }));
    const result = await service.updateClient('cli1', { name: 'Acme II' }, 'actor1');
    expect(result).toMatchObject({ name: 'Acme II' });
    expect(mockRepo.updateClient).toHaveBeenCalledWith('cli1', { name: 'Acme II' });
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'CLIENT',
        entityId: 'cli1',
        action: 'UPDATE',
        actorId: 'actor1',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// listClients
// ---------------------------------------------------------------------------

describe('listClients', () => {
  it('returns the paginated envelope', async () => {
    mockRepo.listClients.mockResolvedValue({ items: [client()], total: 1 });
    const result = await service.listClients({ page: 1, pageSize: 20 });
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(result.data).toHaveLength(1);
  });
});
