import { getClient } from "azure-devops-extension-api";
import {
  GitRestClient,
  GitItem,
  VersionControlRecursionType,
} from "azure-devops-extension-api/Git";
import {
  RepoClassification,
  AppType,
  FunctionWorkerModel,
  ContainerEnvironment,
} from "../models/interfaces";

/**
 * Classify a single repo by inspecting its file tree and key file contents.
 *
 * Detection strategy:
 *  - Function App:  look for .csproj referencing Azure Functions packages,
 *    then determine Isolated vs In-Process by checking for the worker SDK.
 *  - Container App:  look for pipeline YAML files (deploy.yml, deploy.yaml,
 *    azure-pipelines.yml, etc.) and scan for containerApp / containerEnvironmentName
 *    references. Determine "workload" vs "standard" from the environment name.
 */
export async function classifyRepo(
  repoId: string,
  repoName: string,
  projectName: string
): Promise<RepoClassification> {
  const base: RepoClassification = {
    repoId,
    repoName,
    appType: "unknown" as AppType,
  };

  try {
    const client = getClient(GitRestClient);

    // Fetch the top-level file tree (recursive to pick up nested pipeline files)
    const items: GitItem[] = await client.getItems(
      repoId,
      projectName,
      "/",
      VersionControlRecursionType.Full,
      true, // includeContentMetadata
      false, // includeLinks
      false // latestProcessedChange
    );

    // ── 1. Detect Function App ──────────────────────────────────────
    const csprojPaths = items.filter((i) => i.path && i.path.toLowerCase().endsWith(".csproj"));

    for (const csproj of csprojPaths) {
      try {
        const content = await getFileContent(client, repoId, projectName, csproj.path!);
        if (isFunctionAppProject(content)) {
          base.appType = "function-app";
          base.functionWorkerModel = detectWorkerModel(content);
          return base;
        }
      } catch {
        // Skip files we can't read
      }
    }

    // ── 2. Detect Container App ─────────────────────────────────────
    // Walk every YAML file that could be a pipeline / deployment manifest.
    // Contents are kept so the web-app check below does not fetch them again.
    const yamlContents: string[] = [];
    for (const item of items) {
      const p = item.path?.toLowerCase() ?? "";
      if (!p.endsWith(".yml") && !p.endsWith(".yaml")) continue;
      let content: string;
      try {
        content = await getFileContent(client, repoId, projectName, item.path!);
      } catch {
        continue; // Skip files we can't read
      }
      yamlContents.push(content);
      const envType = detectContainerAppEnvironment(content);
      if (envType !== null) {
        base.appType = "container-app";
        base.containerEnvironment = envType;
        return base;
      }
    }

    // ── 3. Detect Web App (general) ─────────────────────────────────
    // If we see an app service deploy pattern but no function/container match
    for (const content of yamlContents) {
      if (isWebAppDeployment(content)) {
        base.appType = "web-app";
        return base;
      }
    }
  } catch {
    // If the repo is empty or we lack permissions, return unknown
  }

  return base;
}

/**
 * Classify multiple repos in parallel (with concurrency limit).
 */
export async function classifyRepos(
  repos: { id: string; name: string }[],
  projectName: string,
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, RepoClassification>> {
  const results = new Map<string, RepoClassification>();
  const concurrency = 4;
  let completed = 0;

  const queue = [...repos];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const repo = queue.shift()!;
      const classification = await classifyRepo(repo.id, repo.name, projectName);
      results.set(repo.id, classification);
      completed++;
      onProgress?.(completed, repos.length);
    }
  });

  await Promise.all(workers);
  return results;
}

// ── Helper functions ──────────────────────────────────────────────────

async function getFileContent(
  client: GitRestClient,
  repoId: string,
  projectName: string,
  path: string
): Promise<string> {
  return await client.getItemText(repoId, path, projectName);
}

/**
 * Check if a .csproj references the Azure Functions SDK.
 */
function isFunctionAppProject(csprojContent: string): boolean {
  const lower = csprojContent.toLowerCase();
  return (
    lower.includes("microsoft.net.sdk.functions") ||
    lower.includes("microsoft.azure.functions.worker") ||
    lower.includes("microsoft.azure.webjobs") ||
    lower.includes("microsoft.azure.functions.extensions")
  );
}

/**
 * Determine isolated vs in-process worker model from .csproj content.
 *
 * Isolated indicators:
 *   - <OutputType>Exe</OutputType>
 *   - Microsoft.Azure.Functions.Worker.Sdk
 *   - Microsoft.Azure.Functions.Worker (the runtime package)
 *
 * In-process indicators:
 *   - Microsoft.NET.Sdk.Functions (without the isolated SDK)
 *   - Microsoft.Azure.WebJobs.Extensions
 */
