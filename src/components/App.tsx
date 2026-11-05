import * as React from "react";
import { BRAND, BrandGlyph } from "../brand";
import { getCurrentUserEmail } from "../services/IdentityService";
import { resolveAccess } from "../services/AdminService";
import { AdminPage } from "./AdminPage";
import { PolicyPage } from "./PolicyPage";
import { AppShell, Banner, ErrorBoundary, Gate, IconAlert, IconUsers, Tabs } from "./ui";

type ViewMode = "policies" | "admin";

interface AccessState {
  authorized: boolean;
  /** True when this user has just been recorded as the first admin. */
  bootstrapped: boolean;
  email: string;
  error: string | null;
}

const AppInner: React.FC = () => {
  const [access, setAccess] = React.useState<AccessState | null>(null);
  const [activeView, setActiveView] = React.useState<ViewMode>("policies");
  const [showFirstRunNotice, setShowFirstRunNotice] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      let email = "";
      try {
        email = await getCurrentUserEmail();
        const result = await resolveAccess(email);
        if (!cancelled) setAccess({ ...result, email, error: null });
      } catch (err: any) {
        if (!cancelled) {
          setAccess({
            authorized: false,
            bootstrapped: false,
            email,
            error: err?.message || "Failed to verify authorization",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (access === null) {
    return (
      <Gate title="Checking access" busy>
        <p className="ax-gate__body">Looking up the authorized-user list for this organization.</p>
      </Gate>
    );
  }

  if (!access.authorized) {
    return (
      <Gate title="Access denied" icon={<IconAlert size={26} />}>
        <p className="ax-gate__body">
          You do not have permission to use {BRAND.name}. Contact an administrator of this extension
          to request access.
        </p>
        {access.email && <div className="ax-gate__identity">Signed in as {access.email}</div>}
        {access.error && (
          <Banner tone="error" title="Could not verify access">
            {access.error}
          </Banner>
        )}
      </Gate>
    );
  }

  return (
    <AppShell
      title={BRAND.name}
      subtitle={BRAND.tagline}
      mark={<BrandGlyph />}
      actions={<span className="ax-fine">{access.email}</span>}
    >
      {access.bootstrapped && showFirstRunNotice && (
        <Banner
          tone="info"
          title="You are the first admin"
          onDismiss={() => setShowFirstRunNotice(false)}
        >
          No authorized-user list existed yet, so {access.email} has been recorded as the first
          admin of this extension. Use the <strong>Admin</strong> tab to grant access to others.
        </Banner>
      )}

      <Tabs
        tabs={[
          { id: "policies", label: "Branch Policies" },
          { id: "admin", label: "Admin", icon: <IconUsers size={14} /> },
        ]}
        active={activeView}
        onChange={(id) => setActiveView(id as ViewMode)}
        aria-label="Branch Policy Manager sections"
      />

      {activeView === "policies" && <PolicyPage />}
      {activeView === "admin" && <AdminPage currentEmail={access.email} />}
    </AppShell>
  );
};

export const App: React.FC = () => (
  <ErrorBoundary>
    <AppInner />
  </ErrorBoundary>
);
