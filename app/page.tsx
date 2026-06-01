import { HomeClient } from "@/components/HomeClient";
import { publicStats } from "@/lib/server/store";

export default function HomePage() {
  return <HomeClient initialStats={publicStats()} />;
}
