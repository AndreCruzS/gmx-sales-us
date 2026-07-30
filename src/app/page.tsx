// Home — the launcher (Task 6). The widget grid itself is a Client Component
// (it reads the offline cache and subscribes to sync status), so this file
// stays a thin Server Component wrapper — no client JS ships beyond what
// HomeClient itself needs.
import HomeClient from "./home/home-client";

export default function Home() {
  return <HomeClient />;
}
