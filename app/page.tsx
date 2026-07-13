import { TrainerProvider } from "@/context/TrainerContext";
import { ChessTrainer } from "@/components/ChessTrainer";

export default function Home() {
  return (
    <TrainerProvider>
      <ChessTrainer />
    </TrainerProvider>
  );
}
