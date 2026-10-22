import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  accessTypeSchema,
  artifactDtoSchema,
  artifactNameFromFilename,
  ARTIFACT_NAME_MESSAGE,
  createShareRequestSchema,
  normalizeArtifactName,
  SHARE_WITH_ORGANIZATION_REQUEST_MESSAGE,
  shareWithOrganizationRequestSchema,
  publicArtifactSchema,
  publicUnlockRequestSchema,
  shareStateSchema,
  type AccessType,
  type ArtifactDto,
  type ArtifactView,
  type ContentFormat,
  type CreateShareRequest,
  type PublicArtifact,
  type PublicUnlockEnvelope,
  type ShareState,
} from "@factrove/contracts";
import { ArtifactsRepository, PrismaService, type ArtifactRecord } from "../database/index.js";
import { convertHtmlToMarkdown } from "../rendering/convert-html-to-markdown.js";
import { HtmlConversionError, readBoundedHtml } from "../rendering/html-to-markdown.js";
import { ActorService, type Actor, type HeaderSource } from "../auth/actor.service.js";
import { artifactContentUrl, contentGrantAllows, grantedContentUrl } from "../auth/content-grant.js";
import { artifactObjectKey, immutableContentKey, rejectHtmlUpload, storedObjectKey } from "../rendering/html-policy.js";
import { argon2VerifyGate } from "../sharing/argon2-gate.js";
import { PasswordAttemptLimiter } from "../sharing/password-attempt-limit.js";
import { browserOrigins } from "../sharing/public-origin.js";
import { PublicViewLimiter } from "../sharing/public-view-limit.js";
import {
  deriveShareGrantKey,
  mintShareGrant,
  mintShareTicket,
  readShareTicket,
  shareGrantAllows,
  ShareTicketLedger,
  type ShareGrantScope,
} from "../sharing/share-grant.js";
import {
  artifactShareUrl,
  artifactViewerUrl,
  createShareToken,
  hashShareToken,
  isShareToken,
  publicContentUrl,
  ticketedContentUrl,
} from "../sharing/share-link.js";
import { hashSharePassword, sharePasswordFingerprint, verifySharePassword } from "../sharing/share-password.js";
import { decryptShareToken, deriveShareTokenKey, encryptShareToken } from "../sharing/share-token-cipher.js";
import { decideContentPublish } from "./replace-content.js";
import { BLOB_STORE, BlobNotFoundError, BlobStoreUnavailableError, type BlobStore } from "../storage/index.js";
import { API_CONFIG, type ApiConfig } from "./api-config.js";
import { ApiErrorException } from "./api-error.js";

const IDENTITY_FIELDS = [
  "creatorUserId",
  "creator_user_id",
  "organizationId",
  "organization_id",
  "userId",
  "user_id",
] as const;

@Injectable()
export class ArtifactsService {
  private readonly logger = new Logger(ArtifactsService.name);

  constructor(
    @Inject(ArtifactsRepository) private readonly artifacts: ArtifactsRepository,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
    @Inject(ActorService) private readonly actors: ActorService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(PublicViewLimiter) private readonly publicViews: PublicViewLimiter,
    @Inject(PasswordAttemptLimiter) private readonly passwordAttempts: PasswordAttemptLimiter,
    @Inject(ShareTicketLedger) private readonly tickets: ShareTicketLedger,
  ) {}

