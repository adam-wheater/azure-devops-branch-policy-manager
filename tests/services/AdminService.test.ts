import {
  getAdminSettings,
  loadAdminSettings,
  saveAdminSettings,
  addAuthorizedUser,
  removeAuthorizedUser,
  isUserAuthorized,
  resolveAccess,
  __resetDataManagerCache,
} from "@/services/AdminService";
import { ADMIN_SETTINGS_COLLECTION, ADMIN_SETTINGS_DOC_ID } from "@/models/interfaces";
import { __setMockService, __resetMockServices } from "../__mocks__/azure-devops-extension-sdk";
import { CommonServiceIds, IDocumentOptions } from "../__mocks__/azure-devops-extension-api";

const ADMIN = "admin@contoso.com";
const OTHER = "dev@fabrikam.com";

// In-memory document store for testing
let documents: Record<string, any> = {};

const mockDataManager = {
  getDocument: jest.fn(async (_collection: string, id: string, options?: IDocumentOptions) => {
    if (documents[id]) return documents[id];
    if (options && "defaultValue" in options) return options.defaultValue;
    throw new Error("Document not found");
  }),
  createDocument: jest.fn(async (_collection: string, doc: any) => {
    if (documents[doc.id]) throw new Error("Document already exists");
    documents[doc.id] = doc;
    return doc;
  }),
  setDocument: jest.fn(async (_collection: string, doc: any) => {
    documents[doc.id] = doc;
    return doc;
  }),
};

const mockDataService = {
  getExtensionDataManager: jest.fn(async () => mockDataManager),
};

function seed(...emails: string[]) {
  documents[ADMIN_SETTINGS_DOC_ID] = { id: ADMIN_SETTINGS_DOC_ID, authorizedEmails: emails };
}

beforeEach(() => {
  documents = {};
  __resetMockServices();
  __resetDataManagerCache();
  __setMockService(CommonServiceIds.ExtensionDataService, mockDataService);
  jest.clearAllMocks();
});

