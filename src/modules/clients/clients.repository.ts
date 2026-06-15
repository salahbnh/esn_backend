import type { Client, EntityType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Clients data-access layer. The ONLY clients-module file that imports the
 * Prisma client. No business logic — pure, deliberate data access.
 */

export interface Pagination {
  page: number;
  pageSize: number;
}

export interface ClientFilter {
  search?: string;
}

export interface CreateClientData {
  name: string;
  industry?: string;
  contactName?: string;
  contactEmail?: string;
}

export interface UpdateClientData {
  name?: string;
  industry?: string;
  contactName?: string;
  contactEmail?: string;
}

export interface AuditLogData {
  entityType: EntityType;
  entityId: string;
  action: string;
  actorId: string;
  payload: Prisma.InputJsonValue;
}

function paginate({ page, pageSize }: Pagination): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findClientById(id: string): Promise<Client | null> {
  return prisma.client.findUnique({ where: { id } });
}

/** Client detail row + computed `_missionCount`. */
export async function findClientDetailById(id: string) {
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) {
    return null;
  }
  const missionCount = await prisma.mission.count({ where: { clientId: id } });
  return { ...client, _missionCount: missionCount };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listClients(filter: ClientFilter, pagination: Pagination) {
  const where: Prisma.ClientWhereInput = {};
  if (filter.search) {
    where.OR = [
      { name: { contains: filter.search, mode: 'insensitive' } },
      { industry: { contains: filter.search, mode: 'insensitive' } },
      { contactName: { contains: filter.search, mode: 'insensitive' } },
    ];
  }

  const { skip, take } = paginate(pagination);
  const [items, total] = await Promise.all([
    prisma.client.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
    prisma.client.count({ where }),
  ]);
  return { items, total };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function createClient(data: CreateClientData): Promise<Client> {
  return prisma.client.create({ data });
}

export function updateClient(id: string, data: UpdateClientData): Promise<Client> {
  return prisma.client.update({ where: { id }, data });
}

// ---------------------------------------------------------------------------
// Audit (non-transactional, best-effort for standalone mutations)
// ---------------------------------------------------------------------------

export function writeAuditLog(entry: AuditLogData): Promise<unknown> {
  return prisma.auditLog.create({ data: entry });
}