  async upload(request: HeaderSource, file: unknown, body: unknown): Promise<ArtifactDto> {
    const actor = await this.actors.requireActor(request);
    const fields = formFields(body);
    assertNoIdentityFields(fields);
    const accessType = readAccessType(fields);
    const upload = readUpload(file);
    if (!upload) {
      throw new ApiErrorException(400, "INVALID_REQUEST", "Send exactly one file.");
    }

    if (accessType === "org_shared" && actor.organization === null) {
      throw new ApiErrorException(
        400,
        "ORGANIZATION_REQUIRED",
        "Organization sharing requires membership in an organization.",
      );
    }

    const violation = rejectHtmlUpload(upload.filename, upload.bytes);
    if (violation) {
      throw new ApiErrorException(violation.status, violation.code, violation.message);
    }
    const submittedName = readSubmittedName(fields);
    const name = submittedName === undefined ? artifactNameFromFilename(upload.filename) : submittedName;

    const id = randomUUID();
    const objectKey = immutableContentKey(id, randomUUID());
    try {
      await this.blobs.put({
        objectKey,
        body: upload.bytes,
        contentType: "text/html",
      });
    } catch (error) {
      await this.deleteStoredQuietly(objectKey);
      throw error;
    }

    try {
      const record = await this.artifacts.create({
        id,
        creatorUserId: actor.user.id,
        organizationId: actor.organization?.id ?? null,
        accessType,
        mimeType: "text/html",
        sizeBytes: upload.bytes.byteLength,
        name,
        objectKey,
        uploadedAt: new Date(),
      });
      return this.toDto(record, false);
    } catch (error) {
      await this.deleteOrphan(id, objectKey);
      throw error;
    }
  }

  async replaceContent(request: HeaderSource, id: string, file: unknown, body: unknown): Promise<ArtifactDto> {
    const record = await this.requireOwner(request, id);
    const fields = formFields(body);
    assertNoIdentityFields(fields);
    if (Object.hasOwn(fields, "accessType")) {
      throw new ApiErrorException(400, "INVALID_REQUEST", "accessType cannot be changed when replacing content.");
    }
    const upload = readUpload(file);
    if (!upload) {
      throw new ApiErrorException(400, "INVALID_REQUEST", "Send exactly one file.");
    }
    const violation = rejectHtmlUpload(upload.filename, upload.bytes);
    if (violation) {
      throw new ApiErrorException(violation.status, violation.code, violation.message);
    }
    const name = readSubmittedName(fields);

    const replaced = await this.publishReplacement(record, upload.bytes, name);
    return this.toDto(replaced, false);
  }

  // Owner only. private -> org_shared in the caller's current organization.
  // Already org_shared is a 200 with no write, so a repeat does not move the organization
  // or touch the share token. The conditional update lets concurrent requests both succeed.
  async shareWithOrganization(request: HeaderSource, id: string, readBody: () => unknown): Promise<ArtifactDto> {
    const actor = await this.actors.requireActor(request);
    const record = await this.artifacts.findById(id);
    if (!record || actor.user.id !== record.creatorUserId) {
      throw artifactNotFound();
    }
    readShareWithOrganizationBody(readBody());
    if (record.accessType === "org_shared") {
      return this.toDto(record, !this.actors.hasCredentialHeader(request));
    }
    if (actor.organization === null) {
      throw new ApiErrorException(
        400,
        "ORGANIZATION_REQUIRED",
        "Organization sharing requires membership in an organization.",
      );
    }
    await this.artifacts.shareWithOrganization({
      id: record.id,
      creatorUserId: actor.user.id,
      organizationId: actor.organization.id,
    });
    const current = await this.artifacts.findById(record.id);
    if (!current || current.creatorUserId !== actor.user.id) {
      throw artifactNotFound();
    }
    if (current.accessType !== "org_shared") {
      throw new ApiErrorException(500, "INTERNAL_ERROR", "An unexpected error occurred.");
    }
    return this.toDto(current, !this.actors.hasCredentialHeader(request));
  }

  async list(request: HeaderSource, view: ArtifactView): Promise<ArtifactDto[]> {
    const actor = await this.actors.requireActor(request);
    const records = await this.artifacts.list({
      view,
      userId: actor.user.id,
      organizationId: actor.organization?.id ?? null,
    });
    return records.map((record) => this.toDto(record, false));
  }

  async shareState(request: HeaderSource, id: string): Promise<ShareState> {
    return this.toShareState(await this.requireOwner(request, id));
  }

  async createShare(request: HeaderSource, id: string, readBody: () => unknown): Promise<ShareState> {
    const owned = await this.requireOwner(request, id);
    const input = readCreateShareInput(readBody());
    const passwordHash = input.password === undefined ? undefined : await hashSharePassword(input.password);
    return this.toShareState(await this.ensureShare(request, owned, passwordHash));
  }

