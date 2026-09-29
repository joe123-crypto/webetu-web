/**
 * Product & ecosystem branding.
 *
 * AWRS is the product a user interacts with. It automates reservations on the
 * external Webetu meal-reservation platform, and is one product within the
 * Genaie ecosystem (alongside siblings such as Genaie Scout).
 *
 * Note: "Webetu" elsewhere in the codebase (credentials, API base URL,
 * restaurants) refers to that external service being automated — not to this
 * product. Only user-facing product identity lives here.
 */

/** Short, lead brand shown as the primary mark. */
export const PRODUCT_NAME = "AWRS";

/** Expanded name, used as a subtitle beneath the lead mark. */
export const PRODUCT_FULL_NAME = "Automatic Webetu Reservation System";

/** Parent ecosystem the product belongs to. */
export const PARENT_BRAND = "Genaie";

/**
 * Genaie logo assets (served from /public).
 *
 * These are wordmarks, so in an endorsement the logo stands in for the word
 * "Genaie" itself (rendered as "by <wordmark>"), rather than sitting beside
 * the text. `alt` should therefore be the brand name.
 *
 * - PARENT_LOGO_SRC: black wordmark for light surfaces (the app is light-only).
 * - PARENT_LOGO_WHITE_SRC: white wordmark, for any future dark surface.
 */
export const PARENT_LOGO_SRC = "/logo.png";
export const PARENT_LOGO_WHITE_SRC = "/logo-white.png";

/**
 * Builds a page <title> as "AWRS | <page>", falling back to the bare product
 * name when no page label is given.
 */
export function pageTitle(page?: string): string {
  return page ? `${PRODUCT_NAME} | ${page}` : PRODUCT_NAME;
}
