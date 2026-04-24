'use client';

import { FC, useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Zap, Pause, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTokens, Token } from '@/hooks/useApi';
import { useSocket } from '@/components/providers/SocketProvider';
import { useSolPrice } from '@/hooks/useSolPrice';
import { useLaunchpadActions } from '@/hooks/useProgram';
import toast from 'react-hot-toast';
import { AppLoader } from '../Apploader';
import { useMeteorSwap } from '@/hooks/useMeteorSwap';
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
/* ─── Token Row ───────────────────────────────────────── */
const TokenRow: FC<{
  token: Token;
  variant: Variant;
  onOpenToken?: (token: Token) => void;
  onQuickBuy?: (token: Token) => void;
  isBuying?: boolean;
}> = ({ token, variant, onOpenToken, onQuickBuy, isBuying = false }) => {
  const { price: solPriceUsd } = useSolPrice();
  const [imgError, setImgError] = useState(false);

  // 🔥 METEORA PRICE for graduated tokens
  const [meteoraPrice, setMeteoraPrice] = useState<number | null>(null);

  useEffect(() => {
    if (!token.graduated || !token.meteoraPool) {
      setMeteoraPrice(null);
      return;
    }

    const fetchMeteoraPrice = async () => {
      try {
        const { default: DLMM } = await import('@meteora-ag/dlmm');
        const { Connection, PublicKey } = await import('@solana/web3.js');
        const connection = new Connection(
          process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com'
        );
        const dlmm = await DLMM.create(
          connection,
          new PublicKey(token.meteoraPool!),
          { cluster: 'devnet' }  // ← change to 'mainnet-beta' for mainnet
        );
        const activeBin = await dlmm.getActiveBin();
        setMeteoraPrice(parseFloat(activeBin.price) / 1000);
      } catch (err) {
        console.error('Pulse TokenRow: Failed to fetch Meteora price:', err);
      }
    };

    fetchMeteoraPrice();
    const interval = setInterval(fetchMeteoraPrice, 30000);
    return () => clearInterval(interval);
  }, [token.graduated, token.meteoraPool]);

  const av = palette(token.name);
  const defaultImage = `https://api.dicebear.com/7.x/shapes/svg?seed=${token.mint}`;

  // 🔥 MC: Meteora price for graduated, bonding curve otherwise
  const realMC = useMemo(() => {
    if (token.graduated && meteoraPrice !== null) {
      return meteoraPrice * TOTAL_SUPPLY * solPriceUsd;
    }
    return getRealMarketCap(token, solPriceUsd);
  }, [token, solPriceUsd, meteoraPrice]);

  const getBondingProgress = (token: Token) => {
    const realSol = Number(token.realSolReserves || 0) / 1e9;
    const threshold = 60;
    if (token.graduated) return 100;
    return Math.max(0, Math.min((realSol / threshold) * 100, 100));
  };
  const pct = getBondingProgress(token);

  return (
    <div
      onClick={() => onOpenToken?.(token)}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        background: '#0d1f33',
        borderRadius: 10,
        marginBottom: 6,
        border: '1px solid rgba(255,255,255,0.04)',
        cursor: onOpenToken ? 'pointer' : 'default',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px',
        flex: 1,
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
            <span style={{ color: '#7a9fbc', fontSize: 11 }}>
              MC:{' '}
              {token.graduated && meteoraPrice === null
                ? <span style={{ color: '#34557D', fontSize: 10 }}>Loading…</span>
                : formatMC(realMC)
              }
            </span>
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
            {pct.toFixed(0)}%
          </div>
        </div>
      </div>

      <div style={{ backgroundColor: '#182536', padding: '15px' }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onQuickBuy?.(token);
          }}
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
            marginTop: '5px',
            opacity: isBuying ? 0.7 : 1,
          }}
        >
          {isBuying ? <AppLoader size={50} /> : <Zap size={17} color="#000" fill="#000" />}
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
  onOpenToken?: (token: Token) => void;
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
  onOpenToken,
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
            <AppLoader size={50} />
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
              onOpenToken={onOpenToken}
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
  const router = useRouter();
  const [liveNew, setLiveNew] = useState<Token[]>([]);
  const [queuedNew, setQueuedNew] = useState<Token[]>([]);
  const [liveTokenByMint, setLiveTokenByMint] = useState<Record<string, Partial<Token>>>({});
  const [newPaused, setNewPaused] = useState(false);
  const { buyOnMeteora } = useMeteorSwap();
  const [buyAmounts, setBuyAmounts] = useState({
    newlyCreated: '0',
    graduating: '0',
    listed: '0',
  });
  const [buyingMint, setBuyingMint] = useState<string | null>(null);
  const { socket, connected, subscribeToFeed, unsubscribeFromFeed } = useSocket();
  const { price: solPriceUsd } = useSolPrice();
  const { buy } = useLaunchpadActions();

  const { data: newData } = useTokens({ sort: 'createdAt', order: 'desc', limit:60 });
  const { data: gradData } = useTokens({ sort: 'marketCap', order: 'desc', limit: 60 });
  const { data: listedData } = useTokens({ sort: 'marketCap', order: 'desc', limit: 60, graduated: true });

  useEffect(() => {
    if (!socket || !connected) return;
    subscribeToFeed();
    return () => {
      unsubscribeFromFeed();
    };
  }, [socket, connected, subscribeToFeed, unsubscribeFromFeed]);

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

  useEffect(() => {
    if (!socket || !connected) return;

    const toBigInt = (value: unknown): bigint | null => {
      if (typeof value === 'bigint') return value;
      if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.floor(value));
      if (typeof value === 'string' && value.trim().length > 0) {
        try {
          return BigInt(value);
        } catch {
          return null;
        }
      }
      return null;
    };

    const getMint = (payload: any): string | null => {
      const mint =
        payload?.mint ??
        payload?.tokenMint ??
        payload?.token?.mint ??
        payload?.token_address ??
        payload?.tokenAddress;
      return typeof mint === 'string' && mint.length > 0 ? mint : null;
    };

    const applyLivePatch = (payload: any, forceGraduated = false) => {
      const mint = getMint(payload);
      if (!mint) return;

      const virtualSol =
        payload?.virtualSolReserves ??
        payload?.token?.virtualSolReserves ??
        payload?.virtual_sol_reserves;
      const virtualToken =
        payload?.virtualTokenReserves ??
        payload?.token?.virtualTokenReserves ??
        payload?.virtual_token_reserves;
      const realSol =
        payload?.realSolReserves ??
        payload?.token?.realSolReserves ??
        payload?.real_sol_reserves;

      const patch: Partial<Token> = {};
      const virtualSolBigInt = toBigInt(virtualSol);
      const virtualTokenBigInt = toBigInt(virtualToken);
      const realSolBigInt = toBigInt(realSol);

      if (virtualSolBigInt !== null) patch.virtualSolReserves = virtualSolBigInt;
      if (virtualTokenBigInt !== null) patch.virtualTokenReserves = virtualTokenBigInt;
      if (realSolBigInt !== null) patch.realSolReserves = realSolBigInt;
      if (payload?.graduated !== undefined) patch.graduated = Boolean(payload.graduated);
      if (forceGraduated) patch.graduated = true;

      if (Object.keys(patch).length === 0) return;

      setLiveTokenByMint((prev) => ({
        ...prev,
        [mint]: {
          ...prev[mint],
          ...patch,
        },
      }));

      setLiveNew((prev) =>
        prev.map((t) => (t.mint === mint ? { ...t, ...patch } : t))
      );
    };

    const handleTradeNew = (payload: any) => applyLivePatch(payload);
    const handlePriceUpdate = (payload: any) => applyLivePatch(payload);
    const handleTokenUpdated = (payload: any) => applyLivePatch(payload);
    const handleGraduated = (payload: any) => applyLivePatch(payload, true);

    socket.on('trade:new', handleTradeNew);
    socket.on('price:update', handlePriceUpdate);
    socket.on('token:updated', handleTokenUpdated);
    socket.on('token:graduated', handleGraduated);

    return () => {
      socket.off('trade:new', handleTradeNew);
      socket.off('price:update', handlePriceUpdate);
      socket.off('token:updated', handleTokenUpdated);
      socket.off('token:graduated', handleGraduated);
    };
  }, [socket, connected]);

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