  async removeSharePassword(request: HeaderSource, id: string): Promise<ShareState> {
    const record = await this.requireOwner(request, id);
    if (!this.readShareToken(record) || !record.shareTokenHash || !record.sharePasswordHash) {
      return this.toShareState(record);
    }
    const updated = await this.artifacts.clearSharePassword(record.id, record.shareTokenHash);
    return this.toShareState(updated ?? (await this.requireOwner(request, id)));
  }

  private async ensureShare(
    request: HeaderSource,
    record: ArtifactRecord,
    passwordHash?: string,
  ): Promise<ArtifactRecord> {
    if (this.readShareToken(record) && record.shareTokenHash) {
      if (passwordHash === undefined) {
        return record;
      }
      const updated = await this.artifacts.setSharePassword(record.id, record.shareTokenHash, passwordHash);
      if (!updated) {
        throw new ApiErrorException(500, "INTERNAL_ERROR", "An unexpected error occurred.");
      }
      return updated;
    }
    if (record.shareTokenHash) {
      await this.artifacts.clearShare(record.id);
    }
    const token = createShareToken();
    let saved: ArtifactRecord | null;
    try {
      saved = await this.artifacts.saveShare(
        record.id,
        encryptShareToken(token, this.shareKey(), record.id),
        hashShareToken(token),
        passwordHash ?? null,
      );
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown";
      this.logger.error(`Could not store a public share (${code}).`);
      throw new ApiErrorException(500, "INTERNAL_ERROR", "An unexpected error occurred.");
    }
    if (!saved?.shareToken) {
      const current = await this.requireOwner(request, record.id);
      if (current.shareToken && current.shareTokenHash) {
        if (passwordHash === undefined) {
          return current;
        }
        const updated = await this.artifacts.setSharePassword(current.id, current.shareTokenHash, passwordHash);
        if (!updated) {
          throw new ApiErrorException(500, "INTERNAL_ERROR", "An unexpected error occurred.");
        }
        return updated;
      }
      throw new ApiErrorException(500, "INTERNAL_ERROR", "An unexpected error occurred.");
    }
    return saved;
  }

  async revokeShare(request: HeaderSource, id: string): Promise<ShareState> {
    const record = await this.requireOwner(request, id);
    if (!record.shareTokenHash) {
      return { shared: false, shareUrl: null, passwordProtected: false };
    }
    return this.toShareState(await this.artifacts.clearShare(record.id));
  }

  async openPublic(id: string, token: string, clientIp: string | null, grant: unknown): Promise<PublicArtifact> {
    this.chargePublicView(clientIp, "view");
    const record = await this.findPublic(id, token);
    const scope = this.grantScope(record);
    if (scope && !shareGrantAllows(grant, scope, this.grantKey())) {
      throw passwordRequired();
    }
    return publicArtifactSchema.parse({
      id: record.id,
      filename: artifactObjectKey(record.id),
      name: record.name,
      mimeType: "text/html",
      sizeBytes: record.sizeBytes,
      uploadedAt: record.uploadedAt.toISOString(),
      contentUrl: scope
        ? ticketedContentUrl(this.config.apiPublicOrigin, record.id, token, mintShareTicket(scope, this.grantKey()))
        : publicContentUrl(this.config.apiPublicOrigin, record.id, token),
      passwordProtected: scope !== null,
    });
  }

