import { redirect } from "next/navigation";

// The options command center is the home screen.
export default function Home() {
  redirect("/options");
}
