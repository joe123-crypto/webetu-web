import type { Metadata } from "next";

/**
 * Canonical origin for the site.
 */
export const SITE_URL = new URL(
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.webetu.app",
);

export const SITE_NAME = "Webetu";

export const SITE_IMAGE = {
  url: "/og-card.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "Webetu — student meal reservation platform",
} as const;

type PageMetadataInput = {
  title: string;
  description: string;
  /** Route path, used for the canonical and og:url. */
  path: string;
};

/**
 * Builds a page's metadata with matching Open Graph and Twitter cards.
 */
export function pageMetadata({ title, description, path }: PageMetadataInput): Metadata {
  const url = new URL(path, SITE_URL).toString();

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      locale: "en_US",
      type: "website",
      images: [SITE_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [SITE_IMAGE],
    },
  };
}
