import {
  getReviewerPolicies,
  getReviewerPoliciesForBranch,
  addReviewerPolicy,
  removeReviewerPolicy,
  bulkAddPolicies,
  bulkRemovePolicies,
} from "@/services/PolicyService";
import { REQUIRED_REVIEWER_POLICY_TYPE_ID } from "@/models/interfaces";
import { __setMockClient, __resetMockClients } from "../__mocks__/azure-devops-extension-api";

let mockPolicies: any[] = [];
let nextId = 100;

const mockPolicyClient = {
  getPolicyConfigurations: jest.fn(async () => mockPolicies),
  getPolicyConfiguration: jest.fn(async (_project: string, id: number) => {
    const found = mockPolicies.find((p) => p.id === id);
    if (!found) throw new Error("Policy not found");
    return { ...found };
  }),
  createPolicyConfiguration: jest.fn(async (config: any) => {
    const created = { ...config, id: nextId++ };
    mockPolicies.push(created);
    return created;
  }),
  deletePolicyConfiguration: jest.fn(async (_project: string, id: number) => {
    mockPolicies = mockPolicies.filter((p) => p.id !== id);
  }),
  updatePolicyConfiguration: jest.fn(async (config: any) => config),
};

beforeEach(() => {
  mockPolicies = [];
  nextId = 100;
  __resetMockClients();
  __setMockClient("PolicyRestClient", mockPolicyClient);
  jest.clearAllMocks();
});

function createMockPolicy(
  id: number,
  repoId: string,
  branchRef: string,
  teamId: string,
  enabled = true,
  blocking = true
) {
  return {
    id,
    isEnabled: enabled,
    isBlocking: blocking,
    type: { id: REQUIRED_REVIEWER_POLICY_TYPE_ID },
    settings: {
      requiredReviewerIds: [teamId],
      minimumApproverCount: 1,
      scope: [
        {
          repositoryId: repoId,
          refName: branchRef,
          matchKind: "Exact",
        },
      ],
    },
  };
}

