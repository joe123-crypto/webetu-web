import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Firebase Admin requires Node runtime
  serverExternalPackages: ["firebase-admin"],
  async rewrites() {
    const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
    if (!projectId) return [];
    return [
      {
        source: "/__/auth/:path*",
        destination: `https://${projectId}.firebaseapp.com/__/auth/:path*`,
      },
    ];
  },
};

export default nextConfig;
