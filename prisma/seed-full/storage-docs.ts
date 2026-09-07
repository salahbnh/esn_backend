/**
 * Document fixtures: real bytes in MinIO + the matching `Document` metadata row.
 *
 * A `Document` row on its own is a broken fixture — every download goes through
 * a presigned URL for `storageKey`, so a row without an object behind it 404s at
 * the storage layer. The seed therefore renders an actual PDF (pdfkit, via the
 * app's own `renderContractPdf`) and PUTs it to the bucket before inserting.
 *
 * Storage keys are DERIVED FROM THE DOCUMENT ID rather than `buildStorageKey()`
 * (which prefixes a random uuid): re-running the seed must overwrite the same
 * object instead of leaving an orphan behind on every run.
 */
import type { DocumentType, EntityType, PrismaClient, ScanStatus } from '@prisma/client';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { config } from '../../src/config/env.js';
import { renderContractPdf } from '../../src/lib/pdf.js';
import { putObject, s3 } from '../../src/lib/storage.js';

export interface DocumentSpec {
  /** Stable seed id (from `sid()`). */
  id: string;
  type: DocumentType;
  entityType: EntityType;
  entityId: string;
  filename: string;
  /** Document heading rendered inside the PDF. */
  title: string;
  /** Body text of the PDF. */
  body: string;
  uploadedById: string | null;
  scanStatus?: ScanStatus;
  createdAt: Date;
  archivedAt?: Date | null;
  /**
   * Storage-key namespace. Defaults to the entity type; public portal uploads
   * pass `config.PUBLIC_UPLOAD_PREFIX` so their keys look like the real ones.
   */
  keyPrefix?: string;
}

function sanitize(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** `document/<entityType>/<entityId>/<docId>-<filename>` — collision-free + stable. */
export function seedStorageKey(spec: DocumentSpec): string {
  const prefix = spec.keyPrefix ?? spec.entityType.toLowerCase();
  return `${prefix}/${spec.entityId}/${spec.id}-${sanitize(spec.filename)}`;
}

/**
 * Render + upload + upsert one document. Returns the document id so callers can
 * point `generatedPdfId` / `signedPdfId` / `Proposal.documentId` at it.
 */
export async function createDocument(prisma: PrismaClient, spec: DocumentSpec): Promise<string> {
  const isPdf = spec.filename.toLowerCase().endsWith('.pdf');
  const bytes = isPdf
    ? await renderContractPdf({ title: spec.title, body: spec.body })
    : Buffer.from(`${spec.title}\n\n${spec.body}\n`, 'utf8');
  const mimeType = isPdf ? 'application/pdf' : 'text/plain';
  const storageKey = seedStorageKey(spec);

  await putObject({ key: storageKey, body: bytes, contentType: mimeType });

  const data = {
    type: spec.type,
    entityType: spec.entityType,
    entityId: spec.entityId,
    filename: spec.filename,
    mimeType,
    sizeBytes: bytes.length,
    storageKey,
    uploadedById: spec.uploadedById,
    scanStatus: spec.scanStatus ?? ('CLEAN' as ScanStatus),
    archivedAt: spec.archivedAt ?? null,
    createdAt: spec.createdAt,
  };

  await prisma.document.upsert({
    where: { id: spec.id },
    update: data,
    create: { id: spec.id, ...data },
  });
  return spec.id;
}

/** A believable one-page CV body for a Tunisian consultant/candidate. */
export function cvBody(args: {
  firstName: string;
  lastName: string;
  position: string;
  seniority: string;
  city: string;
  skills: readonly string[];
  years: number;
}): string {
  return [
    `${args.firstName.toUpperCase()} ${args.lastName.toUpperCase()}`,
    `${args.position} — ${args.seniority}`,
    `${args.city}, Tunisie · ${args.years} ans d'experience`,
    '',
    'PROFIL',
    `${args.position} ${args.seniority.toLowerCase()} avec ${args.years} ans d'experience en ESN,`,
    'intervenant en regie et au forfait chez des clients grands comptes tunisiens.',
    'Habitue au travail en equipe agile et a la relation client directe.',
    '',
    'COMPETENCES',
    args.skills.map((s) => `  - ${s}`).join('\n'),
    '',
    'EXPERIENCE',
    `  2021 - aujourd'hui : ${args.position}, missions clients (banque, telecom, industrie).`,
    '  2019 - 2021 : Developpeur, projets internes et TMA.',
    '',
    'FORMATION',
    "  Diplome national d'ingenieur en informatique — Tunis.",
    '',
    'LANGUES',
    '  Arabe (langue maternelle) · Francais (courant) · Anglais (professionnel)',
  ].join('\n');
}

/**
 * Deletes every object in the bucket.
 *
 * The reset drops all `Document` rows, which would otherwise leave their MinIO
 * objects behind as unreferenced garbage that grows with every re-run. Safe in
 * this context precisely because the seed owns the whole dataset — never point
 * anything like this at a bucket holding real uploads.
 */
export async function purgeBucket(): Promise<number> {
  const Bucket = config.S3_BUCKET;
  let deleted = 0;
  let token: string | undefined;

  do {
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket, ...(token ? { ContinuationToken: token } : {}) }),
    );
    const objects = (listed.Contents ?? [])
      .map((o) => o.Key)
      .filter((key): key is string => key !== undefined)
      .map((Key) => ({ Key }));

    if (objects.length > 0) {
      // DeleteObjects takes up to 1000 keys per call — the same page size
      // ListObjectsV2 returns, so one delete per page is always within bounds.
      await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: objects, Quiet: true } }));
      deleted += objects.length;
    }
    token = listed.IsTruncated === true ? listed.NextContinuationToken : undefined;
  } while (token);

  return deleted;
}