describe("PolicyService", () => {
  describe("getReviewerPolicies", () => {
    it("returns only reviewer-type policies", async () => {
      mockPolicies = [
        createMockPolicy(1, "repo-1", "refs/heads/develop", "team-1"),
        {
          id: 2,
          isEnabled: true,
          isBlocking: true,
          type: { id: "other-policy-type" },
          settings: { scope: [] },
        },
      ];

      const result = await getReviewerPolicies("TestProject");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it("filters by repository when repoId is provided", async () => {
      mockPolicies = [
        createMockPolicy(1, "repo-1", "refs/heads/develop", "team-1"),
        createMockPolicy(2, "repo-2", "refs/heads/develop", "team-1"),
      ];

      const result = await getReviewerPolicies("TestProject", "repo-1");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it("returns all reviewer policies when no repoId provided", async () => {
      mockPolicies = [
        createMockPolicy(1, "repo-1", "refs/heads/develop", "team-1"),
        createMockPolicy(2, "repo-2", "refs/heads/main", "team-2"),
      ];

      const result = await getReviewerPolicies("TestProject");
      expect(result).toHaveLength(2);
    });
  });

  describe("getReviewerPoliciesForBranch", () => {
    it("returns policies matching exact repo and branch", async () => {
      mockPolicies = [
        createMockPolicy(1, "repo-1", "refs/heads/develop", "team-1"),
        createMockPolicy(2, "repo-1", "refs/heads/main", "team-1"),
        createMockPolicy(3, "repo-2", "refs/heads/develop", "team-1"),
      ];

      const result = await getReviewerPoliciesForBranch(
        "TestProject",
        "repo-1",
        "refs/heads/develop"
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it("includes policies with null scope (global)", async () => {
      mockPolicies = [
        {
          id: 1,
          isEnabled: true,
          isBlocking: true,
          type: { id: REQUIRED_REVIEWER_POLICY_TYPE_ID },
          settings: {
            requiredReviewerIds: ["team-1"],
            minimumApproverCount: 1,
            scope: [{ repositoryId: "repo-1", refName: null, matchKind: "Exact" }],
          },
        },
      ];

      const result = await getReviewerPoliciesForBranch(
        "TestProject",
        "repo-1",
        "refs/heads/develop"
      );
      expect(result).toHaveLength(1);
    });
  });

  describe("scope matching", () => {
    const withScope = (id: number, scope: any[]) => ({
      ...createMockPolicy(id, "x", "x", "team-1"),
      settings: { requiredReviewerIds: ["team-1"], minimumApproverCount: 1, scope },
    });

    it("lists project-wide and prefix policies for a branch", async () => {
      mockPolicies = [
        withScope(1, [{ repositoryId: null, refName: "refs/heads/main", matchKind: "Exact" }]),
        withScope(2, [
          { repositoryId: "repo-1", refName: "refs/heads/release/", matchKind: "Prefix" },
        ]),
        withScope(3, [
          { repositoryId: "repo-1", refName: "refs/heads/release/", matchKind: "Exact" },
        ]),
      ];

      const main = await getReviewerPoliciesForBranch("P", "repo-1", "refs/heads/main");
      const release = await getReviewerPoliciesForBranch("P", "repo-1", "refs/heads/release/2.3");
      expect(main.map((p) => p.id)).toEqual([1]);
      expect(release.map((p) => p.id)).toEqual([2]);
    });

    it("bulk remove leaves a policy that also covers another repo", async () => {
      mockPolicies = [
        withScope(1, [
          { repositoryId: "repo-1", refName: "refs/heads/main", matchKind: "Exact" },
          { repositoryId: "repo-2", refName: "refs/heads/main", matchKind: "Exact" },
        ]),
      ];

      const [result] = await bulkRemovePolicies("P", [
        {
          repoId: "repo-1",
          repoName: "r1",
          branchRef: "refs/heads/main",
          branchName: "main",
          teamId: "team-1",
          teamName: "T",
        },
      ]);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/#1 also covers/);
      expect(mockPolicyClient.deletePolicyConfiguration).not.toHaveBeenCalled();
    });
  });

  describe("addReviewerPolicy", () => {
    it("creates a new policy configuration", async () => {
      const result = await addReviewerPolicy(
        "TestProject",
        "repo-1",
        "refs/heads/develop",
        "team-1"
      );

      expect(mockPolicyClient.createPolicyConfiguration).toHaveBeenCalledTimes(1);
      expect(result.id).toBe(100);
      expect(result.requiredReviewerIds).toEqual(["team-1"]);
      expect(result.isBlocking).toBe(true);
    });

    it("passes correct scope", async () => {
      await addReviewerPolicy("TestProject", "repo-1", "refs/heads/main", "team-2");

      const callArgs = mockPolicyClient.createPolicyConfiguration.mock.calls[0][0];
      expect(callArgs.settings.scope).toEqual([
        {
          repositoryId: "repo-1",
          refName: "refs/heads/main",
          matchKind: "Exact",
        },
      ]);
    });

    it("supports optional blocking parameter", async () => {
      await addReviewerPolicy("TestProject", "repo-1", "refs/heads/develop", "team-1", false);

      const callArgs = mockPolicyClient.createPolicyConfiguration.mock.calls[0][0];
      expect(callArgs.isBlocking).toBe(false);
    });
  });

  describe("removeReviewerPolicy", () => {
    it("deletes a policy by ID", async () => {
      mockPolicies = [createMockPolicy(42, "repo-1", "refs/heads/develop", "team-1")];

      await removeReviewerPolicy("TestProject", 42);
      expect(mockPolicyClient.deletePolicyConfiguration).toHaveBeenCalledWith("TestProject", 42);
    });
  });

  describe("bulkAddPolicies", () => {
    it("creates policies for all operations", async () => {
      const operations = [
        {
          repoId: "repo-1",
          repoName: "Repo1",
          branchRef: "refs/heads/develop",
          branchName: "develop",
          teamId: "team-1",
          teamName: "Team1",
        },
        {
          repoId: "repo-1",
          repoName: "Repo1",
          branchRef: "refs/heads/main",
          branchName: "main",
          teamId: "team-1",
          teamName: "Team1",
        },
      ];

      const results = await bulkAddPolicies("TestProject", operations);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it("skips duplicates gracefully", async () => {
      mockPolicies = [createMockPolicy(1, "repo-1", "refs/heads/develop", "team-1")];

      const operations = [
        {
          repoId: "repo-1",
          repoName: "Repo1",
          branchRef: "refs/heads/develop",
          branchName: "develop",
          teamId: "team-1",
          teamName: "Team1",
        },
      ];

      const results = await bulkAddPolicies("TestProject", operations);
      expect(results[0].success).toBe(true);
      expect(results[0].error).toBe("Already exists");
    });

    it("reports progress via callback", async () => {
      const progress: { current: number; total: number }[] = [];
      const operations = [
        {
          repoId: "repo-1",
          repoName: "Repo1",
          branchRef: "refs/heads/develop",
          branchName: "develop",
          teamId: "team-1",
          teamName: "Team1",
        },
        {
          repoId: "repo-1",
          repoName: "Repo1",
          branchRef: "refs/heads/main",
          branchName: "main",
          teamId: "team-2",
          teamName: "Team2",
        },
      ];

      await bulkAddPolicies("TestProject", operations, true, 1, (current, total) => {
        progress.push({ current, total });
      });

      expect(progress).toEqual([
        { current: 1, total: 2 },
        { current: 2, total: 2 },
      ]);
    });

    it("handles errors without stopping the batch", async () => {
      mockPolicyClient.createPolicyConfiguration.mockRejectedValueOnce(new Error("API error"));

      const operations = [
        {
          repoId: "repo-1",
          repoName: "Repo1",
          branchRef: "refs/heads/develop",
          branchName: "develop",
          teamId: "team-1",
          teamName: "Team1",
        },
        {
          repoId: "repo-1",
          repoName: "Repo1",
          branchRef: "refs/heads/main",
          branchName: "main",
          teamId: "team-2",
          teamName: "Team2",
        },
      ];

      const results = await bulkAddPolicies("TestProject", operations);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe("API error");
      expect(results[1].success).toBe(true);
    });
  });

  describe("bulkRemovePolicies", () => {
    it("removes matching policies for each operation", async () => {
      mockPolicies = [
        createMockPolicy(1, "repo-1", "refs/heads/develop", "team-1"),
        createMockPolicy(2, "repo-1", "refs/heads/main", "team-1"),
      ];

      const operations = [
        {
          repoId: "repo-1",
          repoName: "Repo1",
          branchRef: "refs/heads/develop",
          branchName: "develop",
          teamId: "team-1",
          teamName: "Team1",
        },
      ];

      const results = await bulkRemovePolicies("TestProject", operations);
      expect(results[0].success).toBe(true);
      expect(mockPolicyClient.deletePolicyConfiguration).toHaveBeenCalledWith("TestProject", 1);
    });

    it("reports when no matching policy found", async () => {
      mockPolicies = [];

      const operations = [
        {
          repoId: "repo-1",
          repoName: "Repo1",
          branchRef: "refs/heads/develop",
          branchName: "develop",
          teamId: "team-1",
          teamName: "Team1",
        },
      ];

      const results = await bulkRemovePolicies("TestProject", operations);
      expect(results[0].success).toBe(true);
      expect(results[0].error).toBe("No matching policy found");
    });
  });
});
