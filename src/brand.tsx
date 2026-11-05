import * as React from "react";

/**
 * Product identity. The glyph is drawn from the same paths as static/icon.png so the
 * header mark and the Marketplace icon are one logo.
 */
export const BRAND = {
  id: "branch-policy-manager",
  name: "Branch Policy Manager",
  tagline: "Team reviewer policies across branches, in bulk",
};

export const BrandGlyph: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable={false}
  >
    <path d="M12 3l7 2.6v5.2c0 4.6-3 8.1-7 10.2-4-2.1-7-5.6-7-10.2V5.6L12 3Z" />
    <path d="m9 12.2 2.1 2.1L15.5 10" />
  </svg>
);
