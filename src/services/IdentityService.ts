import * as SDK from "azure-devops-extension-sdk";
import { CommonServiceIds, IProjectPageService, getClient } from "azure-devops-extension-api";
import { CoreRestClient, WebApiTeam } from "azure-devops-extension-api/Core";
import { TeamInfo, RepoInfo, BranchInfo } from "../models/interfaces";
import { GitRestClient, GitRepository } from "azure-devops-extension-api/Git";

export async function getCurrentUserEmail(): Promise<string> {
  const user = SDK.getUser();
  return user.name; // email address
}

export async function getProjectName(): Promise<string> {
  const projectService = await SDK.getService<IProjectPageService>(
    CommonServiceIds.ProjectPageService
  );
  const project = await projectService.getProject();
  if (!project) throw new Error("Could not determine the current project.");
  return project.name;
}

export async function getProjectId(): Promise<string> {
  const projectService = await SDK.getService<IProjectPageService>(
    CommonServiceIds.ProjectPageService
  );
  const project = await projectService.getProject();
  if (!project) throw new Error("Could not determine the current project.");
  return project.id;
}

export async function getTeams(projectName: string): Promise<TeamInfo[]> {
  const client = getClient(CoreRestClient);
  const teams: WebApiTeam[] = [];
  let skip = 0;
  const top = 100;

  // Paginate to get all teams
  while (true) {
    const batch = await client.getTeams(projectName, false, top, skip);
    teams.push(...batch);
    if (batch.length < top) break;
    skip += top;
  }

  return teams.map((t) => ({
    id: t.id,
    name: t.name,
  }));
}

export async function getRepositories(projectName: string): Promise<RepoInfo[]> {
  const client = getClient(GitRestClient);
  const repos: GitRepository[] = await client.getRepositories(projectName);
  return repos
    .filter((r) => !r.isDisabled)
    .map((r) => ({
      id: r.id,
      name: r.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getBranches(repoId: string): Promise<BranchInfo[]> {
  const client = getClient(GitRestClient);
  const refs = await client.getRefs(repoId, undefined, "heads/");
  return refs.map((r) => ({
    name: r.name.replace("refs/heads/", ""),
    refName: r.name,
  }));
}
