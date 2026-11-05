import * as React from "react";
import {
  TeamInfo,
  RepoInfo,
  BranchInfo,
  ReviewerPolicy,
  BulkOperation,
  BulkOperationResult,
  RepoClassification,
} from "../models/interfaces";
import {
  getTeams,
  getRepositories,
  getBranches,
  getProjectName,
} from "../services/IdentityService";
import {
  getReviewerPoliciesForBranch,
  addReviewerPolicy,
  removeReviewerPolicy,
  isOnlyForBranch,
  bulkAddPolicies,
  bulkRemovePolicies,
} from "../services/PolicyService";
import { classifyRepos } from "../services/RepoClassificationService";
import {
  Banner,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  IconTrash,
  Pill,
  Progress,
  Skeleton,
  Tone,
} from "./ui";

/** A pending action that needs the user's confirmation before it runs. */
type PendingAction =
  | { kind: "remove-policy"; policyId: number }
  | { kind: "bulk-add"; operations: BulkOperation[] }
  | { kind: "bulk-remove"; operations: BulkOperation[] };

export const PolicyPage: React.FC = () => {
  const [projectName, setProjectName] = React.useState("");
  const [repos, setRepos] = React.useState<RepoInfo[]>([]);
  const [teams, setTeams] = React.useState<TeamInfo[]>([]);
  const [selectedRepo, setSelectedRepo] = React.useState<string>("");
  const [branches, setBranches] = React.useState<BranchInfo[]>([]);
  const [selectedBranch, setSelectedBranch] = React.useState<string>("");
  const [policies, setPolicies] = React.useState<ReviewerPolicy[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingPolicies, setLoadingPolicies] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = React.useState<string | null>(null);
  const [working, setWorking] = React.useState(false);
  const [pending, setPending] = React.useState<PendingAction | null>(null);

  // Repo classification state
  const [classifications, setClassifications] = React.useState<Map<string, RepoClassification>>(
    new Map()
  );
  const [classifying, setClassifying] = React.useState(false);

  // Bulk mode state
  const [bulkMode, setBulkMode] = React.useState(false);
  const [bulkRepos, setBulkRepos] = React.useState<Set<string>>(new Set());
  const [bulkRepoBranches, setBulkRepoBranches] = React.useState<Record<string, BranchInfo[]>>({});
  const [loadingBulkBranches, setLoadingBulkBranches] = React.useState(false);
  const [bulkBranches, setBulkBranches] = React.useState<Set<string>>(new Set());
  const [bulkTeams, setBulkTeams] = React.useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = React.useState<{
    current: number;
    total: number;
  } | null>(null);
  const [bulkResults, setBulkResults] = React.useState<BulkOperationResult[] | null>(null);

  // Load initial data
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const name = await getProjectName();
        const [r, t] = await Promise.all([getRepositories(name), getTeams(name)]);
        if (cancelled) return;
        setProjectName(name);
        setRepos(r);
        setTeams(t);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load project data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Classify repos in background once loaded
  React.useEffect(() => {
    if (repos.length === 0 || !projectName) return;
    let cancelled = false;
    setClassifying(true);
    (async () => {
      try {
        const result = await classifyRepos(
          repos.map((r) => ({ id: r.id, name: r.name })),
          projectName
        );
        if (!cancelled) setClassifications(result);
      } catch {
        // Classification is best-effort; don't block usage
      } finally {
        if (!cancelled) setClassifying(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repos, projectName]);

  // Load branches when repo changes
  React.useEffect(() => {
    // Reset synchronously so a quick repo switch never shows the previous
    // repo's branches or policies against the new selection.
    setBranches([]);
    setSelectedBranch("");
    setPolicies([]);
    if (!selectedRepo) return;

    let cancelled = false;
    (async () => {
      try {
        const b = await getBranches(selectedRepo);
        if (!cancelled) setBranches(b);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load branches");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRepo]);

  // Load policies when branch changes
  React.useEffect(() => {
    if (!selectedRepo || !selectedBranch) {
      setPolicies([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingPolicies(true);
      try {
        const p = await getReviewerPoliciesForBranch(projectName, selectedRepo, selectedBranch);
        if (!cancelled) setPolicies(p);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load policies");
      } finally {
        if (!cancelled) setLoadingPolicies(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRepo, selectedBranch, projectName]);

  // Load branches for selected bulk repos
  React.useEffect(() => {
    if (!bulkMode || bulkRepos.size === 0) return;
    const reposToLoad = Array.from(bulkRepos).filter((id) => !(id in bulkRepoBranches));
    if (reposToLoad.length === 0) return;

    let cancelled = false;
    setLoadingBulkBranches(true);
    (async () => {
      const newBranches: Record<string, BranchInfo[]> = {};
      for (const repoId of reposToLoad) {
        try {
          const b = await getBranches(repoId);
          newBranches[repoId] = b;
        } catch {
          newBranches[repoId] = [];
        }
      }
      if (!cancelled) {
        setBulkRepoBranches((prev) => ({ ...prev, ...newBranches }));
        setLoadingBulkBranches(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bulkMode, bulkRepos, bulkRepoBranches]);

  // Compute unique branches across all selected bulk repos
  const allBulkBranches = React.useMemo(() => {
    const nameMap = new Map<string, BranchInfo>();
    for (const repoId of bulkRepos) {
      for (const b of bulkRepoBranches[repoId] || []) {
        if (!nameMap.has(b.refName)) {
          nameMap.set(b.refName, b);
        }
      }
    }
    return Array.from(nameMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [bulkRepos, bulkRepoBranches]);

  /** Re-read the policies for the branch currently shown, if any. */
  const refreshCurrentPolicies = React.useCallback(async () => {
    if (!selectedRepo || !selectedBranch) return;
    try {
      const p = await getReviewerPoliciesForBranch(projectName, selectedRepo, selectedBranch);
      setPolicies(p);
    } catch (err: any) {
      setError(err?.message || "Failed to refresh policies");
    }
  }, [projectName, selectedRepo, selectedBranch]);

  const handleAddPolicy = React.useCallback(
    async (teamId: string) => {
      if (!selectedRepo || !selectedBranch) return;
      setWorking(true);
      setActionError(null);
      setActionSuccess(null);
      try {
        await addReviewerPolicy(projectName, selectedRepo, selectedBranch, teamId);
        const p = await getReviewerPoliciesForBranch(projectName, selectedRepo, selectedBranch);
        setPolicies(p);
        const team = teams.find((t) => t.id === teamId);
        setActionSuccess(`Added reviewer policy for "${team?.name || teamId}"`);
      } catch (err: any) {
        setActionError(err?.message || "Failed to add policy");
      } finally {
        setWorking(false);
      }
    },
    [projectName, selectedRepo, selectedBranch, teams]
  );

  const runRemovePolicy = React.useCallback(
    async (policyId: number) => {
      setWorking(true);
      setActionError(null);
      setActionSuccess(null);
      try {
        await removeReviewerPolicy(projectName, policyId);
        const p = await getReviewerPoliciesForBranch(projectName, selectedRepo, selectedBranch);
        setPolicies(p);
        setActionSuccess("Policy removed");
      } catch (err: any) {
        setActionError(err?.message || "Failed to remove policy");
      } finally {
        setWorking(false);
      }
    },
    [projectName, selectedRepo, selectedBranch]
  );

  /** Expand the bulk selection into one operation per (repo, branch, team). */
  const buildBulkOperations = React.useCallback((): BulkOperation[] => {
    const operations: BulkOperation[] = [];
    for (const repoId of bulkRepos) {
      const repo = repos.find((r) => r.id === repoId);
      const repoBranches = bulkRepoBranches[repoId] || [];
      for (const branchRef of bulkBranches) {
        const branch = repoBranches.find((b) => b.refName === branchRef);
        if (!branch) continue; // branch doesn't exist in this repo
        for (const teamId of bulkTeams) {
          const team = teams.find((t) => t.id === teamId);
          operations.push({
            repoId,
            repoName: repo?.name || "",
            branchRef,
            branchName: branch.name,
            teamId,
            teamName: team?.name || "",
          });
        }
      }
    }
    return operations;
  }, [bulkRepos, bulkRepoBranches, bulkBranches, bulkTeams, teams, repos]);

  const requestBulk = React.useCallback(
    (kind: "bulk-add" | "bulk-remove") => {
      if (bulkRepos.size === 0 || bulkBranches.size === 0 || bulkTeams.size === 0) return;
      const operations = buildBulkOperations();
      if (operations.length === 0) return;
      setPending({ kind, operations });
    },
    [bulkRepos, bulkBranches, bulkTeams, buildBulkOperations]
  );

  const runBulk = React.useCallback(
    async (kind: "bulk-add" | "bulk-remove", operations: BulkOperation[]) => {
      setWorking(true);
      setBulkResults(null);
      setActionError(null);
      setActionSuccess(null);

      const verb = kind === "bulk-add" ? "added" : "removed";
      try {
        const onProgress = (current: number, total: number) => setBulkProgress({ current, total });
        const results =
          kind === "bulk-add"
            ? await bulkAddPolicies(projectName, operations, true, 1, onProgress)
            : await bulkRemovePolicies(projectName, operations, onProgress);
        setBulkResults(results);
        const succeeded = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;
        if (failed > 0) {
          setActionError(`${failed} of ${results.length} operations failed`);
        }
        if (succeeded > 0) {
          setActionSuccess(`${succeeded} policies ${verb} successfully`);
        }
      } catch (err: any) {
        setActionError(err?.message || "Bulk operation failed");
      } finally {
        setWorking(false);
        setBulkProgress(null);
      }
      // Refresh current view if applicable (outside the try/finally so a
      // refresh failure is reported rather than thrown away).
      await refreshCurrentPolicies();
    },
    [projectName, refreshCurrentPolicies]
  );

  const confirmPending = React.useCallback(() => {
    if (!pending) return;
    setPending(null);
    if (pending.kind === "remove-policy") {
      void runRemovePolicy(pending.policyId);
    } else {
      void runBulk(pending.kind, pending.operations);
    }
  }, [pending, runRemovePolicy, runBulk]);

  const toggleBulkRepo = React.useCallback((id: string) => {
    setBulkRepos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleBulkBranch = React.useCallback((ref: string) => {
    setBulkBranches((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  }, []);

  const toggleBulkTeam = React.useCallback((id: string) => {
    setBulkTeams((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleBulkMode = () => {
    setBulkMode((prev) => !prev);
    setBulkRepos(new Set());
    setBulkRepoBranches({});
    setBulkBranches(new Set());
    setBulkTeams(new Set());
    setBulkResults(null);
  };

  if (loading) {
    return (
      <Card title="Loading project data...">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </Card>
    );
  }

  const existingTeamIds = new Set(policies.flatMap((p) => p.requiredReviewerIds));
  const availableTeams = teams.filter((t) => !existingTeamIds.has(t.id));

  const pendingCopy = describePending(pending, bulkRepos.size);

  return (
    <div className="ax-stack">
      {error && (
        <Banner tone="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {actionError && (
        <Banner tone="error" onDismiss={() => setActionError(null)}>
          {actionError}
        </Banner>
      )}
      {actionSuccess && (
        <Banner tone="success" onDismiss={() => setActionSuccess(null)}>
          {actionSuccess}
        </Banner>
      )}

      {/* Selectors */}
      <div className="ax-toolbar" style={{ alignItems: "flex-end", marginBottom: 0 }}>
        {!bulkMode && (
          <div className="ax-field" style={{ marginBottom: 0 }}>
            <label className="ax-label" htmlFor="policy-repo">
              Repository
            </label>
            <select
              id="policy-repo"
              className="ax-select"
              value={selectedRepo}
              onChange={(e) => setSelectedRepo(e.target.value)}
              style={{ minWidth: 250 }}
            >
              <option value="">Select a repository...</option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {classificationLabel(classifications.get(r.id))}
                </option>
              ))}
            </select>
          </div>
        )}

        {!bulkMode && (
          <div className="ax-field" style={{ marginBottom: 0 }}>
            <label className="ax-label" htmlFor="policy-branch">
              Branch
            </label>
            <select
              id="policy-branch"
              className="ax-select"
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              disabled={!selectedRepo}
              style={{ minWidth: 250 }}
            >
              <option value="">Select a branch...</option>
              {branches.map((b) => (
                <option key={b.refName} value={b.refName}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <Button variant={bulkMode ? "primary" : "default"} onClick={toggleBulkMode}>
          {bulkMode ? "Exit Bulk Mode" : "Bulk Mode"}
        </Button>
      </div>

      {/* Bulk mode UI */}
      {bulkMode && (
        <BulkModePanel
          repos={repos}
          branches={allBulkBranches}
          teams={teams}
          selectedRepos={bulkRepos}
          selectedBranches={bulkBranches}
          selectedTeams={bulkTeams}
          repoBranches={bulkRepoBranches}
          loadingBranches={loadingBulkBranches}
          classifications={classifications}
          classifying={classifying}
          onToggleRepo={toggleBulkRepo}
          onToggleBranch={toggleBulkBranch}
          onToggleTeam={toggleBulkTeam}
          onBulkAdd={() => requestBulk("bulk-add")}
          onBulkRemove={() => requestBulk("bulk-remove")}
          working={working}
          progress={bulkProgress}
          results={bulkResults}
        />
      )}

      {/* Single branch mode - Current policies */}
      {!bulkMode && selectedRepo && selectedBranch && (
        <>
          <Card title="Current Reviewer Policies" flush>
            {loadingPolicies ? (
              <div style={{ padding: 16 }}>
                <Skeleton />
                <Skeleton />
              </div>
            ) : policies.length === 0 ? (
              <EmptyState title="No reviewer policies on this branch." />
            ) : (
              <div className="ax-table-wrap">
                <table className="ax-table">
                  <thead>
                    <tr>
                      <th>Policy ID</th>
                      <th>Reviewers</th>
                      <th className="ax-num">Min Approvers</th>
                      <th>Status</th>
                      <th>Blocking</th>
                      <th style={{ width: 110 }} aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {policies.map((policy) => (
                      <tr key={policy.id}>
                        <td className="ax-mono">#{policy.id}</td>
                        <td>
                          {policy.requiredReviewerIds
                            .map((id) => {
                              const team = teams.find((t) => t.id === id);
                              return team ? team.name : id;
                            })
                            .join(", ")}
                        </td>
                        <td className="ax-num">{policy.minimumApproverCount}</td>
                        <td>
                          <Pill tone={policy.isEnabled ? "success" : "neutral"}>
                            {policy.isEnabled ? "Enabled" : "Disabled"}
                          </Pill>
                        </td>
                        <td>
                          <Pill tone={policy.isBlocking ? "danger" : "warn"}>
                            {policy.isBlocking ? "Required" : "Optional"}
                          </Pill>
                        </td>
                        <td className="ax-num">
                          {isOnlyForBranch(policy, selectedRepo, selectedBranch) ? (
                            <Button
                              variant="danger"
                              size="sm"
                              icon={<IconTrash />}
                              onClick={() =>
                                setPending({ kind: "remove-policy", policyId: policy.id })
                              }
                              disabled={working}
                            >
                              Remove
                            </Button>
                          ) : (
                            <span
                              className="ax-muted"
                              title="Covers more than this branch. Change it in Project settings > Repositories > Policies."
                            >
                              Shared
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Add team */}
          {availableTeams.length > 0 && (
            <Card
              title="Add Team Reviewer"
              hint="Each button creates a required-reviewer policy for that team on the selected branch."
            >
              <div className="ax-row">
                {availableTeams.map((team) => (
                  <Button
                    key={team.id}
                    variant="primary"
                    size="sm"
                    onClick={() => handleAddPolicy(team.id)}
                    disabled={working}
                  >
                    + {team.name}
                  </Button>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* Empty state */}
      {!bulkMode && (!selectedRepo || !selectedBranch) && (
        <Card>
          <EmptyState
            title={
              <>
                Select a <strong>repository</strong> and <strong>branch</strong> to manage reviewer
                policies.
              </>
            }
          >
            Or switch to <strong>Bulk Mode</strong> to add or remove team approvals across multiple
            repositories and branches at once.
          </EmptyState>
        </Card>
      )}

      <ConfirmDialog
        isOpen={pending !== null}
        title={pendingCopy.title}
        message={pendingCopy.message}
        confirmLabel={pendingCopy.confirmLabel}
        danger={pending?.kind !== "bulk-add"}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      />
    </div>
  );
};

function describePending(
  pending: PendingAction | null,
  repoCount: number
): { title: string; message: string; confirmLabel: string } {
  if (!pending) return { title: "", message: "", confirmLabel: "Confirm" };
  switch (pending.kind) {
    case "remove-policy":
      return {
        title: "Remove reviewer policy",
        message: "Remove this reviewer policy?",
        confirmLabel: "Remove",
      };
    case "bulk-add":
      return {
        title: "Add policies in bulk",
        message: `Add ${pending.operations.length} reviewer policy/policies across ${repoCount} repo(s)?`,
        confirmLabel: `Add ${pending.operations.length}`,
      };
    case "bulk-remove":
      return {
        title: "Remove policies in bulk",
        message: `Remove ${pending.operations.length} reviewer policy/policies across ${repoCount} repo(s)?`,
        confirmLabel: `Remove ${pending.operations.length}`,
      };
  }
}

const BulkModePanel: React.FC<{
  repos: RepoInfo[];
  branches: BranchInfo[];
  teams: TeamInfo[];
  selectedRepos: Set<string>;
  selectedBranches: Set<string>;
  selectedTeams: Set<string>;
  repoBranches: Record<string, BranchInfo[]>;
  loadingBranches: boolean;
  classifications: Map<string, RepoClassification>;
  classifying: boolean;
  onToggleRepo: (id: string) => void;
  onToggleBranch: (ref: string) => void;
  onToggleTeam: (id: string) => void;
  onBulkAdd: () => void;
  onBulkRemove: () => void;
  working: boolean;
  progress: { current: number; total: number } | null;
  results: BulkOperationResult[] | null;
}> = ({
  repos,
  branches,
  teams,
  selectedRepos,
  selectedBranches,
  selectedTeams,
  repoBranches,
  loadingBranches,
  classifications,
  classifying,
  onToggleRepo,
  onToggleBranch,
  onToggleTeam,
  onBulkAdd,
  onBulkRemove,
  working,
  progress,
  results,
}) => {
  // Compute actual operation count accounting for which repos have which branches
  const operationCount = React.useMemo(() => {
    let count = 0;
    for (const repoId of selectedRepos) {
      const rb = repoBranches[repoId] || [];
      for (const branchRef of selectedBranches) {
        if (rb.some((b) => b.refName === branchRef)) {
          count += selectedTeams.size;
        }
      }
    }
    return count;
  }, [selectedRepos, repoBranches, selectedBranches, selectedTeams]);

  return (
    <Card
      title="Bulk Mode"
      hint="Pick repositories, branches and teams; every combination that exists becomes one operation."
    >
      <div className="ax-grid-3">
        {/* Repository selection */}
        <div className="ax-field">
          <span className="ax-label">Repositories ({selectedRepos.size} selected)</span>
          <div className="ax-picker">
            {repos.map((r) => (
              <label key={r.id} className="ax-check ax-member-row" style={{ display: "flex" }}>
                <input
                  type="checkbox"
                  checked={selectedRepos.has(r.id)}
                  onChange={() => onToggleRepo(r.id)}
                />
                <span className="ax-spacer ax-truncate">{r.name}</span>
                <ClassificationBadge
                  classification={classifications.get(r.id)}
                  classifying={classifying}
                />
              </label>
            ))}
          </div>
        </div>

        {/* Branch selection */}
        <div className="ax-field">
          <span className="ax-label">Branches ({selectedBranches.size} selected)</span>
          <div className="ax-picker">
            {selectedRepos.size === 0 ? (
              <p className="ax-help" style={{ textAlign: "center", margin: 8 }}>
                Select at least one repository to see branches.
              </p>
            ) : loadingBranches ? (
              <p className="ax-help" style={{ textAlign: "center", margin: 8 }}>
                Loading branches...
              </p>
            ) : branches.length === 0 ? (
              <p className="ax-help" style={{ textAlign: "center", margin: 8 }}>
                No branches found.
              </p>
            ) : (
              branches.map((b) => (
                <label
                  key={b.refName}
                  className="ax-check ax-member-row"
                  style={{ display: "flex" }}
                >
                  <input
                    type="checkbox"
                    checked={selectedBranches.has(b.refName)}
                    onChange={() => onToggleBranch(b.refName)}
                  />
                  <span className="ax-truncate">{b.name}</span>
                </label>
              ))
            )}
          </div>
        </div>

        {/* Team selection */}
        <div className="ax-field">
          <span className="ax-label">Teams ({selectedTeams.size} selected)</span>
          <div className="ax-picker">
            {teams.map((t) => (
              <label key={t.id} className="ax-check ax-member-row" style={{ display: "flex" }}>
                <input
                  type="checkbox"
                  checked={selectedTeams.has(t.id)}
                  onChange={() => onToggleTeam(t.id)}
                />
                <span className="ax-truncate">{t.name}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Bulk actions */}
      <div className="ax-row" style={{ marginTop: 8 }}>
        <Button
          variant="primary"
          onClick={onBulkAdd}
          disabled={working || operationCount === 0}
          busy={working}
        >
          {working ? "Working..." : `Add Policies (${operationCount})`}
        </Button>
        <Button
          variant="danger"
          onClick={onBulkRemove}
          disabled={working || operationCount === 0}
          busy={working}
        >
          {working ? "Working..." : `Remove Policies (${operationCount})`}
        </Button>

        {operationCount > 0 && !working && (
          <span className="ax-fine">
            {operationCount} operation{operationCount !== 1 ? "s" : ""} ({selectedRepos.size} repo
            {selectedRepos.size !== 1 ? "s" : ""} x {selectedBranches.size} branch
            {selectedBranches.size !== 1 ? "es" : ""} x {selectedTeams.size} team
            {selectedTeams.size !== 1 ? "s" : ""})
          </span>
        )}
      </div>

      {/* Progress */}
      {progress && (
        <div style={{ marginTop: 12 }}>
          <Progress
            label={`Processing ${progress.current} of ${progress.total}...`}
            current={progress.current}
            total={progress.total}
          />
        </div>
      )}

      {/* Results */}
      {results && (
        <div style={{ marginTop: 16 }}>
          <h3 className="ax-card__title" style={{ marginBottom: 8 }}>
            Results
          </h3>
          <div className="ax-table-wrap">
            <table className="ax-table">
              <thead>
                <tr>
                  <th>Repository</th>
                  <th>Branch</th>
                  <th>Team</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr
                    key={`${r.operation.repoId}|${r.operation.branchRef}|${r.operation.teamId}|${i}`}
                  >
                    <td>{r.operation.repoName}</td>
                    <td>{r.operation.branchName}</td>
                    <td>{r.operation.teamName}</td>
                    <td>
                      <Pill tone={r.success ? "success" : "danger"}>
                        {r.success ? "OK" : "Failed"}
                      </Pill>
                    </td>
                    <td className={r.success ? "ax-muted" : undefined}>{r.error || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
};

// ── Classification helpers ────────────────────────────────────────────

/** Plain-text label for use inside <option> elements */
function classificationLabel(c?: RepoClassification): string {
  if (!c || c.appType === "unknown") return "";
  switch (c.appType) {
    case "function-app": {
      const model =
        c.functionWorkerModel === "isolated"
          ? "Isolated"
          : c.functionWorkerModel === "in-process"
            ? "In-Process"
            : "";
      return model ? ` [Function App - ${model}]` : " [Function App]";
    }
    case "container-app": {
      const env =
        c.containerEnvironment === "workload"
          ? "Workload"
          : c.containerEnvironment === "standard"
            ? "Standard"
            : "";
      return env ? ` [Container App - ${env}]` : " [Container App]";
    }
    case "web-app":
      return " [Web App]";
    default:
      return "";
  }
}

/** Pill tone per classification */
const BADGE_TONES: Record<string, Tone> = {
  "function-app": "elite",
  "container-app": "info",
  "web-app": "accent",
};

const ClassificationBadge: React.FC<{
  classification?: RepoClassification;
  classifying?: boolean;
}> = ({ classification, classifying }) => {
  if (classifying && !classification) {
    return (
      <span className="ax-fine" style={{ fontStyle: "italic" }}>
        scanning...
      </span>
    );
  }
  if (!classification || classification.appType === "unknown") return null;

  const c = classification;
  const tone = BADGE_TONES[c.appType] || "neutral";

  let label: string;
  switch (c.appType) {
    case "function-app": {
      const model =
        c.functionWorkerModel === "isolated"
          ? "Isolated"
          : c.functionWorkerModel === "in-process"
            ? "In-Process"
            : null;
      label = model ? `Function App · ${model}` : "Function App";
      break;
    }
    case "container-app": {
      const env =
        c.containerEnvironment === "workload"
          ? "Workload Env"
          : c.containerEnvironment === "standard"
            ? "Standard Env"
            : null;
      label = env ? `Container App · ${env}` : "Container App";
      break;
    }
    case "web-app":
      label = "Web App";
      break;
    default:
      return null;
  }

  return <Pill tone={tone}>{label}</Pill>;
};
