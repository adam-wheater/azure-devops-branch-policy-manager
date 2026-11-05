// Sample data for the demo build: a fictional "Contoso" project with six
// repositories, six teams and a handful of reviewer policies. The signed-in
// sample user is an admin, so the policy views and the Admin tab both open.
// See demo/kit.ts for the helpers.
import { CommonServiceIds, clientFactory, delay, extensionDataService, projectPageService } from "./kit";

export { CommonServiceIds };

const guid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// The "Required reviewers" policy type the extension looks for.
const REVIEWERS = "fd2167ab-b0be-447a-8571-0d4ce8d5dbe1";

const teams = [
  "Architecture Board",
  "Payments Team",
  "Platform Team",
  "QA Team",
  "Security Team",
  "Web Team",
].map((name, i) => ({ id: guid(100 + i), name }));
const team = (name: string) => teams.find((t) => t.name === name)!.id;

// Files each repository holds, so the Function App / Container App / Web App
// badges come out of the real detection code.
const csproj = (sdk: string, exe = false) =>
  `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>${exe ? "<OutputType>Exe</OutputType>" : ""}</PropertyGroup>\n  <ItemGroup>\n    ${sdk}\n  </ItemGroup>\n</Project>\n`;
const pipeline = (body: string) => `trigger:\n  - main\nsteps:\n${body}\n`;

const repoDefs: { name: string; branches: string[]; files: Record<string, string> }[] = [
  {
    name: "billing-api",
    branches: ["develop", "main", "release/2.4"],
    files: {
      "/src/Billing.Api/Billing.Api.csproj": csproj(
        '<PackageReference Include="Microsoft.Azure.Functions.Worker.Sdk" Version="1.17.0" />',
        true
      ),
    },
  },
  {
    name: "payments-worker",
    branches: ["develop", "hotfix/retry-backoff", "main"],
    files: {
      "/src/Payments.Worker/Payments.Worker.csproj": csproj(
        '<PackageReference Include="Microsoft.NET.Sdk.Functions" Version="4.2.0" />'
      ),
    },
  },
  {
    name: "web-portal",
    branches: ["develop", "feature/invoice-export", "main", "release/2.4"],
    files: { "/azure-pipelines.yml": pipeline("  - task: AzureWebApp@1\n    inputs:\n      appName: contoso-portal") },
  },
  {
    name: "notifications-service",
    branches: ["develop", "main"],
    files: {
      "/deploy.yml": pipeline(
        "  - script: az containerapp up --name notifications\n    env:\n      containerEnvironmentName: contoso-$(EnvironmentName)-ctr-environment-workload"
      ),
    },
  },
  {
    name: "identity-gateway",
    branches: ["develop", "main"],
    files: {
      "/deploy.yml": pipeline(
        "  - task: AzureContainerApps@1\n    inputs:\n      containerEnvironmentName: contoso-$(EnvironmentName)-ctr-environment"
      ),
    },
  },
  { name: "infra-templates", branches: ["main"], files: { "/main.bicep": "param location string\n" } },
];
const repos = repoDefs.map((r, i) => ({ ...r, id: guid(200 + i) }));
const repo = (name: string) => repos.find((r) => r.name === name)!;
const byRepoId = new Map(repos.map((r) => [r.id, r]));

// Existing "Required reviewers" policies.
type Seed = [id: number, repo: string, branch: string, team: string, min: number, enabled: boolean, blocking: boolean];
const seeds: Seed[] = [
  [1042, "billing-api", "main", "Platform Team", 2, true, true],
  [1043, "billing-api", "main", "Security Team", 1, true, true],
  [1051, "billing-api", "main", "QA Team", 1, true, false],
  [1058, "billing-api", "main", "Architecture Board", 1, false, false],
  [1044, "billing-api", "develop", "Platform Team", 1, true, true],
  [1061, "web-portal", "main", "Web Team", 1, true, true],
  [1062, "web-portal", "main", "Security Team", 1, true, true],
  [1063, "web-portal", "develop", "Web Team", 1, true, false],
  [1070, "payments-worker", "main", "Payments Team", 2, true, true],
  [1071, "payments-worker", "main", "Security Team", 1, true, true],
  [1080, "notifications-service", "main", "Platform Team", 1, true, true],
  [1090, "identity-gateway", "main", "Security Team", 2, true, true],
  [1091, "identity-gateway", "main", "Platform Team", 1, true, true],
];
const policyBody = (
  repositoryId: string,
  refName: string,
  teamId: string,
  min: number,
  enabled: boolean,
  blocking: boolean
) => ({
  isEnabled: enabled,
  isBlocking: blocking,
  type: { id: REVIEWERS, displayName: "Required reviewers" },
  settings: {
    requiredReviewerIds: [teamId],
    minimumApproverCount: min,
    scope: [{ repositoryId, refName, matchKind: "Exact" }],
  },
});
let policies: any[] = seeds.map(([id, r, b, t, min, on, blocking]) => ({
  id,
  ...policyBody(repo(r).id, `refs/heads/${b}`, team(t), min, on, blocking),
}));
let nextPolicyId = 1100;

