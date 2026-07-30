// Home is a placeholder one tap behind /visits until the widget Home lands
// (Task 6). This is a Server Component redirect — no client JS ships for it.
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/visits");
}
