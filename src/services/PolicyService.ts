import { getClient } from "azure-devops-extension-api";
import { PolicyRestClient, PolicyConfiguration } from "azure-devops-extension-api/Policy";
import {
  ReviewerPolicy,
  REQUIRED_REVIEWER_POLICY_TYPE_ID,
  PolicyScope,
  BulkOperation,
  BulkOperationResult,
} from "../models/interfaces";

let _cachedReviewerPolicyTypeId: string | null = null;

/**
 * Dynamically resolves the "Required Reviewers" policy type ID by querying
 * available policy types from the server. Falls back to the well-known ID
 * if the API call fails or the type cannot be found.
 */
export async function resolveRequiredReviewerPolicyTypeId(projectName: string): Promise<string> {
  if (_cachedReviewerPolicyTypeId) return _cachedReviewerPolicyTypeId;

  try {
    const client = getClient(PolicyRestClient);
    const types = await client.getPolicyTypes(projectName);
    const reviewerType = types.find((t) => {
      const name = ((t as any).displayName || "").toLowerCase();
      return name.includes("required reviewer");
    });
    if (reviewerType) {
      _cachedReviewerPolicyTypeId = reviewerType.id;
      return _cachedReviewerPolicyTypeId;
    }
  } catch {
    // API call failed — fall back to well-known ID
  }

  return REQUIRED_REVIEWER_POLICY_TYPE_ID;
}

export async function getReviewerPolicies(
  projectName: string,
  repoId?: string
): Promise<ReviewerPolicy[]> {
  const client = getClient(PolicyRestClient);
  const typeId = await resolveRequiredReviewerPolicyTypeId(projectName);
  const configs = await client.getPolicyConfigurations(projectName);

  return configs
    .filter((c) => c.type.id === typeId)
    .filter((c) => {
      if (!repoId) return true;
      const scopes = c.settings?.scope as PolicyScope[] | undefined;
      return scopes?.some((s) => s.repositoryId == null || s.repositoryId === repoId);
    })
    .map((c) => mapToReviewerPolicy(c));
}

export async function getReviewerPoliciesForBranch(
  projectName: string,
  repoId: string,
  branchRef: string
): Promise<ReviewerPolicy[]> {
  const all = await getReviewerPolicies(projectName, repoId);
  return all.filter((p) => p.scope.some((s) => scopeCovers(s, repoId, branchRef)));
}

function scopeCovers(s: PolicyScope, repoId: string, branchRef: string): boolean {
  if (s.repositoryId != null && s.repositoryId !== repoId) return false;
  // No refName: the whole repo, or its default branch, which is not resolved here.
  if (!s.refName) return true;
  return s.matchKind?.toLowerCase() === "prefix"
    ? branchRef.startsWith(s.refName)
    : s.refName === branchRef;
}

/**
 * True when the policy covers this one branch and nothing else. Deleting any
 * other policy would also remove it from other branches or repositories.
 */
export function isOnlyForBranch(
  policy: ReviewerPolicy,
  repoId: string,
  branchRef: string
): boolean {
  const [s, ...rest] = policy.scope;
  return (
    rest.length === 0 &&
    s?.repositoryId === repoId &&
    s.refName === branchRef &&
    (s.matchKind ?? "Exact").toLowerCase() === "exact"
  );
}

export async function addReviewerPolicy(
  projectName: string,
  repoId: string,
  branchRef: string,
  teamId: string,
  isBlocking: boolean = true,
  minimumApproverCount: number = 1
): Promise<ReviewerPolicy> {
  const client = getClient(PolicyRestClient);
  const typeId = await resolveRequiredReviewerPolicyTypeId(projectName);

  const config = {
    isEnabled: true,
    isBlocking,
    type: { id: typeId },
    settings: {
      requiredReviewerIds: [teamId],
      minimumApproverCount,
      creatorVoteCounts: false,
      allowDownvotes: false,
      resetOnSourcePush: false,
      scope: [
        {
          repositoryId: repoId,
          refName: branchRef,
          matchKind: "Exact",
        },
      ],
    },
  } as unknown as PolicyConfiguration;

  const created = await client.createPolicyConfiguration(config, projectName);
  return mapToReviewerPolicy(created);
}

export async function removeReviewerPolicy(projectName: string, policyId: number): Promise<void> {
  const client = getClient(PolicyRestClient);
  await client.deletePolicyConfiguration(projectName, policyId);
}

export async function toggleReviewerPolicy(
  projectName: string,
  policyId: number,
  enabled: boolean
): Promise<ReviewerPolicy> {
  const client = getClient(PolicyRestClient);
  const existing = await client.getPolicyConfiguration(projectName, policyId);
  existing.isEnabled = enabled;
  const updated = await client.updatePolicyConfiguration(existing, projectName, policyId);
  return mapToReviewerPolicy(updated);
}

export async function bulkAddPolicies(
  projectName: string,
  operations: BulkOperation[],
  isBlocking: boolean = true,
  minimumApproverCount: number = 1,
  onProgress?: (current: number, total: number) => void
): Promise<BulkOperationResult[]> {
  const results: BulkOperationResult[] = [];

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    onProgress?.(i + 1, operations.length);

    try {
      // Check for existing policy to avoid duplicates
      const existing = await getReviewerPoliciesForBranch(projectName, op.repoId, op.branchRef);
      const alreadyExists = existing.some((p) => p.requiredReviewerIds.includes(op.teamId));

      if (alreadyExists) {
        results.push({ operation: op, success: true, error: "Already exists" });
        continue;
      }

      await addReviewerPolicy(
        projectName,
        op.repoId,
        op.branchRef,
        op.teamId,
        isBlocking,
        minimumApproverCount
      );
      results.push({ operation: op, success: true });
    } catch (err: any) {
      results.push({
        operation: op,
        success: false,
        error: err?.message || String(err),
      });
    }
  }

  return results;
}

export async function bulkRemovePolicies(
  projectName: string,
  operations: BulkOperation[],
  onProgress?: (current: number, total: number) => void
): Promise<BulkOperationResult[]> {
  const results: BulkOperationResult[] = [];

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    onProgress?.(i + 1, operations.length);

    try {
      const policies = await getReviewerPoliciesForBranch(projectName, op.repoId, op.branchRef);

      const matching = policies.filter((p) => p.requiredReviewerIds.includes(op.teamId));

      if (matching.length === 0) {
        results.push({ operation: op, success: true, error: "No matching policy found" });
        continue;
      }

      const shared = matching.filter((p) => !isOnlyForBranch(p, op.repoId, op.branchRef));
      for (const policy of matching) {
        if (!shared.includes(policy)) await removeReviewerPolicy(projectName, policy.id);
      }

      results.push(
        shared.length === 0
          ? { operation: op, success: true }
          : {
              operation: op,
              success: false,
              error: `Not removed: ${shared.map((p) => `#${p.id}`).join(", ")} also covers other branches or repositories`,
            }
      );
    } catch (err: any) {
      results.push({
        operation: op,
        success: false,
        error: err?.message || String(err),
      });
    }
  }

  return results;
}

function mapToReviewerPolicy(config: PolicyConfiguration): ReviewerPolicy {
  const settings = config.settings || {};
  const reviewerIds: string[] = settings.requiredReviewerIds || [];
  const scope: PolicyScope[] = settings.scope || [];

  return {
    id: config.id,
    isEnabled: config.isEnabled,
    isBlocking: config.isBlocking,
    scope,
    requiredReviewerIds: reviewerIds,
    minimumApproverCount: settings.minimumApproverCount || 1,
    displayName: `Reviewer policy #${config.id}`,
  };
}
