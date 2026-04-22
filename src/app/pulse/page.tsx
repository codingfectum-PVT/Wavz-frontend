import { Pulse } from "@/components/tokens/Pulse";


interface TokenPageProps {
  params: { mint: string };
}

export default function PulsePage({ params }: TokenPageProps) {
  return <Pulse  />;
}
