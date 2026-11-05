// Mock for azure-devops-extension-sdk
const mockServices: Record<string, any> = {};
const mockAccessToken = "mock-access-token";
const mockExtensionContext = { id: "mock-extension-id" };
const mockUser = { name: "admin@contoso.com", id: "mock-user-id" };

export function getService<T>(serviceId: string): Promise<T> {
  return Promise.resolve(mockServices[serviceId] as T);
}

export function getAccessToken(): Promise<string> {
  return Promise.resolve(mockAccessToken);
}

export function getExtensionContext(): { id: string } {
  return mockExtensionContext;
}

export function getUser(): { name: string; id: string } {
  return mockUser;
}

export function init(): Promise<void> {
  return Promise.resolve();
}

export function ready(): Promise<void> {
  return Promise.resolve();
}

// Test helpers
export function __setMockService(serviceId: string, service: any): void {
  mockServices[serviceId] = service;
}

export function __resetMockServices(): void {
  for (const key of Object.keys(mockServices)) {
    delete mockServices[key];
  }
}

export function __setMockUser(name: string): void {
  mockUser.name = name;
}
