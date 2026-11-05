// Mock for azure-devops-extension-api and all its subpaths
const mockClients: Record<string, any> = {};

export const CommonServiceIds = {
  ProjectPageService: "ms.vss-tfs-web.tfs-page-data-service",
  ExtensionDataService: "ms.vss-features.extension-data-service",
  LocationService: "ms.vss-features.location-service",
};

export class PolicyRestClient {
  static _mockName = "PolicyRestClient";
}

export class CoreRestClient {
  static _mockName = "CoreRestClient";
}

export class GitRestClient {
  static _mockName = "GitRestClient";
}

export enum VersionControlRecursionType {
  None = 0,
  OneLevel = 1,
  OneLevelPlusNestedEmptyFolders = 4,
  Full = 120,
}

export interface GitItem {
  objectId?: string;
  gitObjectType?: number;
  commitId?: string;
  path?: string;
  isFolder?: boolean;
  url?: string;
}

export interface GitBranchStats {
  name: string;
  commit: { commitId: string };
}

// Stub interfaces for TypeScript imports
export interface IProjectPageService {
  getProject(): Promise<{ id: string; name: string } | undefined>;
}

export interface IExtensionDataService {
  getExtensionDataManager(extensionId: string, accessToken: string): Promise<IExtensionDataManager>;
}

export interface IDocumentOptions {
  scopeType?: string;
  scopeValue?: string;
  defaultValue?: any;
}

export interface IExtensionDataManager {
  getDocument(collectionName: string, id: string, documentOptions?: IDocumentOptions): Promise<any>;
  createDocument(
    collectionName: string,
    doc: any,
    documentOptions?: IDocumentOptions
  ): Promise<any>;
  setDocument(collectionName: string, doc: any, documentOptions?: IDocumentOptions): Promise<any>;
}

export interface ILocationService {
  getServiceLocation(): Promise<string>;
}

export interface PolicyConfiguration {
  id: number;
  isEnabled: boolean;
  isBlocking: boolean;
  type: { id: string };
  settings: any;
}

export interface WebApiTeam {
  id: string;
  name: string;
}

export interface GitRepository {
  id: string;
  name: string;
  isDisabled: boolean;
}

export function getClient(clientClass: any): any {
  if (!clientClass) return {};
  const name = clientClass._mockName || clientClass.name || "unknown";
  if (!mockClients[name]) {
    mockClients[name] = {};
  }
  return mockClients[name];
}

export function __setMockClient(name: string, client: any): void {
  mockClients[name] = client;
}

export function __resetMockClients(): void {
  for (const key of Object.keys(mockClients)) {
    delete mockClients[key];
  }
}
