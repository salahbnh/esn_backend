import { AppError } from '../../lib/app-error.js';
import * as repo from './clients.repository.js';
import type {
  CreateClientBody,
  ListClientsQuery,
  UpdateClientBody,
} from './clients.schema.js';

/**
 * Clients business logic. Throws AppError on domain violations. Never imports
 * the Prisma client. Clients are org-level (no ownership, no CONSULTANT access).
 */

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

// Concrete list-item type derived from the repository return shape.
type ClientListItem = Awaited<ReturnType<typeof repo.listClients>>['items'][number];

function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  return { data: items, total, page, pageSize };
}

async function loadClientOr404(id: string) {
  const client = await repo.findClientById(id);
  if (!client) {
    throw AppError.notFound('Client not found');
  }
  return client;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listClients(
  query: ListClientsQuery,
): Promise<PaginatedResult<ClientListItem>> {
  const { items, total } = await repo.listClients(
    { search: query.search },
    { page: query.page, pageSize: query.pageSize },
  );
  return paginated(items, total, query.page, query.pageSize);
}

export async function getClient(id: string) {
  const client = await repo.findClientDetailById(id);
  if (!client) {
    throw AppError.notFound('Client not found');
  }
  return client;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createClient(body: CreateClientBody, actorId: string) {
  const client = await repo.createClient({
    name: body.name,
    ...(body.industry !== undefined ? { industry: body.industry } : {}),
    ...(body.contactName !== undefined ? { contactName: body.contactName } : {}),
    ...(body.contactEmail !== undefined ? { contactEmail: body.contactEmail } : {}),
  });

  await repo.writeAuditLog({
    entityType: 'CLIENT',
    entityId: client.id,
    action: 'CREATE',
    actorId,
    payload: { fields: Object.keys(body) },
  });
  return client;
}

export async function updateClient(
  id: string,
  body: UpdateClientBody,
  actorId: string,
) {
  await loadClientOr404(id);

  const client = await repo.updateClient(id, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.industry !== undefined ? { industry: body.industry } : {}),
    ...(body.contactName !== undefined ? { contactName: body.contactName } : {}),
    ...(body.contactEmail !== undefined ? { contactEmail: body.contactEmail } : {}),
  });

  await repo.writeAuditLog({
    entityType: 'CLIENT',
    entityId: id,
    action: 'UPDATE',
    actorId,
    payload: { fields: Object.keys(body) },
  });
  return client;
}