describe("AdminService", () => {
  describe("loadAdminSettings", () => {
    it("returns null when no document exists", async () => {
      expect(await loadAdminSettings()).toBeNull();
    });

    it("propagates real read failures instead of treating them as first run", async () => {
      mockDataManager.getDocument.mockRejectedValueOnce(new Error("401 Unauthorized"));
      await expect(loadAdminSettings()).rejects.toThrow("401 Unauthorized");
    });

    it("normalizes a malformed stored document", async () => {
      documents[ADMIN_SETTINGS_DOC_ID] = { id: ADMIN_SETTINGS_DOC_ID, authorizedEmails: "oops" };
      const settings = await loadAdminSettings();
      expect(settings?.authorizedEmails).toEqual([]);
    });
  });

  describe("getAdminSettings", () => {
    it("returns an empty list when no document exists", async () => {
      const settings = await getAdminSettings();
      expect(settings.authorizedEmails).toEqual([]);
      expect(settings.id).toBe(ADMIN_SETTINGS_DOC_ID);
    });

    it("returns stored settings when document exists", async () => {
      seed(ADMIN, OTHER);
      const settings = await getAdminSettings();
      expect(settings.authorizedEmails).toHaveLength(2);
      expect(settings.authorizedEmails).toContain(OTHER);
    });
  });

  describe("saveAdminSettings", () => {
    it("persists settings to the document store", async () => {
      await saveAdminSettings({
        id: ADMIN_SETTINGS_DOC_ID,
        authorizedEmails: ["a@contoso.com", "c@fabrikam.com"],
      });

      expect(mockDataManager.setDocument).toHaveBeenCalledWith(
        ADMIN_SETTINGS_COLLECTION,
        expect.objectContaining({
          id: ADMIN_SETTINGS_DOC_ID,
          authorizedEmails: ["a@contoso.com", "c@fabrikam.com"],
        })
      );
    });
  });

  describe("addAuthorizedUser", () => {
    it("adds a new email to the list", async () => {
      seed(ADMIN);
      const result = await addAuthorizedUser("new@fabrikam.com");
      expect(result.authorizedEmails).toEqual([ADMIN, "new@fabrikam.com"]);
    });

    it("does not duplicate an existing email (case insensitive)", async () => {
      seed("existing@contoso.com");

      const result = await addAuthorizedUser("Existing@Contoso.com");
      expect(
        result.authorizedEmails.filter((e) => e.toLowerCase() === "existing@contoso.com")
      ).toHaveLength(1);
      expect(mockDataManager.setDocument).not.toHaveBeenCalled();
    });

    it("throws if email is empty", async () => {
      await expect(addAuthorizedUser("  ")).rejects.toThrow("Email cannot be empty");
    });

    it("normalizes email to lowercase", async () => {
      const result = await addAuthorizedUser("USER@CONTOSO.COM");
      expect(result.authorizedEmails).toContain("user@contoso.com");
    });
  });

  describe("removeAuthorizedUser", () => {
    it("removes a user from the list", async () => {
      seed(ADMIN, "remove@fabrikam.com");

      const result = await removeAuthorizedUser("remove@fabrikam.com");
      expect(result.authorizedEmails).toEqual([ADMIN]);
    });

    it("throws when removing the last remaining admin", async () => {
      seed(ADMIN);
      await expect(removeAuthorizedUser(ADMIN)).rejects.toThrow("Cannot remove the last admin");
      expect(documents[ADMIN_SETTINGS_DOC_ID].authorizedEmails).toEqual([ADMIN]);
    });

    it("is a no-op for an email that is not listed", async () => {
      seed(ADMIN);
      const result = await removeAuthorizedUser("nobody@fabrikam.com");
      expect(result.authorizedEmails).toEqual([ADMIN]);
      expect(mockDataManager.setDocument).not.toHaveBeenCalled();
    });

    it("is case insensitive when removing", async () => {
      seed(ADMIN, "User@Fabrikam.com");

      const result = await removeAuthorizedUser("user@fabrikam.com");
      expect(result.authorizedEmails).toEqual([ADMIN]);
    });
  });

  describe("isUserAuthorized", () => {
    it("returns false for everyone when no list exists", async () => {
      expect(await isUserAuthorized(ADMIN)).toBe(false);
    });

    it("returns true for a listed user (case insensitive)", async () => {
      seed(ADMIN, "allowed@fabrikam.com");
      expect(await isUserAuthorized("Allowed@Fabrikam.com")).toBe(true);
    });

    it("returns false for an unlisted user", async () => {
      seed(ADMIN);
      expect(await isUserAuthorized("random@fabrikam.com")).toBe(false);
    });

    it("returns false for an empty identity", async () => {
      seed(ADMIN);
      expect(await isUserAuthorized("")).toBe(false);
    });
  });

  describe("resolveAccess", () => {
    it("records the current user as the first admin when no list exists", async () => {
      const result = await resolveAccess("First.User@Contoso.com");
      expect(result).toEqual({ authorized: true, bootstrapped: true });
      expect(mockDataManager.createDocument).toHaveBeenCalledWith(
        ADMIN_SETTINGS_COLLECTION,
        expect.objectContaining({
          id: ADMIN_SETTINGS_DOC_ID,
          authorizedEmails: ["first.user@contoso.com"],
        })
      );
      expect(documents[ADMIN_SETTINGS_DOC_ID].authorizedEmails).toEqual(["first.user@contoso.com"]);
    });

    it("does not bootstrap once a list exists", async () => {
      seed(ADMIN);
      expect(await resolveAccess(ADMIN)).toEqual({ authorized: true, bootstrapped: false });
      expect(await resolveAccess(OTHER)).toEqual({ authorized: false, bootstrapped: false });
      expect(mockDataManager.createDocument).not.toHaveBeenCalled();
    });

    it("never records an empty identity as admin", async () => {
      expect(await resolveAccess("")).toEqual({ authorized: false, bootstrapped: false });
      expect(mockDataManager.createDocument).not.toHaveBeenCalled();
      expect(documents[ADMIN_SETTINGS_DOC_ID]).toBeUndefined();
    });

    it("defers to a list created concurrently by someone else", async () => {
      // The read sees no document, but by the time we create, another user has.
      mockDataManager.getDocument.mockImplementationOnce(async (_c, _id, options) => {
        seed(OTHER);
        return options?.defaultValue ?? null;
      });

      const result = await resolveAccess(ADMIN);
      expect(result).toEqual({ authorized: false, bootstrapped: false });
      expect(documents[ADMIN_SETTINGS_DOC_ID].authorizedEmails).toEqual([OTHER]);
    });

    it("propagates read failures rather than granting access", async () => {
      mockDataManager.getDocument.mockRejectedValueOnce(new Error("503 Service Unavailable"));
      await expect(resolveAccess(ADMIN)).rejects.toThrow("503 Service Unavailable");
      expect(mockDataManager.createDocument).not.toHaveBeenCalled();
    });
  });
});
