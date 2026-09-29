import type { Metadata } from "next";
import { pageMetadata } from "@/src/lib/site-metadata";
import { Suspense } from "react";
import { StatusNotice } from "@/app/_components/status-ui";
import { LoginContent } from "@/app/login/login-content";

export const metadata: Metadata = pageMetadata({
  title: "AWRS | Sign In",
  description: "Sign in to your AWRS account to automate your student meal reservations on Webetu.",
  path: "/login",
});

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="app-main app-main-center"><StatusNotice kind="loading" variant="block">Loading...</StatusNotice></main>}>
      <LoginContent />
    </Suspense>
  );
}
