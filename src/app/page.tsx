// Home — the launcher (Task 6). The widget grid itself is a Client Component
// (it reads the offline cache and subscribes to sync status), so this file
// stays a thin Server Component wrapper — no client JS ships beyond what the
// chosen home itself needs.
//
// There are two homes now: a rep's day and a manager's team. HomeSwitch picks,
// on the client, because the role rides on the cached profile.
import { HomeSwitch } from "./home/home-switch";

export default function Home() {
  return <HomeSwitch />;
}
