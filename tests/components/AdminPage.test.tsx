import * as React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AdminPage } from "@/components/AdminPage";
import { ThemeProvider } from "@/utils/theme";
import { ADMIN_SETTINGS_DOC_ID } from "@/models/interfaces";
import { __resetDataManagerCache } from "@/services/AdminService";
import { __setMockService, __resetMockServices } from "../__mocks__/azure-devops-extension-sdk";
import { CommonServiceIds, IDocumentOptions } from "../__mocks__/azure-devops-extension-api";

const ADMIN = "admin@contoso.com";
const OTHER = "dev@fabrikam.com";

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

function seed(...emails: string[]) {
  documents[ADMIN_SETTINGS_DOC_ID] = { id: ADMIN_SETTINGS_DOC_ID, authorizedEmails: emails };
}

function renderPage(currentEmail = ADMIN) {
  return render(
    <ThemeProvider>
      <AdminPage currentEmail={currentEmail} />
    </ThemeProvider>
  );
}

beforeEach(() => {
  documents = {};
  __resetMockServices();
  __resetDataManagerCache();
  __setMockService(CommonServiceIds.ExtensionDataService, {
    getExtensionDataManager: async () => mockDataManager,
  });
  jest.clearAllMocks();
});

describe("AdminPage", () => {
  it("lists authorized users in a design-system table and marks the current user", async () => {
    seed(ADMIN, OTHER);
    renderPage();

    await screen.findByText(OTHER);
    expect(screen.getByText(ADMIN).closest("table")).toHaveClass("ax-table");
    expect(screen.getByText("(you)")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /remove/i })).toHaveLength(2);
  });

  it("disables removal when only one admin remains", async () => {
    seed(ADMIN);
    renderPage();

    const remove = await screen.findByRole("button", { name: /remove/i });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute("title", "The last remaining admin cannot be removed");
  });

  it("asks for confirmation before removing a user, then removes them", async () => {
    seed(ADMIN, OTHER);
    renderPage();

    await screen.findByText(OTHER);
    const [, removeOther] = screen.getAllByRole("button", { name: /remove/i });
    fireEvent.click(removeOther);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(`Remove access for ${OTHER}?`);
    expect(mockDataManager.setDocument).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.queryByText(OTHER)).not.toBeInTheDocument());
    expect(documents[ADMIN_SETTINGS_DOC_ID].authorizedEmails).toEqual([ADMIN]);
  });

  it("adds a normalized email from the input", async () => {
    seed(ADMIN);
    renderPage();
    await screen.findByText(ADMIN);

    const input = screen.getByLabelText("Grant access by email");
    fireEvent.change(input, { target: { value: "  New.Person@Fabrikam.com " } });
    fireEvent.click(screen.getByRole("button", { name: /add user/i }));

    await screen.findByText("new.person@fabrikam.com");
    expect(documents[ADMIN_SETTINGS_DOC_ID].authorizedEmails).toEqual([
      ADMIN,
      "new.person@fabrikam.com",
    ]);
  });

  it("rejects an address without an @ before calling the service", async () => {
    seed(ADMIN);
    renderPage();
    await screen.findByText(ADMIN);

    fireEvent.change(screen.getByLabelText("Grant access by email"), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add user/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please enter a valid email address"
    );
    expect(mockDataManager.setDocument).not.toHaveBeenCalled();
  });
});
