import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { App } from "@/components/App";
import { ThemeProvider } from "@/utils/theme";
import { ADMIN_SETTINGS_DOC_ID } from "@/models/interfaces";
import { __resetDataManagerCache } from "@/services/AdminService";
import {
  __setMockService,
  __resetMockServices,
  __setMockUser,
} from "../__mocks__/azure-devops-extension-sdk";
import { CommonServiceIds, IDocumentOptions } from "../__mocks__/azure-devops-extension-api";

let documents: Record<string, any> = {};

const mockDataManager = {
  getDocument: jest.fn(async (_collection: string, id: string, options?: IDocumentOptions) => {
    if (documents[id]) return documents[id];
    if (options && "defaultValue" in options) return options.defaultValue;
    throw new Error("Document not found");
  }),
  createDocument: jest.fn(async (_collection: string, doc: any) => {
    documents[doc.id] = doc;
    return doc;
  }),
  setDocument: jest.fn(async (_collection: string, doc: any) => {
    documents[doc.id] = doc;
    return doc;
  }),
};

function renderApp() {
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>
  );
}

beforeEach(() => {
  documents = {};
  __resetMockServices();
  __resetDataManagerCache();
  __setMockUser("first.user@contoso.com");
  __setMockService(CommonServiceIds.ExtensionDataService, {
    getExtensionDataManager: async () => mockDataManager,
  });
  // PolicyPage loads project data on mount; keep it pending so the shell renders alone.
  __setMockService(CommonServiceIds.ProjectPageService, {
    getProject: () => new Promise(() => undefined),
  });
  jest.clearAllMocks();
});

describe("App access gate", () => {
  it("records the first user as admin and tells them so", async () => {
    renderApp();

    expect(await screen.findByText("You are the first admin")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Branch Policy Manager");
    expect(screen.getByRole("tab", { name: /admin/i })).toBeInTheDocument();
    expect(documents[ADMIN_SETTINGS_DOC_ID].authorizedEmails).toEqual(["first.user@contoso.com"]);
  });

  it("denies users who are not on an existing list", async () => {
    documents[ADMIN_SETTINGS_DOC_ID] = {
      id: ADMIN_SETTINGS_DOC_ID,
      authorizedEmails: ["someone.else@fabrikam.com"],
    };
    renderApp();

    expect(await screen.findByText("Access denied")).toBeInTheDocument();
    expect(screen.getByText(/Signed in as first.user@contoso.com/)).toBeInTheDocument();
    expect(mockDataManager.createDocument).not.toHaveBeenCalled();
  });

  it("does not show the first-run notice to an already-listed user", async () => {
    documents[ADMIN_SETTINGS_DOC_ID] = {
      id: ADMIN_SETTINGS_DOC_ID,
      authorizedEmails: ["first.user@contoso.com"],
    };
    renderApp();

    await screen.findByRole("tab", { name: /branch policies/i });
    expect(screen.queryByText("You are the first admin")).not.toBeInTheDocument();
  });
});
