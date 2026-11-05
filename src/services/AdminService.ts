import * as SDK from "azure-devops-extension-sdk";
import {
  CommonServiceIds,
  IExtensionDataService,
  IExtensionDataManager,
} from "azure-devops-extension-api";
import {
  AccessResult,
  AdminSettings,
  ADMIN_SETTINGS_COLLECTION,
  ADMIN_SETTINGS_DOC_ID,
} from "../models/interfaces";

/**
 * Access control for the extension.
 *
 * The authorized-user list is a single document in the Extension Data Service
 * (collection scope, so it is shared by everyone in the organization). There is
 * no built-in default admin: on the very first run, when no list exists yet,
 * the current user is recorded as the first admin. From then on the Admin tab
 * governs who has access, and the last remaining admin can never be removed.
 */

let dataManagerCache: IExtensionDataManager | null = null;

async function getDataManager(): Promise<IExtensionDataManager> {
  if (dataManagerCache) return dataManagerCache;

  const dataService = await SDK.getService<IExtensionDataService>(
    CommonServiceIds.ExtensionDataService
  );
  const accessToken = await SDK.getAccessToken();
  const extensionContext = SDK.getExtensionContext();
  dataManagerCache = await dataService.getExtensionDataManager(extensionContext.id, accessToken);
  return dataManagerCache;
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/** Coerce whatever is stored into a well-formed settings object. */
function normalizeSettings(doc: unknown): AdminSettings {
  const raw = (doc ?? {}) as Partial<AdminSettings>;
  const emails = Array.isArray(raw.authorizedEmails)
    ? raw.authorizedEmails.filter((e): e is string => typeof e === "string" && e.trim() !== "")
    : [];
  return { ...raw, id: ADMIN_SETTINGS_DOC_ID, authorizedEmails: emails };
}

/**
 * Read the stored settings, or null when no list has been created yet.
 *
 * Uses the data service's `defaultValue` option so that a missing document is
 * distinguishable from a failed request: a network or permission error still
 * rejects instead of being mistaken for "first run".
 */
export async function loadAdminSettings(): Promise<AdminSettings | null> {
  const manager = await getDataManager();
  const doc = await manager.getDocument(ADMIN_SETTINGS_COLLECTION, ADMIN_SETTINGS_DOC_ID, {
    defaultValue: null,
  });
  if (doc === null || doc === undefined) return null;
  return normalizeSettings(doc);
}

/** Read the stored settings, treating "no list yet" as an empty list. */
export async function getAdminSettings(): Promise<AdminSettings> {
  const stored = await loadAdminSettings();
  return stored ?? { id: ADMIN_SETTINGS_DOC_ID, authorizedEmails: [] };
}

export async function saveAdminSettings(settings: AdminSettings): Promise<void> {
  const manager = await getDataManager();
  await manager.setDocument(ADMIN_SETTINGS_COLLECTION, {
    ...settings,
    id: ADMIN_SETTINGS_DOC_ID,
  });
}

export async function addAuthorizedUser(email: string): Promise<AdminSettings> {
  const settings = await getAdminSettings();
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error("Email cannot be empty");
  if (settings.authorizedEmails.map(normalizeEmail).includes(normalized)) {
    return settings; // Already authorized
  }
  settings.authorizedEmails.push(normalized);
  await saveAdminSettings(settings);
  return settings;
}

export async function removeAuthorizedUser(email: string): Promise<AdminSettings> {
  const settings = await getAdminSettings();
  const normalized = normalizeEmail(email);
  const remaining = settings.authorizedEmails.filter((e) => normalizeEmail(e) !== normalized);
  if (remaining.length === settings.authorizedEmails.length) {
    return settings; // Nothing to remove
  }
  if (remaining.length === 0) {
    throw new Error("Cannot remove the last admin");
  }
  settings.authorizedEmails = remaining;
  await saveAdminSettings(settings);
  return settings;
}

export async function isUserAuthorized(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const settings = await getAdminSettings();
  return settings.authorizedEmails.some((e) => normalizeEmail(e) === normalized);
}

/**
 * Check whether the current user may use the extension, creating the
 * authorized-user list with them as the first admin if none exists yet.
 *
 * The first-run write uses `createDocument`, which fails if the document already
 * exists, so two people opening the extension at the same moment cannot
 * overwrite each other: the loser re-reads the list and is checked against it.
 */
export async function resolveAccess(email: string): Promise<AccessResult> {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { authorized: false, bootstrapped: false };
  }

  const stored = await loadAdminSettings();
  if (stored !== null) {
    return {
      authorized: stored.authorizedEmails.some((e) => normalizeEmail(e) === normalized),
      bootstrapped: false,
    };
  }

  const manager = await getDataManager();
  try {
    await manager.createDocument(ADMIN_SETTINGS_COLLECTION, {
      id: ADMIN_SETTINGS_DOC_ID,
      authorizedEmails: [normalized],
    });
    return { authorized: true, bootstrapped: true };
  } catch {
    // Someone else created the list first; defer to it.
    const current = await getAdminSettings();
    return {
      authorized: current.authorizedEmails.some((e) => normalizeEmail(e) === normalized),
      bootstrapped: false,
    };
  }
}

/** Reset cache — useful for testing */
export function __resetDataManagerCache(): void {
  dataManagerCache = null;
}
