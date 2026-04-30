export const dynamic = 'force-dynamic';

import { TokenDetail } from '@/components/tokens/TokenDetail';

interface TokenPageProps {
  params: { mint: string };
}

export default function TokenPage({ params }: TokenPageProps) {
  return <TokenDetail mint={params.mint} />;
}
