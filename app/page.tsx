import { redirect } from "next/navigation";

export default function Home() {
  // Members land on their own work, not the leadership dashboard. Their own
  // projects and the update they owe are what they came for.
  redirect("/my-work");
}
