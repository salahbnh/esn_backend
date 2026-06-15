import jwt, { type JwtHeader, type SigningKeyCallback } from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { config } from '../config/env.js';
import { AppError } from './app-error.js';

/**
 * JWKS client against Keycloak. Keys are cached and rate-limited.
 */
const jwksClient = new JwksClient({
  jwksUri: config.KEYCLOAK_JWKS_URI,
  cache: true,
  cacheMaxAge: 10 * 60 * 1000, // 10 minutes
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

function getSigningKey(header: JwtHeader, callback: SigningKeyCallback): void {
  if (!header.kid) {
    callback(new Error('Token header missing kid'));
    return;
  }
  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err || !key) {
      callback(err ?? new Error('Signing key not found'));
      return;
    }
    callback(null, key.getPublicKey());
  });
}

/**
 * Roles can live either at the realm level (`realm_access.roles`) or under a
 * client in `resource_access`. Keycloak default tokens use realm_access.
 */
export interface KeycloakClaims extends jwt.JwtPayload {
  sub: string;
  email?: string;
  given_name?: string;
  family_name?: string;
  preferred_username?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
}

/**
 * Verify signature against JWKS, plus issuer, audience and expiry.
 * NEVER relax any of these checks.
 */
export function verifyToken(token: string): Promise<KeycloakClaims> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getSigningKey,
      {
        algorithms: ['RS256'],
        issuer: config.KEYCLOAK_ISSUER,
        audience: config.KEYCLOAK_AUDIENCE,
      },
      (err, decoded) => {
        if (err || !decoded || typeof decoded === 'string') {
          reject(AppError.unauthorized('Invalid or expired token'));
          return;
        }
        resolve(decoded as KeycloakClaims);
      },
    );
  });
}