const handleQuickBuy = async (token: Token, amount: string) => {
  const sol = Number(amount);
  if (!sol || sol <= 0) {
    toast.error('Enter valid SOL');
    return;
  }

  try {
    setBuyingMint(token.mint);
    const lamports = Math.floor(sol * 1e9);

    if (!token.graduated) {
      // 🟢 bonding curve
      await buy(token.mint, lamports, 100);
    } else {
      // 🔥 Meteora swap (REAL)
      if (!token.meteoraPool) {
        toast.error('No pool');
        return;
      }

      await buyOnMeteora(
        token.meteoraPool,
        token.mint,
        lamports,
        100 // slippage
      );
    }

    toast.success(`Bought ${token.symbol}`);
  } catch (err: any) {
    toast.error(err?.message || 'Buy failed');
  } finally {
    setBuyingMint(null);
  }
};
  const openToken = (token: Token) => {
    if (!token?.mint) return;
    router.push(`/token/${token.mint}`);
  };

  const map = new Map<string, Token>();
  [...(newData?.tokens ?? []), ...(gradData?.tokens ?? []), ...(listedData?.tokens ?? []), ...liveNew]
    .forEach((t) => {
      const patch = liveTokenByMint[t.mint];
      map.set(t.mint, patch ? { ...t, ...patch } : t);
    });

  const all = Array.from(map.values());