  async openPublicContent(
    id: string,
    token: string,
    clientIp: string | null,
    ticket: unknown,
  ): Promise<Extract<OpenedArtifactContent, { format: "html" }>> {
    this.chargePublicView(clientIp, "content");
    const record = await this.findPublic(id, token);
    const scope = this.grantScope(record);
    if (scope) {
      const redeemable = readShareTicket(ticket, scope, this.grantKey());
      if (!redeemable || !this.tickets.redeem(redeemable.nonce, redeemable.expiresAtMs)) {
        throw passwordRequired();
      }
    }
    const pointer = this.contentPointer(record);
    let stored: { body: AsyncIterable<Uint8Array> };
    try {
      stored = await this.blobs.get(pointer.objectKey);
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        throw artifactNotFound();
      }
      throw error;
    }
    return { format: "html", sizeBytes: pointer.sizeBytes, body: stored.body };
  }

  // Invalid bodies are rejected before any bucket is touched. The client failure budget is
  // reserved before lookup and refunded after a match or an infrastructure error. An in-flight
  // share check is reserved before Argon2 so concurrent wrongs cannot overshoot the confirmed
  // cap; a match or server error releases it, and a wrong password converts it to a confirmed
  // failure. Exhausted confirmed failures are 429 with no hash work. When the cap still has
  // room but every remaining slot is in flight, unlock is 503 like a saturated gate and still
  // spends the per-IP verify budget. Every verify spends that budget; a saturated gate keeps
  // the charge. Recent confirmed failures add a short delay before verify, not a rejection.
  // The process-wide gate is held only around Argon2.
  async unlockPublic(
    id: string,
    token: string,
    clientIp: string | null,
    readBody: () => unknown,
  ): Promise<PublicUnlockEnvelope> {
    const password = readUnlockPassword(readBody());
    const clientCharge = this.passwordAttempts.reserveClient(clientIp);
    if (!clientCharge) {
      throw tooManyPasswordAttempts(this.passwordAttempts.clientRetryAfterSeconds(clientIp));
    }
    let record: ArtifactRecord & { uploadedAt: Date };
    try {
      record = await this.findPublic(id, token);
    } catch (error) {
      if (!(error instanceof ApiErrorException && error.status === 404)) {
        this.passwordAttempts.refundClient(clientCharge);
      }
      throw error;
    }
    const scope = this.grantScope(record);
    if (!scope || !record.sharePasswordHash || !record.shareTokenHash) {
      this.passwordAttempts.refundClient(clientCharge);
      return { grant: null };
    }
    const shareTokenHash = record.shareTokenHash;
    const delayMs = this.passwordAttempts.shareDelayMs(shareTokenHash);
    const admission = this.passwordAttempts.beginShareCheck(shareTokenHash);
    if (admission === "locked") {
      this.passwordAttempts.refundClient(clientCharge);
      throw tooManyPasswordAttempts(this.passwordAttempts.shareRetryAfterSeconds(shareTokenHash));
    }
    if (admission === "busy") {
      if (!this.passwordAttempts.reserveVerify(clientIp)) {
        this.passwordAttempts.refundClient(clientCharge);
        throw tooManyPasswordAttempts(this.passwordAttempts.verifyRetryAfterSeconds(clientIp));
      }
      this.passwordAttempts.refundClient(clientCharge);
      throw unlockBusy();
    }
    if (!this.passwordAttempts.reserveVerify(clientIp)) {
      this.passwordAttempts.releaseShareCheck(shareTokenHash);
      this.passwordAttempts.refundClient(clientCharge);
      throw tooManyPasswordAttempts(this.passwordAttempts.verifyRetryAfterSeconds(clientIp));
    }
    try {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (!this.passwordAttempts.tryBeginVerify(clientIp)) {
        throw tooManyPasswordAttempts(1);
      }
      try {
        if (!argon2VerifyGate.tryAcquire()) {
          throw unlockBusy();
        }
        try {
          if (!(await verifySharePassword(password, record.sharePasswordHash))) {
            throw new ApiErrorException(401, "PASSWORD_INCORRECT", "That password is not right.");
          }
          this.passwordAttempts.releaseShareCheck(shareTokenHash);
          this.passwordAttempts.refundClient(clientCharge);
          const grant = mintShareGrant(scope, this.grantKey());
          return { grant: { token: grant.token, expiresAt: grant.expiresAt.toISOString() } };
        } finally {
          argon2VerifyGate.release();
        }
      } finally {
        this.passwordAttempts.endVerify(clientIp);
      }
    } catch (error) {
      if (error instanceof ApiErrorException && error.status === 401) {
        this.passwordAttempts.confirmShareFailure(shareTokenHash);
      } else {
        this.passwordAttempts.releaseShareCheck(shareTokenHash);
        this.passwordAttempts.refundClient(clientCharge);
      }
      throw error;
    }
  }

  framingOrigins(): readonly string[] {
    return browserOrigins(this.config.webOrigin, this.config.publicBaseUrl);
  }

  async getById(request: HeaderSource, id: string): Promise<ArtifactDto> {
    const record = await this.requireReadable(request, id, undefined, "html");
    return this.toDto(record, !this.actors.hasCredentialHeader(request));
  }

  async openContent(request: HeaderSource, id: string, format: ContentFormat, accessToken: unknown): Promise<OpenedArtifactContent> {
    const record = await this.requireReadable(request, id, accessToken, format);
    const pointer = this.contentPointer(record);
    let stored: { body: AsyncIterable<Uint8Array> };
    try {
      stored = await this.blobs.get(pointer.objectKey);
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        throw artifactNotFound();
      }
      throw error;
    }
    if (format === "html") {
      return { format: "html", sizeBytes: pointer.sizeBytes, body: stored.body };
    }

    try {
      const bytes = await readBoundedHtml(stored.body);
      const markdown = await convertHtmlToMarkdown(decodeUtf8(bytes));
      return { format: "markdown", body: Buffer.from(markdown, "utf8") };
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        throw artifactNotFound();
      }
      if (error instanceof BlobStoreUnavailableError || error instanceof ApiErrorException) {
        throw error;
      }
      const conversion = markdownConversionError(error);
      if (conversion) {
        throw conversion;
      }
      this.logger.error("Could not convert artifact HTML to Markdown");
      this.logger.error(error instanceof Error ? error.message : "Unknown conversion error");
      throw new ApiErrorException(500, "INTERNAL_ERROR", "An unexpected error occurred.");
    }
  }

  private async requireReadable(
    request: HeaderSource,
    id: string,
    accessToken: unknown,
    format: ContentFormat,
  ): Promise<ArtifactRecord> {
    const record = await this.artifacts.findById(id);
    if (!record) {
      throw artifactNotFound();
    }
    if (this.grantCanRead(request, accessToken, record.id, format)) {
      return record;
    }
    const actor = await this.actors.resolve(request);
    if (!actor || !(await this.canRead(actor, record))) {
      throw artifactNotFound();
    }
    return record;
  }

  private async requireOwner(request: HeaderSource, id: string): Promise<ArtifactRecord> {
    const actor = await this.actors.requireActor(request);
    const record = await this.artifacts.findById(id);
    if (!record || actor.user.id !== record.creatorUserId) {
      throw artifactNotFound();
    }
    return record;
  }

  private chargePublicView(clientIp: string | null, kind: "view" | "content"): void {
    const allowed = kind === "view" ? this.publicViews.allow(clientIp) : this.publicViews.allowContent(clientIp);
    if (!allowed) {
      throw new ApiErrorException(429, "RATE_LIMITED", "Too many requests. Try again later.");
    }
  }

  private async findPublic(id: string, token: string): Promise<ArtifactRecord & { uploadedAt: Date }> {
    if (!isArtifactId(id) || !isShareToken(token)) {
      throw artifactNotFound();
    }
    const record = await this.artifacts.findShared(id, hashShareToken(token));
    if (
      !record
      || record.mimeType !== "text/html"
      || record.uploadedAt === null
      || this.readShareToken(record) !== token
    ) {
      throw artifactNotFound();
    }
    return { ...record, uploadedAt: record.uploadedAt };
  }

  private shareKey(): Buffer {
    return deriveShareTokenKey(this.config.shareTokenKey ?? this.config.authSecret);
  }

  private grantKey(): Buffer {
    return deriveShareGrantKey(this.config.shareTokenKey ?? this.config.authSecret);
  }

  private grantScope(record: ArtifactRecord): ShareGrantScope | null {
    if (!record.sharePasswordHash || !record.shareTokenHash) {
      return null;
    }
    return {
      artifactId: record.id,
      shareTokenHash: record.shareTokenHash,
      passwordFingerprint: sharePasswordFingerprint(record.sharePasswordHash),
    };
  }

  private readShareToken(record: ArtifactRecord): string | null {
    if (!record.shareToken || !record.shareTokenHash) {
      return null;
    }
    const token = decryptShareToken(record.shareToken, this.shareKey(), record.id);
    if (!token || !isShareToken(token) || hashShareToken(token) !== record.shareTokenHash) {
      return null;
    }
    return token;
  }

  private toShareState(record: ArtifactRecord): ShareState {
    const token = this.readShareToken(record);
    if (!token) {
      return shareStateSchema.parse({ shared: false, shareUrl: null, passwordProtected: false });
    }
    return shareStateSchema.parse({
      shared: true,
      shareUrl: artifactShareUrl(this.config.publicBaseUrl, record.id, token),
      passwordProtected: record.sharePasswordHash !== null,
      ...(record.sharePasswordHash && record.shareTokenHash && !this.passwordAttempts.shareHasRoom(record.shareTokenHash)
        ? { guessesLockedOut: true }
        : {}),
    });
  }

  private grantCanRead(request: HeaderSource, accessToken: unknown, artifactId: string, format: ContentFormat): boolean {
    if (format !== "html" || this.actors.hasCredentialHeader(request)) {
      return false;
    }
    return this.grantAllows(accessToken, artifactId);
  }

  private grantAllows(accessToken: unknown, artifactId: string): boolean {
    return typeof accessToken === "string" && accessToken.length > 0 && contentGrantAllows(accessToken, artifactId, this.config.authSecret);
  }

  private async canRead(actor: Actor, record: ArtifactRecord): Promise<boolean> {
    if (actor.user.id === record.creatorUserId) {
      return true;
    }
    if (record.accessType !== "org_shared" || record.organizationId === null) {
      return false;
    }
    const membership = await this.prisma.member.findFirst({
      where: { userId: actor.user.id, organizationId: record.organizationId },
      select: { id: true },
    });
    return membership !== null;
  }

  private toDto(record: ArtifactRecord, includeGrant: boolean): ArtifactDto {
    if (record.uploadedAt === null || record.mimeType !== "text/html") {
      throw new ApiErrorException(500, "INTERNAL_ERROR", "An unexpected error occurred.");
    }
    if (record.accessType !== "private" && record.accessType !== "org_shared") {
      throw new ApiErrorException(500, "INTERNAL_ERROR", "An unexpected error occurred.");
    }

    return artifactDtoSchema.parse({
      id: record.id,
      creatorUserId: record.creatorUserId,
      organizationId: record.organizationId,
      accessType: record.accessType,
      // The public filename stays `{id}.html`. name is the library label.
      filename: artifactObjectKey(record.id),
      name: record.name,
      mimeType: "text/html",
      sizeBytes: record.sizeBytes,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      uploadedAt: record.uploadedAt.toISOString(),
      viewerUrl: artifactViewerUrl(this.config.publicBaseUrl, record.id),
      ...this.shareFlags(record),
      contentUrl: includeGrant
        ? grantedContentUrl(this.config.apiPublicOrigin, record.id, this.config.authSecret)
        : artifactContentUrl(this.config.apiPublicOrigin, record.id),
    });
  }

  private shareFlags(record: ArtifactRecord): { shared: boolean; passwordProtected: boolean } {
    const shared = this.readShareToken(record) !== null;
    return { shared, passwordProtected: shared && record.sharePasswordHash !== null };
  }

  // Writes a new object, then points the row at it only if the revision is unchanged.
  // A name sent with this request is set in that same update. Omitting it leaves the column.
  // A lost storage acknowledgement deletes that object when it can and leaves the row alone.
  // A commit that returns false lost the revision. The response is 409 and the name was not written.
  // A commit that returns true is this request's write. The response is 200 even if a later
  // replace has moved the pointer since.
  // A commit that throws has an unknown outcome. The new object stays, because the
  // transaction can still land after a read of the previous key. When that read already
  // shows this request's object, the name landed with it and the response is 200.
  private async publishReplacement(record: ArtifactRecord, bytes: Uint8Array, name?: string): Promise<ArtifactRecord> {
    const previousKey = storedObjectKey(record.id, record.objectKey);
    const newKey = immutableContentKey(record.id, randomUUID());
    const uploadedAt = new Date();
    try {
      await this.blobs.put({
        objectKey: newKey,
        body: bytes,
        contentType: "text/html",
      });
    } catch (error) {
      await this.deleteStoredQuietly(newKey);
      throw error;
    }

    let committed = false;
    try {
      committed = await this.artifacts.commitContent({
        id: record.id,
        expectedRevision: record.contentRevision,
        objectKey: newKey,
        sizeBytes: bytes.byteLength,
        uploadedAt,
        ...(name === undefined ? {} : { name }),
      });
    } catch (error) {
      const visible = await this.visibleObjectKey(record.id);
      if (visible === newKey && previousKey !== newKey) {
        await this.deleteStoredQuietly(previousKey);
        const landed = await this.artifacts.findById(record.id);
        if (landed?.objectKey === newKey) {
          return landed;
        }
      }
      throw error;
    }

    const current = await this.artifacts.findById(record.id);
    if (committed && current) {
      if (previousKey !== newKey && current.objectKey !== previousKey) {
        await this.deleteStoredQuietly(previousKey);
      }
      return current;
    }

    const decision = decideContentPublish({
      newKey,
      previousKey,
      visibleKey: current?.objectKey ?? null,
    });
    if (decision.outcome === "published" && current && current.objectKey === newKey) {
      if (decision.deleteKey) {
        await this.deleteStoredQuietly(decision.deleteKey);
      }
      return current;
    }
    if (decision.deleteKey) {
      await this.deleteStoredQuietly(decision.deleteKey);
    }
    if (!current) {
      throw artifactNotFound();
    }
    throw contentConflict();
  }

  private contentPointer(record: ArtifactRecord): { objectKey: string; sizeBytes: number } {
    const objectKey = storedObjectKey(record.id, record.objectKey);
    const legacy = artifactObjectKey(record.id);
    if (objectKey !== legacy && !objectKey.startsWith(`${record.id}/`)) {
      throw new ApiErrorException(500, "INTERNAL_ERROR", "An unexpected error occurred.");
    }
    return { objectKey, sizeBytes: record.sizeBytes };
  }

  private async visibleObjectKey(id: string): Promise<string | null | undefined> {
    try {
      const row = await this.artifacts.findById(id);
      return row?.objectKey ?? null;
    } catch (error) {
      this.logger.error("Could not read an artifact after a content replace");
      this.logger.error(error instanceof Error ? error.message : "Unknown error");
      return undefined;
    }
  }

  // A failed delete leaves the object in the bucket. Those objects are not swept.
  private async deleteStoredQuietly(objectKey: string): Promise<void> {
    try {
      await this.blobs.delete(objectKey);
    } catch (error) {
      this.logger.error("Could not remove an object after a failed content replace");
      this.logger.error(error instanceof Error ? error.message : "Unknown error");
    }
  }

  private async deleteOrphan(id: string, objectKey: string): Promise<void> {
    try {
      const existing = await this.artifacts.findById(id);
      if (existing) {
        return;
      }
    } catch (error) {
      this.logger.error("Could not confirm whether a failed upload inserted an artifact row");
      this.logger.error(error instanceof Error ? error.message : "Unknown error");
      return;
    }

    try {
      await this.blobs.delete(objectKey);
    } catch (error) {
      this.logger.error("Could not remove an object after a failed upload");
      this.logger.error(error instanceof Error ? error.message : "Unknown error");
    }
  }
}

