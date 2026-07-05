import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import { AppError } from './app-error.js';
import { logger } from './logger.js';

/**
 * Keycloak Admin API client (client-credentials grant via the confidential
 * `esn-backend` service account). Used to auto-provision a Keycloak account when
 * a candidate is converted to a consultant.
 *
 * The service account needs ONLY the realm-management role `manage-users`
 * (granted in keycloak/realm-export.json) — it covers user create/read/update/
 * delete AND reading a user's assignable realm roles. We deliberately avoid
 * `view-realm` (broad realm-config read) by looking the CONSULTANT role up via
 * the user's `role-mappings/realm/available` list rather than `GET /roles/{name}`.
 */

const REALM_BASE = `${config.KEYCLOAK_BASE_URL}/admin/realms/${config.KEYCLOAK_REALM}`;
const TOKEN_URL = `${config.KEYCLOAK_BASE_URL}/realms/${config.KEYCLOAK_REALM}/protocol/openid-connect/token`;

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAdminToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 5_000) {
    return cachedToken.value;
  }

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
    logger.error({ status: res.status }, 'Keycloak admin token request failed');
    throw AppError.internal('Could not authenticate to the identity provider');
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return data.access_token;
}

async function adminFetch(path: string, init: RequestInit): Promise<Response> {
  const token = await getAdminToken();
  return fetch(`${REALM_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

/**
 * Path for the UPDATE_PASSWORD invite email, scoped with `client_id` +
 * `redirect_uri` so the set-password link lands back on the frontend app rather
 * than the Keycloak account console (Keycloak requires both to build the link).
 */
function executeActionsEmailPath(id: string): string {
  const params = new URLSearchParams({
    client_id: config.KEYCLOAK_FRONTEND_CLIENT_ID,
    redirect_uri: config.CORS_ORIGIN,
  });
  return `/users/${id}/execute-actions-email?${params.toString()}`;
}

/**
 * True if a Keycloak user already exists with this exact username. Used for the
 * pre-flight collision check when generating a company email at conversion.
 */
export async function checkKeycloakUsernameExists(username: string): Promise<boolean> {
  const params = new URLSearchParams({ username, exact: 'true' });
  const res = await adminFetch(`/users?${params.toString()}`, { method: 'GET' });
  if (!res.ok) {
    logger.error({ status: res.status }, 'Keycloak username lookup failed');
    throw AppError.internal('Could not check the identity provider for an existing account');
  }
  const users = (await res.json()) as unknown[];
  return Array.isArray(users) && users.length > 0;
}

/**
 * Re-send the UPDATE_PASSWORD set-password email for an already-provisioned user.
 * Explicit RH/DIRECTION action — NOT gated by KEYCLOAK_INVITE_EMAIL. Requires the
 * realm SMTP (Mailpit in dev) to be configured.
 */
export async function resendInvite(keycloakId: string): Promise<void> {
  const res = await adminFetch(executeActionsEmailPath(keycloakId), {
    method: 'PUT',
    body: JSON.stringify(['UPDATE_PASSWORD']),
  });
  if (!res.ok) {
    logger.error({ status: res.status, keycloakId }, 'Keycloak resend-invite failed');
    throw AppError.internal('Could not send the invitation email');
  }
}

export interface ProvisionUserInput {
  email: string;
  firstName: string;
  lastName: string;
  realmRole: string; // e.g. 'CONSULTANT'
}

/**
 * Create a Keycloak user, assign a realm role, and set a temporary password with
 * an UPDATE_PASSWORD required action. Returns the new Keycloak user id (the `sub`).
 *
 * If any step after creation fails, the partially-created user is deleted so the
 * caller can safely retry. Throws AppError on failure.
 */
export async function provisionUser(input: ProvisionUserInput): Promise<{ id: string }> {
  // 1. Create the user.
  const createRes = await adminFetch('/users', {
    method: 'POST',
    body: JSON.stringify({
      username: input.email,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      // Created disabled: an orphaned account (DB tx fails after this) cannot log
      // in. The caller enables it via activateUser() only after the DB write commits.
      enabled: false,
      // Internal HR-vouched email — treated as verified.
      emailVerified: true,
      requiredActions: ['UPDATE_PASSWORD'],
    }),
  });

  if (createRes.status === 409) {
    throw AppError.conflict('An identity-provider account already exists for this email');
  }
  if (!createRes.ok) {
    logger.error({ status: createRes.status }, 'Keycloak user creation failed');
    throw AppError.internal('Could not provision the identity-provider account');
  }

  // The new user id is in the Location header: .../users/{id}
  const location = createRes.headers.get('location') ?? '';
  const id = location.split('/users/')[1]?.split('/')[0];
  if (!id) {
    throw AppError.internal('Identity provider did not return a user id');
  }

  try {
    // 2. Assign the realm role. Look it up via the freshly-created user's
    //    ASSIGNABLE (available) realm roles — needs only `manage-users`, avoiding
    //    the broader `view-realm` that `GET /roles/{name}` would require.
    const availRes = await adminFetch(`/users/${id}/role-mappings/realm/available`, {
      method: 'GET',
    });
    if (!availRes.ok) {
      throw AppError.internal('Could not read assignable realm roles');
    }
    const available = (await availRes.json()) as Array<{ id: string; name: string }>;
    const role = available.find((r) => r.name === input.realmRole);
    if (!role) {
      throw AppError.internal(`Realm role ${input.realmRole} not found`);
    }
    const mapRes = await adminFetch(`/users/${id}/role-mappings/realm`, {
      method: 'POST',
      body: JSON.stringify([{ id: role.id, name: role.name }]),
    });
    if (!mapRes.ok) {
      throw AppError.internal('Could not assign the consultant role');
    }

    // 3. Set a temporary password (the user must reset on first login).
    const pwdRes = await adminFetch(`/users/${id}/reset-password`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'password', value: randomUUID(), temporary: true }),
    });
    if (!pwdRes.ok) {
      throw AppError.internal('Could not set the initial password');
    }

    // 4. Optionally email the set-password invite (dev via Mailpit, prod via SMTP).
    //    A send failure must NOT fail the whole conversion — the account is valid
    //    and RH can re-send via /resend-invite. Log it loudly instead of swallowing.
    if (config.KEYCLOAK_INVITE_EMAIL) {
      const inviteRes = await adminFetch(executeActionsEmailPath(id), {
        method: 'PUT',
        body: JSON.stringify(['UPDATE_PASSWORD']),
      });
      if (!inviteRes.ok) {
        logger.warn(
          { status: inviteRes.status, userId: id },
          'Consultant provisioned but the set-password invite email failed; resend it from the UI',
        );
      }
    } else {
      logger.info(
        { userId: id },
        'KEYCLOAK_INVITE_EMAIL is off — skipping the set-password invite email (set it to true to enable)',
      );
    }

    return { id };
  } catch (err) {
    // Compensation: roll back the just-created user so a retry is clean.
    await deleteUser(id).catch((e) =>
      logger.error({ err: e, userId: id }, 'Failed to roll back Keycloak user after provisioning error'),
    );
    throw err;
  }
}

/**
 * Enable a previously-disabled Keycloak user. Called after the DB transaction
 * that creates the consultant commits, so a login can only happen once the
 * domain record exists.
 */
export async function activateUser(id: string): Promise<void> {
  const res = await adminFetch(`/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ enabled: true }),
  });
  if (!res.ok) {
    throw AppError.internal('Could not activate the identity-provider account');
  }
}

/**
 * Enable or disable a Keycloak account (staff deactivation/reactivation from the
 * users admin). A disabled account cannot log in; the DB `User.isActive` flag is
 * kept in sync by the caller.
 */
export async function setUserEnabled(id: string, enabled: boolean): Promise<void> {
  const res = await adminFetch(`/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    logger.error({ status: res.status, keycloakId: id }, 'Keycloak enable/disable failed');
    throw AppError.internal('Could not update the identity-provider account');
  }
}

/** Delete a Keycloak user (used as a compensating action). */
export async function deleteUser(id: string): Promise<void> {
  const res = await adminFetch(`/users/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    throw AppError.internal('Could not delete the identity-provider account');
  }
}
