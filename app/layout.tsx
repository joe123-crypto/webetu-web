import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SITE_IMAGE, SITE_NAME, SITE_URL } from "@/src/lib/site-metadata";
import "./globals.css";

const description =
  "AWRS — the Automatic Webetu Reservation System. Automate your student meal reservations on Webetu. Part of the Genaie ecosystem.";

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: SITE_NAME,
  description,
  openGraph: {
    title: SITE_NAME,
    description,
    url: SITE_URL.toString(),
    siteName: SITE_NAME,
    locale: "en_US",
    type: "website",
    images: [SITE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description,
    images: [SITE_IMAGE],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