export type OpenedArtifactContent =
  | { format: "html"; sizeBytes: number; body: AsyncIterable<Uint8Array> }
  | { format: "markdown"; body: Buffer };

function artifactNotFound(): ApiErrorException {
  return new ApiErrorException(404, "ARTIFACT_NOT_FOUND", "Artifact was not found.");
}

function contentConflict(): ApiErrorException {
  return new ApiErrorException(
    409,
    "CONTENT_CONFLICT",
    "Another replace finished first. Upload again to replace the current content.",
  );
}

function passwordRequired(): ApiErrorException {
  return new ApiErrorException(401, "PASSWORD_REQUIRED", "This link needs a password.");
}

function tooManyPasswordAttempts(retryAfterSeconds = 1): ApiErrorException {
  return new ApiErrorException(
    429,
    "RATE_LIMITED",
    "Too many password attempts. Try again later.",
    Math.max(1, retryAfterSeconds),
  );
}

function unlockBusy(): ApiErrorException {
  return new ApiErrorException(503, "UNLOCK_UNAVAILABLE", "Password verification is busy. Try again.", 1);
}

function readShareWithOrganizationBody(body: unknown): void {
  const parsed = shareWithOrganizationRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiErrorException(400, "INVALID_REQUEST", SHARE_WITH_ORGANIZATION_REQUEST_MESSAGE);
  }
}

