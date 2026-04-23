'use client';

import { FC, useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Zap, Pause, Play } from 'lucide-react';
import { useTokens, Token } from '@/hooks/useApi';
import { useSocket } from '@/components/providers/SocketProvider';
import { useSolPrice } from '@/hooks/useSolPrice';
import { useLaunchpadActions } from '@/hooks/useProgram';
import toast from 'react-hot-toast';

/* ─── Constants ─────────────────────────────────────── */
const GRADUATING_MC_MIN = 30000;
const GRADUATING_MC_MAX = 70000;
const TOTAL_SUPPLY = 1_000_000_000;

const formatMC = (v: number) => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(2)}K`;
  return `$${v.toFixed(0)}`;
};

const timeAgo = (d: string) => {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
};

const initials = (name: string) =>
  name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');

type Variant = 'new' | 'graduating' | 'listed';

const PALETTES = [
  { bg: '#1a1208', color: '#d4914a' },
  { bg: '#1a0a2e', color: '#a78bfa' },
  { bg: '#1e1000', color: '#d97706' },
  { bg: '#101810', color: '#6dbe5a' },
  { bg: '#0d1825', color: '#5b9fd4' },
  { bg: '#1e1205', color: '#d4914a' },
  { bg: '#1e1020', color: '#c084fc' },
];
const palette = (name: string) => PALETTES[name.charCodeAt(0) % PALETTES.length];

/* ─── Helpers ─────────────────────────────────────────── */
const getRealMarketCap = (token: Token, solPriceUsd: number) => {
  const virtualSol = Number(token.virtualSolReserves || 0) / 1e9;
  const virtualTokens = Number(token.virtualTokenReserves || 0) / 1e6;
  if (virtualTokens > 0 && virtualSol > 0) {
    const currentPriceInSol = virtualSol / virtualTokens;
    return currentPriceInSol * TOTAL_SUPPLY * solPriceUsd;
  }
  return token.marketCap || 0;
};

/* ─── Progress bar colors per variant ─────────────────── */
const PROGRESS_COLOR: Record<Variant, string> = {
  new: '#3b82f6',
  graduating: 'linear-gradient(90deg,#3b82f6,#f97316)',
  listed: 'linear-gradient(90deg,#a855f7,#f97316)',
};

/* ─── Token Row ───────────────────────────────────────── */
const TokenRow: FC<{
  token: Token;
  variant: Variant;
  onQuickBuy?: (token: Token) => void;
  isBuying?: boolean;
}> = ({ token, variant, onQuickBuy, isBuying = false }) => {
  const { price: solPriceUsd } = useSolPrice();
  const [imgError, setImgError] = useState(false);

  const av = palette(token.name);
  const defaultImage = `https://api.dicebear.com/7.x/shapes/svg?seed=${token.mint}`;

  const realMC = useMemo(
    () => getRealMarketCap(token, solPriceUsd),
    [token, solPriceUsd]
  );

  const pct =
    variant === 'listed'
      ? 100
      : Math.min(100, Math.round((realMC / GRADUATING_MC_MAX) * 100));

  return (
  <div style={{
  display: 'flex',
  alignItems: 'stretch', // 🔥 important
  gap: 0,
  background: '#0d1f33',
  borderRadius: 10,
  marginBottom: 6,
  border: '1px solid rgba(255,255,255,0.04)',
}}>
     <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '7px',
    flex: 1
  }}>
      {/* Avatar */}
      <div style={{
        width: 48,
        height: 48,
        borderRadius: 10,
        flexShrink: 0,
        overflow: 'hidden',
        background: av.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        fontWeight: 700,
        color: av.color,
      }}>
        {!imgError ? (
          <img
            src={token.image || defaultImage}
            alt={token.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => setImgError(true)}
          />
        ) : (
          initials(token.name)
        )}
      </div>

      {/* Middle content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Row 1: name + time */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{
            color: '#e2eaf4',
            fontSize: 13,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '70%',
          }}>
            {token.name}
          </span>
          <span style={{ color: '#f97316', fontSize: 11, fontWeight: 600 }}>
            {timeAgo(String(token.createdAt))}
          </span>
        </div>

        {/* Row 2: symbol + MC */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
          <span style={{ color: '#4a6a8a', fontSize: 11 }}>{token.symbol}</span>
          <span style={{ color: '#7a9fbc', fontSize: 11 }}>MC: {formatMC(realMC)}</span>
        </div>

        {/* Progress bar */}
        <div style={{
          height: 4,
          background: '#0a1929',
          borderRadius: 4,
          overflow: 'hidden',
          marginTop: 6,
        }}>
          <div style={{
            width: `${pct}%`,
            height: '100%',
            background: PROGRESS_COLOR[variant],
            transition: 'width 0.5s ease',
            borderRadius: 4,
          }} />
        </div>

        {/* Percentage */}
        <div style={{ textAlign: 'right', fontSize: 10, color: '#34557D', marginTop: 2 }}>
          {pct}%
        </div>
      </div>
      </div>
       <div style={{backgroundColor:'#182536',padding:'15px'}}>
      {/* Lightning button */}
      <button
        onClick={() => onQuickBuy?.(token)}
        disabled={!onQuickBuy || isBuying}
        style={{
        width: 36,
        height: 36,
        borderRadius: 8,
        background: '#52FC55',
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        flexShrink: 0,
        marginTop:'5px',
        opacity: isBuying ? 0.7 : 1,
      }}
      >
        {isBuying ? <Loader2 size={16} color="#000" className="animate-spin" /> : <Zap size={17} color="#000" fill="#000" />}
      </button>
      </div>
    </div>
  );
};

