import { HomeClient } from "@/components/HomeClient";
import { publicStats } from "@/lib/server/store";

export default async function HomePage() {
  return <HomeClient initialStats={await publicStats()} />;
}