function readCreateShareInput(body: unknown): CreateShareRequest {
  if (body === undefined) {
    return {};
  }
  const parsed = createShareRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = issue?.path[0] === "password" && issue.code !== "invalid_type"
      ? `The password is invalid. ${issue.message}`
      : "Send an optional password string.";
    throw new ApiErrorException(400, "INVALID_REQUEST", message);
  }
  return parsed.data;
}

function readUnlockPassword(body: unknown): string {
  const parsed = publicUnlockRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiErrorException(400, "INVALID_REQUEST", "Send the password as a string.");
  }
  return parsed.data.password;
}

function isArtifactId(value: string): boolean {
  return artifactDtoSchema.shape.id.safeParse(value).success;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ApiErrorException(400, "INVALID_REQUEST", "Artifact HTML is not valid UTF-8.");
  }
}

function markdownConversionError(error: unknown): ApiErrorException | undefined {
  if (!(error instanceof HtmlConversionError) || error.limit === undefined) {
    return undefined;
  }
  if (error.limit === "input") {
    return new ApiErrorException(413, "CONTENT_TOO_LARGE", "HTML exceeds the Markdown conversion limit.");
  }
  if (error.limit === "time") {
    return new ApiErrorException(422, "CONTENT_TOO_COMPLEX", "HTML took too long to convert to Markdown.");
  }
  if (error.limit === "memory") {
    return new ApiErrorException(422, "CONTENT_TOO_COMPLEX", "HTML used too much memory to convert to Markdown.");
  }
  if (error.limit === "output") {
    return new ApiErrorException(422, "CONTENT_TOO_COMPLEX", "Markdown output exceeds the conversion limit.");
  }
  if (error.limit === "busy") {
    return new ApiErrorException(503, "CONVERSION_UNAVAILABLE", "Markdown conversion is busy. Try again.");
  }
  return new ApiErrorException(422, "CONTENT_TOO_COMPLEX", "HTML is too complex to convert to Markdown.");
}

