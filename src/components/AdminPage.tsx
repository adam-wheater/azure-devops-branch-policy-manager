import * as React from "react";
import { AdminSettings } from "../models/interfaces";
import {
  getAdminSettings,
  addAuthorizedUser,
  removeAuthorizedUser,
  normalizeEmail,
} from "../services/AdminService";
import { Banner, Button, Card, ConfirmDialog, EmptyState, IconTrash, Pill, Skeleton } from "./ui";

export const AdminPage: React.FC<{ currentEmail: string }> = ({ currentEmail }) => {
  const [settings, setSettings] = React.useState<AdminSettings | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [newEmail, setNewEmail] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = React.useState<string | null>(null);

  const loadSettings = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await getAdminSettings();
      setSettings(s);
    } catch (err: any) {
      setError(err?.message || "Failed to load admin settings");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleAdd = React.useCallback(async () => {
    const email = newEmail.trim();
    if (!email) return;
    if (!email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }

    setAdding(true);
    setError(null);
    try {
      const updated = await addAuthorizedUser(email);
      setSettings(updated);
      setNewEmail("");
    } catch (err: any) {
      setError(err?.message || "Failed to add user");
    } finally {
      setAdding(false);
    }
  }, [newEmail]);

  const handleRemove = React.useCallback(async (email: string) => {
    setPendingRemove(null);
    setRemoving(email);
    setError(null);
    try {
      const updated = await removeAuthorizedUser(email);
      setSettings(updated);
    } catch (err: any) {
      setError(err?.message || "Failed to remove user");
    } finally {
      setRemoving(null);
    }
  }, []);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleAdd();
    },
    [handleAdd]
  );

  const emails = settings?.authorizedEmails ?? [];
  const isLastAdmin = emails.length <= 1;
  const isSelf = (email: string) => normalizeEmail(email) === normalizeEmail(currentEmail);

  return (
    <div className="ax-stack">
      {error && (
        <Banner tone="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      <Card
        title="Admin access"
        hint="Only the people listed here can open this extension. The first person to open it was recorded as the first admin; the last remaining admin cannot be removed."
      >
        <div className="ax-field">
          <label className="ax-label" htmlFor="admin-new-email">
            Grant access by email
          </label>
          <div className="ax-row">
            <input
              id="admin-new-email"
              className="ax-input"
              type="email"
              placeholder="user@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={adding}
              style={{ width: 320 }}
            />
            <Button
              variant="primary"
              onClick={handleAdd}
              disabled={adding || !newEmail.trim()}
              busy={adding}
            >
              {adding ? "Adding..." : "Add user"}
            </Button>
          </div>
          <p className="ax-help">
            Use the sign-in email of the Azure DevOps user. Matching is case-insensitive.
          </p>
        </div>
      </Card>

      <Card title="Authorized users" hint={loading ? undefined : `${emails.length} listed`} flush>
        {loading ? (
          <div style={{ padding: 16 }}>
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ) : emails.length === 0 ? (
          <EmptyState title="No authorized users yet">
            Add an email address above to grant access.
          </EmptyState>
        ) : (
          <div className="ax-table-wrap">
            <table className="ax-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th style={{ width: 140 }}>Role</th>
                  <th style={{ width: 120 }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {emails.map((email) => (
                  <tr key={email}>
                    <td>
                      {email}
                      {isSelf(email) && (
                        <span className="ax-fine" style={{ marginLeft: 8 }}>
                          (you)
                        </span>
                      )}
                    </td>
                    <td>
                      <Pill tone="accent">Admin</Pill>
                    </td>
                    <td className="ax-num">
                      <Button
                        variant="danger"
                        size="sm"
                        icon={<IconTrash />}
                        onClick={() => setPendingRemove(email)}
                        disabled={removing === email || isLastAdmin}
                        busy={removing === email}
                        title={
                          isLastAdmin ? "The last remaining admin cannot be removed" : undefined
                        }
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        isOpen={pendingRemove !== null}
        title="Remove access"
        message={
          pendingRemove && isSelf(pendingRemove)
            ? `Remove your own access (${pendingRemove})? You will lose access to this extension as soon as you reload it.`
            : `Remove access for ${pendingRemove ?? ""}?`
        }
        confirmLabel="Remove"
        danger
        onConfirm={() => pendingRemove && handleRemove(pendingRemove)}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
};
