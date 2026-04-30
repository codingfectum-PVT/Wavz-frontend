export const dynamic = 'force-dynamic';

import { TokenList } from '@/components/tokens/TokenList';
import { HeroSection } from '@/components/home/HeroSection';
import { TokenPanels } from '@/components/home/StatsBar';

export default function Home() {
  return (
    <div className="relative min-h-screen">
      <video
        autoPlay
        loop
        muted
        playsInline
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          zIndex: 0,
        }}
      >
        <source src="/images/gradientbg.mp4" type="video/mp4" />
      </video>
      <div className="relative space-y-8" style={{ zIndex: 2 }}>
        <HeroSection />
        <TokenPanels />
        <TokenList />
      </div>

    </div>
  );
}