function formFields(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {};
  }
  return body as Record<string, unknown>;
}

function assertNoIdentityFields(body: Record<string, unknown>): void {
  for (const field of IDENTITY_FIELDS) {
    if (Object.hasOwn(body, field)) {
      throw new ApiErrorException(400, "INVALID_REQUEST", "Creator and organization are assigned by the server.");
    }
  }
}

function readSubmittedName(fields: Record<string, unknown>): string | undefined {
  if (!Object.hasOwn(fields, "name")) {
    return undefined;
  }
  if (typeof fields.name !== "string") {
    throw new ApiErrorException(400, "INVALID_REQUEST", ARTIFACT_NAME_MESSAGE);
  }
  const name = normalizeArtifactName(fields.name);
  if (name === null) {
    throw new ApiErrorException(400, "INVALID_REQUEST", ARTIFACT_NAME_MESSAGE);
  }
  return name;
}

function readAccessType(body: Record<string, unknown>): AccessType {
  if (!Object.hasOwn(body, "accessType")) {
    return "private";
  }
  const parsed = accessTypeSchema.safeParse(body.accessType);
  if (!parsed.success) {
    throw new ApiErrorException(400, "INVALID_REQUEST", "accessType must be private or org_shared.");
  }
  return parsed.data;
}

function readUpload(file: unknown): { filename: string; bytes: Uint8Array } | undefined {
  if (typeof file !== "object" || file === null) {
    return undefined;
  }
  const record = file as { originalname?: unknown; buffer?: unknown };
  if (typeof record.originalname !== "string" || !Buffer.isBuffer(record.buffer)) {
    return undefined;
  }
  return {
    // The multipart parser already decoded this filename. Do not percent-decode it again.
    filename: record.originalname,
    bytes: Uint8Array.from(record.buffer),
  };
}
