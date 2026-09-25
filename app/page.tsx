import { redirect } from "next/navigation";

// The root page redirects to login. Signed-in users will be routed to
// their /{publicUserId} dashboard by the session route handler.
export default function RootPage() {
  redirect("/login");
}
