import { getCurrentUserEmail, getProjectName } from "@/services/IdentityService";
import {
  __setMockService,
  __resetMockServices,
  __setMockUser,
} from "../__mocks__/azure-devops-extension-sdk";
import { CommonServiceIds } from "../__mocks__/azure-devops-extension-api";

beforeEach(() => {
  __resetMockServices();
  __setMockUser("admin@contoso.com");
  jest.clearAllMocks();
});

describe("IdentityService", () => {
  describe("getCurrentUserEmail", () => {
    it("returns the current user email from SDK", async () => {
      const email = await getCurrentUserEmail();
      expect(email).toBe("admin@contoso.com");
    });

    it("returns updated email when mock changes", async () => {
      __setMockUser("dev@fabrikam.com");
      const email = await getCurrentUserEmail();
      expect(email).toBe("dev@fabrikam.com");
    });
  });

  describe("getProjectName", () => {
    it("returns the project name", async () => {
      __setMockService(CommonServiceIds.ProjectPageService, {
        getProject: async () => ({ id: "proj-1", name: "TestProject" }),
      });

      const name = await getProjectName();
      expect(name).toBe("TestProject");
    });

    it("throws when project is not found", async () => {
      __setMockService(CommonServiceIds.ProjectPageService, {
        getProject: async () => undefined,
      });

      await expect(getProjectName()).rejects.toThrow("Could not determine the current project");
    });
  });
});