const getBondingProgress = (token: Token) => {
  const realSol = Number(token.realSolReserves || 0) / 1e9;
  const threshold = 60;

  if (token.graduated) return 100;

  return Math.max(0, Math.min((realSol / threshold) * 100, 100));
};


// 🔥 2. NEW TOKENS (<75%)
const newList = all
  .filter((t) => {
    const pct = getBondingProgress(t);
    return pct < 75 && !t.graduated;
  })
  .sort(
    (a, b) =>
      new Date(String(b.createdAt)).getTime() -
      new Date(String(a.createdAt)).getTime()
  );


// 🔥 3. GRADUATING TOKENS (>=75% && NOT graduated)
const graduating = all
  .filter((t) => {
    const pct = getBondingProgress(t);
    return pct >= 75 && !t.graduated;
  })
  .sort((a, b) => getBondingProgress(b) - getBondingProgress(a));


// 🔥 4. LISTED TOKENS (graduated = true)
const listed = all
  .filter((t) => t.graduated === true)
  .sort((a, b) => getBondingProgress(b) - getBondingProgress(a));

  return (
<div style={{ background: '#060f1a', padding: '0 0 24px' }}>
      {/* Page Title */}
      <div style={{ padding: '20px 20px 12px' }}>
        <h1 className="text-2xl md:text-4xl font-semibold text-white">
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
          buyAmount={buyAmounts.newlyCreated}
          onBuyAmountChange={(v) =>
            setBuyAmounts((prev) => ({ ...prev, newlyCreated: v }))
          }
          paused={newPaused}
          onTogglePaused={handleToggleNewPause}
          onOpenToken={openToken}
          onQuickBuy={(token) => handleQuickBuy(token, buyAmounts.newlyCreated)}
          buyingMint={buyingMint}
        />
        <Panel
          title="Graduating"
          tokens={graduating}
          isLoading={!gradData}
          variant="graduating"
          liveCount={0}
          buyAmount={buyAmounts.graduating}
          onBuyAmountChange={(v) =>
            setBuyAmounts((prev) => ({ ...prev, graduating: v }))
          }
          onOpenToken={openToken}
          onQuickBuy={(token) => handleQuickBuy(token, buyAmounts.graduating)}
          buyingMint={buyingMint}
        />
        <Panel
          title="Listed on Meteora"
          tokens={listed}
          isLoading={!listedData}
          variant="listed"
          liveCount={0}
          buyAmount={buyAmounts.listed}
          onBuyAmountChange={(v) =>
            setBuyAmounts((prev) => ({ ...prev, listed: v }))
          }
          onOpenToken={openToken}
          onQuickBuy={(token) => handleQuickBuy(token, buyAmounts.listed)}
          buyingMint={buyingMint}
        />
      </div>
    </div>
  );
};