// The access list: Alex Morgan (the sample user, see demo/sdk.ts) is an admin.
const settings = extensionDataService({
  BranchPolicyManagerSettings: {
    "admin-settings": {
      authorizedEmails: [
        "alex.morgan@contoso.com",
        "priya.shah@contoso.com",
        "tom.ellis@contoso.com",
        "maria.lopez@contoso.com",
      ],
    },
  },
});

export const services: Record<string, unknown> = {
  [CommonServiceIds.ProjectPageService]: projectPageService("Contoso"),
  [CommonServiceIds.ExtensionDataService]: settings,
};

export const getClient = clientFactory({
  CoreRestClient: {
    getTeams: (_project: string, _mine?: boolean, top = 100, skip = 0) =>
      delay(teams.slice(skip, skip + top), 200),
  },
  GitRestClient: {
    getRepositories: () => delay(repos.map(({ id, name }) => ({ id, name, isDisabled: false })), 250),
    getRefs: (repoId: string) =>
      delay(byRepoId.get(repoId)!.branches.map((b) => ({ name: `refs/heads/${b}` })), 120),
    getItems: (repoId: string) =>
      delay(Object.keys(byRepoId.get(repoId)!.files).map((path) => ({ path })), 90),
    getItemText: (repoId: string, path: string) => delay(byRepoId.get(repoId)!.files[path], 40),
  },
  PolicyRestClient: {
    getPolicyTypes: () => delay([{ id: REVIEWERS, displayName: "Required reviewers" }], 100),
    getPolicyConfigurations: () => delay(policies.map((p) => structuredClone(p)), 150),
    getPolicyConfiguration: (_project: string, id: number) =>
      delay(structuredClone(policies.find((p) => p.id === id)), 100),
    createPolicyConfiguration: (config: any) => {
      const scope = config.settings.scope[0];
      // One branch refuses the write, the way a real permission error reads.
      if (scope.repositoryId === repo("payments-worker").id && scope.refName === "refs/heads/main") {
        return delay(null, 300).then(() => {
          throw new Error(
            "TF401027: You need the Git 'EditPolicies' permission to perform this action. Details: identity 'Alex Morgan', scope 'repository'."
          );
        });
      }
      const created = { ...structuredClone(config), id: nextPolicyId++ };
      policies.push(created);
      return delay(structuredClone(created), 350);
    },
    updatePolicyConfiguration: (config: any, _project: string, id: number) => {
      policies = policies.map((p) => (p.id === id ? { ...config, id } : p));
      return delay(structuredClone(config), 150);
    },
    deletePolicyConfiguration: (_project: string, id: number) => {
      policies = policies.filter((p) => p.id !== id);
      return delay(undefined, 250);
    },
  },
});

// The screenshot runner can click but cannot choose from a <select>, so the demo
// opens on billing-api / main, as if someone had just picked them. Entering Bulk
// Mode (which hides the selects) ends this.
function openOnBranch(repoName: string, branch: string) {
  const choose = (id: string, label: (o: HTMLOptionElement) => boolean) => {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    const option = select && Array.from(select.options).find((o) => o.value && label(o));
    if (!select || !option) return false;
    // React tracks the value itself, so go through the native setter and fire a real change.
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, option.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };
  let repoChosen = false;
  const watcher = new MutationObserver(() => {
    if (!repoChosen) repoChosen = choose("policy-repo", (o) => o.text.startsWith(repoName));
    else if (!document.getElementById("policy-repo")) watcher.disconnect();
    else if (choose("policy-branch", (o) => o.text === branch)) watcher.disconnect();
  });
  watcher.observe(document.documentElement, { childList: true, subtree: true });
}
openOnBranch("billing-api", "main");
