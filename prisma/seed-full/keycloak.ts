/**
 * Seed-time Keycloak provisioning.
 *
 * This is intentionally NOT `src/lib/keycloak-admin.ts`: the app's `provisionUser`
 * creates accounts DISABLED with a random temporary password and an
 * UPDATE_PASSWORD required action (correct for a real hire — the person sets
 * their own password from an invite email). A fixture needs the opposite: an
 * account you can log into immediately with a known password. So the seed talks
 * to the Admin API directly, and is idempotent — re-running reuses the existing
 * account instead of failing on 409.
 *
 * DEV ONLY. `SEED_PASSWORD` is a local convenience credential for the throwaway
 * docker-compose realm; nothing here is safe outside a dev machine.
 */
import { config } from '../../src/config/env.js';

/** Shared password for every seeded account (dev realm only). */
export const SEED_PASSWORD = 'password';

const TOKEN_URL = `${config.KEYCLOAK_BASE_URL}/realms/${config.KEYCLOAK_REALM}/protocol/openid-connect/token`;
const REALM_BASE = `${config.KEYCLOAK_BASE_URL}/admin/realms/${config.KEYCLOAK_REALM}`;

let cachedToken: { value: string; expiresAt: number } | null = null;

async function adminToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 5_000) return cachedToken.value;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.KEYCLOAK_ADMIN_CLIENT_ID,
      client_secret: config.KEYCLOAK_ADMIN_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Keycloak admin token failed (${res.status}). Is the esn-keycloak container up on ` +
        `${config.KEYCLOAK_BASE_URL} and the realm "${config.KEYCLOAK_REALM}" imported?`,
    );
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return data.access_token;
}

async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await adminToken();
  return fetch(`${REALM_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

export interface SeedUserInput {
  email: string;
  firstName: string;
  lastName: string;
  realmRole: string;
  /** Deactivated staff accounts are created disabled to mirror `User.isActive`. */
  enabled?: boolean;
}

async function findByUsername(username: string): Promise<{ id: string } | null> {
  const res = await adminFetch(`/users?username=${encodeURIComponent(username)}&exact=true`);
  if (!res.ok) throw new Error(`Keycloak user lookup failed (${res.status}) for ${username}`);
  const users = (await res.json()) as Array<{ id: string }>;
  return users[0] ?? null;
}

async function assignRealmRole(userId: string, roleName: string): Promise<void> {
  // Read the roles still ASSIGNABLE to this user. Needs only `manage-users`
  // (GET /roles/{name} would require the broader `view-realm`). A role missing
  // from this list is already mapped — nothing to do.
  const res = await adminFetch(`/users/${userId}/role-mappings/realm/available`);
  if (!res.ok) throw new Error(`Keycloak available-roles failed (${res.status})`);
  const available = (await res.json()) as Array<{ id: string; name: string }>;
  const role = available.find((r) => r.name === roleName);
  if (!role) return;

  const map = await adminFetch(`/users/${userId}/role-mappings/realm`, {
    method: 'POST',
    body: JSON.stringify([{ id: role.id, name: role.name }]),
  });
  if (!map.ok) throw new Error(`Keycloak role assignment failed (${map.status}) for ${roleName}`);
}

async function setPassword(userId: string): Promise<void> {
  const res = await adminFetch(`/users/${userId}/reset-password`, {
    method: 'PUT',
    body: JSON.stringify({ type: 'password', value: SEED_PASSWORD, temporary: false }),
  });
  if (!res.ok) throw new Error(`Keycloak set-password failed (${res.status})`);
}

/**
 * Create-or-update a realm account and return its `sub` (which becomes
 * `User.keycloakId`). Existing accounts — including the four users shipped in
 * realm-export.json — are updated in place so names stay in sync with the DB.
 */
export async function ensureKeycloakUser(input: SeedUserInput): Promise<string> {
  const enabled = input.enabled ?? true;
  const profile = {
    username: input.email,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    enabled,
    emailVerified: true,
    // No UPDATE_PASSWORD: seeded accounts must be usable straight away.
    requiredActions: [] as string[],
  };

  const existing = await findByUsername(input.email);
  let id: string;

  if (existing) {
    const res = await adminFetch(`/users/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify(profile),
    });
    if (!res.ok) throw new Error(`Keycloak user update failed (${res.status}) for ${input.email}`);
    id = existing.id;
  } else {
    const res = await adminFetch('/users', { method: 'POST', body: JSON.stringify(profile) });
    if (!res.ok) throw new Error(`Keycloak user create failed (${res.status}) for ${input.email}`);
    const location = res.headers.get('location') ?? '';
    const created = location.split('/users/')[1]?.split('/')[0];
    if (!created) throw new Error(`Keycloak did not return an id for ${input.email}`);
    id = created;
  }

  await assignRealmRole(id, input.realmRole);
  await setPassword(id);
  return id;
}

/** Fail fast with an actionable message before doing any DB work. */
export async function assertKeycloakReachable(): Promise<void> {
  await adminToken();
}
