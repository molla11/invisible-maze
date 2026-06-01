import { GameClient } from "@/components/GameClient";

type Props = {
  params: Promise<{ gameId: string }>;
};

export default async function GamePage({ params }: Props) {
  const { gameId } = await params;
  return <GameClient gameId={gameId} />;
}