/* ─── Panel Header config ─────────────────────────────── */
const PANEL_ICON: Record<Variant, string> = {
  new: '👀',
  graduating: '🎓',
  listed: '🔥',
};

/* ─── Panel ───────────────────────────────────────────── */
const Panel: FC<{
  title: string;
  tokens: Token[];
  isLoading: boolean;
  variant: Variant;
  liveCount?: number;
  buyAmount?: string;
  onBuyAmountChange?: (v: string) => void;
  paused?: boolean;
  onTogglePaused?: () => void;
  onQuickBuy?: (token: Token) => void;
  buyingMint?: string | null;
}> = ({
  title,
  tokens,
  isLoading,
  variant,
  liveCount = 0,
  buyAmount = '0',
  onBuyAmountChange,
  paused = false,
  onTogglePaused,
  onQuickBuy,
  buyingMint,
}) => {
  const [search, setSearch] = useState('');

  const filtered = tokens.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.symbol.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{
      overflow: 'hidden',
      background: '#08172A',
      border: '1px solid rgba(255,255,255,0.06)',
      display: 'flex',
      flexDirection: 'column',
       height: 650,
    }}>
      {/* Panel Header */}
      <div style={{
        padding: '12px 14px',
        background: '#08172A',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        {variant === 'listed' ? (
          <img
            src="/images/metora.png"
            alt="meteora"
            style={{ width: 18, height: 18, objectFit: 'contain' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <span style={{ fontSize: 16 }}>{PANEL_ICON[variant]}</span>
        )}
        <span style={{
          color: '#fff',
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: '-0.01em',
        }}>
          {title}
        </span>
      </div>

      {/* Search + Controls */}
      <div style={{
        padding: '10px 10px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}>
        {/* Search input */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: '#08172A',
          borderRadius: 8,
          padding: '8px 10px',
          border: '1px solid #34557D',
        }}>
          <Search size={13} color="#fff" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tokens.."
            style={{
              background: 'none',
              border: 'none',
              outline: 'none',
              color: '#7a9fbc',
              fontSize: 13,
              flex: 1,
              minWidth: 0,
            }}
          />
        </div>

        {/* Live count badge */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: '#08172A',
          border: '1px solid #34557D',
          borderRadius: 8,
          padding: '8px 10px',
          fontSize: 12,
          color: '#e2eaf4',
          fontWeight: 600,
        }}>
          <Zap size={12} color="#fff" fill="#fff" />
          <input
            value={buyAmount}
            onChange={(e) => onBuyAmountChange?.(e.target.value)}
            type="number"
            step="0.01"
            min="0"
            style={{
              width: 46,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
            }}
          />
          <img src="/images/solana.png" alt="solana" width={15} height={15} />
          <span style={{ fontSize: 12, color: '#9db7d1' }}>{liveCount}</span>
        </div>

        {/* Pause button */}
        <button
          onClick={onTogglePaused}
          disabled={!onTogglePaused}
          style={{
          background: '#182536',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 8,
          width: 36,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: onTogglePaused ? 'pointer' : 'not-allowed',
          opacity: onTogglePaused ? 1 : 0.55,
        }}
        >
          {paused ? <Play size={14} color="#fff" /> : <Pause size={14} color="#fff" />}
        </button>
      </div>

      {/* Token list */}
      <div style={{
        padding: '8px 10px',
        maxHeight: 380,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <Loader2 className="animate-spin" style={{ color: '#4a6a8a' }} />
          </div>
        ) : filtered.length === 0 ? (
          <p style={{ color: '#4a6a8a', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
            No tokens found
          </p>
        ) : (
          filtered.map((t) => (
            <TokenRow
              key={t.mint}
              token={t}
              variant={variant}
              onQuickBuy={onQuickBuy}
              isBuying={buyingMint === t.mint}
            />
          ))
        )}
      </div>
    </div>
  );
};

/* ─── Main ───────────────────────────────────────────── */
export const Pulse: FC = () => {
  const [liveNew, setLiveNew] = useState<Token[]>([]);
  const [queuedNew, setQueuedNew] = useState<Token[]>([]);
  const [newPaused, setNewPaused] = useState(false);
  const [buyAmount, setBuyAmount] = useState('0');
  const [buyingMint, setBuyingMint] = useState<string | null>(null);
  const { socket, connected } = useSocket();
  const { price: solPriceUsd } = useSolPrice();
  const { buy } = useLaunchpadActions();

  const { data: newData } = useTokens({ sort: 'createdAt', order: 'desc', limit:60 });
  const { data: gradData } = useTokens({ sort: 'marketCap', order: 'desc', limit: 60 });
  const { data: listedData } = useTokens({ sort: 'marketCap', order: 'desc', limit: 60, graduated: true });

  useEffect(() => {
    if (!socket || !connected) return;
    const handleTokenCreated = (t: Token) => {
      toast.success(`New token: ${t.name}`);
      if (newPaused) {
        setQueuedNew((prev) => [...prev, t]);
        return;
      }
      setLiveNew((prev) => [t, ...prev]);
    };
    socket.on('token:created', handleTokenCreated);
    return () => {
      socket.off('token:created', handleTokenCreated);
    };
  }, [socket, connected, newPaused]);

  const handleToggleNewPause = () => {
    setNewPaused((prev) => {
      const next = !prev;
      if (prev && queuedNew.length > 0) {
        setLiveNew((current) => [...queuedNew, ...current]);
        setQueuedNew([]);
      }
      return next;
    });
  };

  const handleQuickBuy = async (token: Token) => {
    const sol = Number(buyAmount);
    if (!Number.isFinite(sol) || sol <= 0) {
      toast.error('Enter a valid SOL amount');
      return;
    }
    try {
      setBuyingMint(token.mint);
      const lamports = Math.floor(sol * 1e9);
      await buy(token.mint, lamports, 100);
      toast.success(`Bought ${token.symbol} with ${sol} SOL`);
    } catch (error: any) {
      toast.error(error?.message || 'Buy failed');
    } finally {
      setBuyingMint(null);
    }
  };

  const map = new Map<string, Token>();
  [...(newData?.tokens ?? []), ...(gradData?.tokens ?? []), ...(listedData?.tokens ?? []), ...liveNew]
    .forEach((t) => map.set(t.mint, t));

  const all = Array.from(map.values());

  const newList = [...all].sort(
    (a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime()
  );

  const graduating = all.filter((t) => {
    const mc = getRealMarketCap(t, solPriceUsd);
    return mc >= GRADUATING_MC_MIN && mc < GRADUATING_MC_MAX && !t.graduated;
  });

  const listed = all.filter((t) => t.graduated);

  return (
    <div style={{ background: '#060f1a', minHeight: '100vh', padding: '0 0 24px' }}>
      {/* Page Title */}
      <div style={{ padding: '20px 20px 12px' }}>
        <h1 style={{
          color: '#e2eaf4',
          fontSize: 26,
          fontWeight: 800,
          margin: 0,
          letterSpacing: '-0.02em',
        }}>
          Pulse
        </h1>
      </div>

      {/* Three column grid */}
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
        style={{ gap: 14, padding: '0 16px' }}
      >
        <Panel
          title="Newly Created"
          tokens={newList}
          isLoading={!newData}
          variant="new"
          liveCount={liveNew.length}
          buyAmount={buyAmount}
          onBuyAmountChange={setBuyAmount}
          paused={newPaused}
          onTogglePaused={handleToggleNewPause}
          onQuickBuy={handleQuickBuy}
          buyingMint={buyingMint}
        />
        <Panel
          title="Graduating"
          tokens={graduating}
          isLoading={!gradData}
          variant="graduating"
          liveCount={0}
          buyAmount={buyAmount}
          onBuyAmountChange={setBuyAmount}
          onQuickBuy={handleQuickBuy}
          buyingMint={buyingMint}
        />
        <Panel
          title="Listed on Meteora"
          tokens={listed}
          isLoading={!listedData}
          variant="listed"
          liveCount={0}
          buyAmount={buyAmount}
          onBuyAmountChange={setBuyAmount}
          onQuickBuy={handleQuickBuy}
          buyingMint={buyingMint}
        />
      </div>
    </div>
  );
};
