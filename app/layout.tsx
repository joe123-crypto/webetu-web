import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { BackendStatus } from "@/app/_components/backend-status";
import { WhatsAppButton } from "@/app/_components/whatsapp-button";
import { ServiceWorker } from "@/app/_components/service-worker";
import { SITE_IMAGE, SITE_NAME, SITE_URL } from "@/src/lib/site-metadata";
import "./globals.css";

const description =
  "AWRS — the Automatic Webetu Reservation System. Automate your student meal reservations on Webetu. Part of the Genaie ecosystem.";

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: SITE_NAME,
  description,
  applicationName: "AWRS",
  appleWebApp: {
    capable: true,
    title: "AWRS",
    statusBarStyle: "default",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
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

export const viewport: Viewport = {
  themeColor: "#478f77",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* Rendered here, once, so the badge sits in the same viewport corner on
            every route instead of each page placing its own copy. */}
        <div className="status-rail">
          <BackendStatus />
        </div>
        {/* Same reasoning as the badge above: one copy, pinned to the opposite
            corner, so help is in the same place on every route. */}
        <WhatsAppButton />
        <ServiceWorker />
        <Analytics />
      </body>
    </html>
  );
}
