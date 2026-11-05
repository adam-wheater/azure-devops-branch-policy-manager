export interface AdminSettings {
  id: string;
  authorizedEmails: string[];
}

/**
 * Outcome of the access check that runs when the extension loads.
 *
 * `bootstrapped` is true only on the very first run, when no authorized-user
 * list existed yet and the current user has just been recorded as the first
 * admin. The UI uses it to tell that user what happened.
 */
export interface AccessResult {
  authorized: boolean;
  bootstrapped: boolean;
}

export const ADMIN_SETTINGS_COLLECTION = "BranchPolicyManagerSettings";
export const ADMIN_SETTINGS_DOC_ID = "admin-settings";

export interface TeamInfo {
  id: string;
  name: string;
}

export interface RepoInfo {
  id: string;
  name: string;
}

export interface BranchInfo {
  name: string;
  /** The full ref path, e.g. refs/heads/develop */
  refName: string;
}

/** The Azure DevOps policy type ID for "Required reviewers" */
export const REQUIRED_REVIEWER_POLICY_TYPE_ID = "fd2167ab-b0be-447a-8571-0d4ce8d5dbe1";

export interface ReviewerPolicy {
  /** Policy configuration ID (used for updates/deletes) */
  id: number;
  /** Whether the policy is enabled */
  isEnabled: boolean;
  /** Whether the policy is blocking (required) */
  isBlocking: boolean;
  /** Branch ref pattern the policy applies to, e.g. refs/heads/develop */
  scope: PolicyScope[];
  /** The required reviewer IDs */
  requiredReviewerIds: string[];
  /** Minimum approver count */
  minimumApproverCount: number;
  /** Display name assembled from settings */
  displayName: string;
}

export interface PolicyScope {
  repositoryId: string | null;
  refName: string | null;
  matchKind: "Exact" | "Prefix" | "DefaultBranch";
}

export interface BulkOperation {
  repoId: string;
  repoName: string;
  branchRef: string;
  branchName: string;
  teamId: string;
  teamName: string;
}

export interface BulkOperationResult {
  operation: BulkOperation;
  success: boolean;
  error?: string;
}

// ── Repo classification types ──────────────────────────────────────

export type AppType = "function-app" | "container-app" | "web-app" | "unknown";

export type FunctionWorkerModel = "isolated" | "in-process" | "unknown";

export type ContainerEnvironment = "standard" | "workload" | "unknown";

export interface RepoClassification {
  repoId: string;
  repoName: string;
  /** Primary app type detected in the repo */
  appType: AppType;
  /** Only set when appType === "function-app" */
  functionWorkerModel?: FunctionWorkerModel;
  /** Only set when appType === "container-app" */
  containerEnvironment?: ContainerEnvironment;
}