function detectWorkerModel(csprojContent: string): FunctionWorkerModel {
  const lower = csprojContent.toLowerCase();

  const hasIsolatedSdk =
    lower.includes("microsoft.azure.functions.worker.sdk") ||
    lower.includes("microsoft.azure.functions.worker");
  const hasExeOutput = lower.includes("<outputtype>exe</outputtype>");

  if (hasIsolatedSdk || hasExeOutput) {
    return "isolated";
  }

  const hasInProcessSdk =
    lower.includes("microsoft.net.sdk.functions") || lower.includes("microsoft.azure.webjobs");

  if (hasInProcessSdk) {
    return "in-process";
  }

  return "unknown";
}

/**
 * Detect whether a YAML file deploys a container app, and which environment.
 *
 * Looks for references to:
 *   - containerApp / containerAppName
 *   - containerEnvironmentName / managedEnvironmentResourceId
 *   - AzureContainerApps@1 task
 *
 * Then classifies the environment:
 *   - "workload" if the env name contains "-workload" (handles various
 *     variable syntaxes: $(Var), ${{ variables.Var }}, $[variables.Var], etc.)
 *   - "standard" if a container env reference is found without "-workload"
 */
function detectContainerAppEnvironment(yamlContent: string): ContainerEnvironment | null {
  const lower = yamlContent.toLowerCase();

  // Quick check: does this YAML involve container apps at all?
  const isContainerAppPipeline =
    lower.includes("containerapp") ||
    lower.includes("container-app") ||
    lower.includes("azurecontainerapps") ||
    lower.includes("managedenvironment") ||
    lower.includes("containerenvironmentname") ||
    lower.includes("container_environment") ||
    lower.includes("ctr-environment");

  if (!isContainerAppPipeline) {
    return null;
  }

  // Check for a "workload profile" environment. The environment name can
  // appear in many forms across different pipeline formats:
  //   containerEnvironmentName="contoso-$(EnvironmentName)-ctr-environment-workload"
  //   containerEnvironmentName: contoso-$(EnvironmentName)-ctr-environment-workload
  //   managedEnvironmentResourceId: .../ctr-environment-workload
  //   environmentName: ${{ variables.envName }}-workload
  //   -workload as a suffix to a container environment reference
  //
  // We also handle indirect cases where the workload suffix is appended
  // via a variable, e.g.:
  //   - name: containerEnv
  //     value: "contoso-dev-ctr-environment-workload"
  //   - containerEnvironmentName: $(containerEnv)

  if (isWorkloadEnvironment(yamlContent)) {
    return "workload";
  }

  return "standard";
}

/**
 * Smart detection of "workload" container app environments.
 *
 * Handles many common YAML pipeline patterns:
 *   1. Direct reference:  ctr-environment-workload
 *   2. Variable assignment:  value: "...-workload"  near a container env context
 *   3. Parameter default:  default: "...-workload"
 *   4. Template expression:  ${{ parameters.envName }}-workload
 *   5. Macro syntax:  $(envName)-workload
 *   6. Split across lines with string concat
 */
function isWorkloadEnvironment(yamlContent: string): boolean {
  const lines = yamlContent.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();

    // Pattern 1: Literal "-workload" appearing in a container env context
    // e.g. containerEnvironmentName="...-workload"
    //      ctr-environment-workload
    //      managed-environment-workload
    if (
      (trimmed.includes("ctr-environment-workload") ||
        trimmed.includes("container-environment-workload") ||
        (trimmed.includes("managedenvironment") && trimmed.includes("-workload"))) &&
      !trimmed.startsWith("#")
    ) {
      return true;
    }

    // Pattern 2: A key=value or key: value where value ends with -workload
    // and the key relates to container/environment naming
    const envKeyPattern =
      /(?:containerenvironmentname|environmentname|container_environment|ctr.environment|managedenvironment|env_name|envname)/i;
    if (envKeyPattern.test(trimmed) && trimmed.includes("-workload") && !trimmed.startsWith("#")) {
      return true;
    }

    // Pattern 3: Variable/parameter definition whose value contains -workload
    // e.g.  value: contoso-dev-ctr-environment-workload
    //        default: '...-ctr-environment-workload'
    if (
      (trimmed.startsWith("value:") || trimmed.startsWith("default:")) &&
      trimmed.includes("ctr-environment-workload")
    ) {
      return true;
    }
  }

  // Pattern 4: Multi-line / template expression where -workload is appended
  // e.g.  containerEnvironmentName: ${{ parameters.env }}-workload
  //        containerEnvironmentName: $(envName)-workload
  const multiLinePattern =
    /(?:containerenvironmentname|container_environment|ctr.environment)[^\n]*[-_]workload/i;
  if (multiLinePattern.test(yamlContent)) {
    return true;
  }

  return false;
}

/**
 * Simple check for web app / app service deployment patterns.
 */
function isWebAppDeployment(yamlContent: string): boolean {
  const lower = yamlContent.toLowerCase();
  return (
    lower.includes("azurewebapp") ||
    lower.includes("azure-webapp") ||
    lower.includes("azurermwebappdeployment") ||
    lower.includes("app-service")
  );
}
