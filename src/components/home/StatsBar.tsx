'use client';

import { FC, useEffect, useMemo, useState } from 'react';
import { useTokens, Token } from '@/hooks/useApi';
import { useSocket } from '@/components/providers/SocketProvider';
import { useSolPrice } from '@/hooks/useSolPrice';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { AppLoader } from '../Apploader';

/* ─── Constants ─────────────────────────────────────── */
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

const HEADER: Record<Variant, string> = {
  new: '#08172A',
  graduating: 'linear-gradient(90deg, #6E45FF 0%, #E04B29 50%, #F57B00 100%)',
  listed: 'linear-gradient(90deg, #4284FD 50%, #FE9216 100%)',
};

const PANEL_ICON: Record<Variant, string> = {
  new: '👀',
  graduating: '🎓',
  listed: '🔥',
};

/* ─── Helpers ─────────────────────────────────────────── */
const getRealMarketCap = (token: Token, solPriceUsd: number) => {
  const virtualSol = Number(token.virtualSolReserves || 0) / 1e9;
  const virtualTokens = Number(token.virtualTokenReserves || 0) / 1e6;
  if (virtualTokens > 0 && virtualSol > 0) {
    return (virtualSol / virtualTokens) * TOTAL_SUPPLY * solPriceUsd;
  }
  return token.marketCap || 0;
};

const getBondingProgress = (token: Token) => {
  if (token.graduated) return 100;
  const realSol = Number(token.realSolReserves || 0) / 1e9;
  return Math.max(0, Math.min((realSol / 60) * 100, 100));
};

/* ─── Token Row ───────────────────────────────────────── */
const TokenRow: FC<{ token: Token; variant: Variant }> = ({ token, variant }) => {
  const { price: solPriceUsd } = useSolPrice();
  const [imgError, setImgError] = useState(false);

  const av = palette(token.name);
  const defaultImage = `https://api.dicebear.com/7.x/shapes/svg?seed=${token.mint}`;

  const realMC = useMemo(
    () => getRealMarketCap(token, solPriceUsd),
    [token, solPriceUsd]
  );

  const pct = getBondingProgress(token);

  return (
    <Link href={`/token/${token.mint}`} style={{ textDecoration: 'none' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: 12,
          background: '#081728',
          borderRadius: 14,
          marginBottom: 10,
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 54,
            height: 54,
            borderRadius: 12,
            flexShrink: 0,
            overflow: 'hidden',
            background: av.bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 600,
            color: av.color,
          }}
        >
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

        {/* Middle */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <p
              style={{
                color: '#fff',
                fontSize: 14,
                fontWeight: 700,
                margin: 0,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '60%',
              }}
            >
              {token.name}
            </p>
            <p style={{ color: '#f97316', fontSize: 12 }}>
              {timeAgo(String(token.createdAt))}
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <p style={{ color: '#5a80a0', fontSize: 11 }}>{token.symbol}</p>
            <p style={{ color: '#8aadcc', fontSize: 12 }}>MC: {formatMC(realMC)}</p>
          </div>

          <div
            style={{
              height: 5,
              background: '#0f2a45',
              borderRadius: 10,
              overflow: 'hidden',
              marginTop: 6,
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #3b82f6, #f59e0b)',
                borderRadius: 10,
                transition: 'width 0.5s ease',
              }}
            />
          </div>

          <p style={{ textAlign: 'right', fontSize: 11, color: '#6a90b0' }}>
            {pct.toFixed(0)}%
          </p>
        </div>
      </div>
    </Link>
  );
};

/* ─── Panel ───────────────────────────────────────────── */
const Panel: FC<{
  title: string;
  tokens: Token[];
  isLoading: boolean;
  variant: Variant;
}> = ({ title, tokens, isLoading, variant }) => (
  <div style={{ borderRadius: 16, overflow: 'hidden', background: 'rgba(63,76,92,0.5)' }}>
    <div
      style={{
        padding: 14,
        background: HEADER[variant],
        color: '#fff',
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      {variant === 'listed' ? (
        <img
          src="/images/metora.png"
          alt="metora"
          style={{ width: 20, height: 20, objectFit: 'contain' }}
        />
      ) : (
        <span>{PANEL_ICON[variant]}</span>
      )}
      <span style={{ fontSize: '20px' }}>{title}</span>
    </div>

    <div
      style={{
        padding: 12,
        maxHeight: 340,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {isLoading ? (
        <AppLoader size={50}  />
      ) : (
        tokens.map((t) => <TokenRow key={t.mint} token={t} variant={variant} />)
      )}
    </div>
  </div>
);

/* ─── Main ───────────────────────────────────────────── */
export const TokenPanels: FC = () => {
  const [liveNew, setLiveNew] = useState<Token[]>([]);

  // ✅ Patch map: receives reserve/graduation updates from trade:new + token:updated
  const [overrides, setOverrides] = useState<Record<string, Partial<Token>>>({});

  const { socket, connected } = useSocket();
  const { price: solPriceUsd } = useSolPrice();

  const { data: newData } = useTokens({ sort: 'createdAt', order: 'desc', limit: 50 });
  const { data: gradData } = useTokens({ sort: 'marketCap', order: 'desc', limit: 50 });
  const { data: listedData } = useTokens({
    sort: 'marketCap',
    order: 'desc',
    limit: 50,
    graduated: true,
  });

  useEffect(() => {
    if (!socket || !connected) return;

    // ── New token created ──────────────────────────────
    const handleTokenCreated = (t: Token) => {
      toast.success(`New token: ${t.name}`);
      setLiveNew((prev) => [t, ...prev]);
    };

    // ── Trade happened → reserves changed → MC + progress update ──
    // Mirrors TokenDetail's handleNewTrade pattern exactly
    const handleNewTrade = (data: any) => {
      const { mint } = data;
      if (!mint) return;

      setOverrides((prev) => {
        const existing = prev[mint] ?? {};
        const updates: Partial<Token> = { ...existing };

        // Update reserves from trade data (same logic as TokenDetail)
        if (!data.isMeteoraSwap) {
          if (data.virtualSolReserves) updates.virtualSolReserves = data.virtualSolReserves;
          if (data.virtualTokenReserves) updates.virtualTokenReserves = data.virtualTokenReserves;
          if (data.realSolReserves) updates.realSolReserves = data.realSolReserves;
        }

        return { ...prev, [mint]: updates };
      });

      // Also patch liveNew tokens (ones not yet in API response)
      setLiveNew((prev) =>
        prev.map((t) => {
          if (t.mint !== mint) return t;
          return {
            ...t,
            ...(data.virtualSolReserves && { virtualSolReserves: data.virtualSolReserves }),
            ...(data.virtualTokenReserves && { virtualTokenReserves: data.virtualTokenReserves }),
            ...(data.realSolReserves && { realSolReserves: data.realSolReserves }),
          };
        })
      );
    };

    // ── Full token object update (e.g. after graduation) ──
    // Mirrors TokenDetail's handleGraduated pattern
    const handleTokenUpdated = (updated: Token) => {
      if (!updated?.mint) return;
      setOverrides((prev) => ({
        ...prev,
        [updated.mint]: { ...(prev[updated.mint] ?? {}), ...updated },
      }));
      setLiveNew((prev) =>
        prev.map((t) => (t.mint === updated.mint ? { ...t, ...updated } : t))
      );
    };

    // ── Token graduated → flip graduated flag immediately ──
    const handleGraduated = (data: any) => {
      if (!data?.mint) return;
      toast.success(`🚀 ${data.mint.slice(0, 6)}... graduated to Meteora!`);
      setOverrides((prev) => ({
        ...prev,
        [data.mint]: {
          ...(prev[data.mint] ?? {}),
          graduated: true,
          ...(data.meteoraPool && { meteoraPool: data.meteoraPool }),
          ...(data.realSolReserves && { realSolReserves: data.realSolReserves }),
        },
      }));
      setLiveNew((prev) =>
        prev.map((t) =>
          t.mint === data.mint
            ? { ...t, graduated: true, ...(data.meteoraPool && { meteoraPool: data.meteoraPool }) }
            : t
        )
      );
    };

    // ── Price update event (some backends emit this separately) ──
    const handlePriceUpdate = (data: any) => {
      if (!data?.mint) return;
      setOverrides((prev) => ({
        ...prev,
        [data.mint]: {
          ...(prev[data.mint] ?? {}),
          ...(data.virtualSolReserves && { virtualSolReserves: data.virtualSolReserves }),
          ...(data.virtualTokenReserves && { virtualTokenReserves: data.virtualTokenReserves }),
          ...(data.realSolReserves && { realSolReserves: data.realSolReserves }),
        },
      }));
    };

    socket.on('token:created', handleTokenCreated);
    socket.on('trade:new', handleNewTrade);
    socket.on('token:updated', handleTokenUpdated);
    socket.on('token:graduated', handleGraduated);
    socket.on('price:update', handlePriceUpdate);

    return () => {
      socket.off('token:created', handleTokenCreated);
      socket.off('trade:new', handleNewTrade);
      socket.off('token:updated', handleTokenUpdated);
      socket.off('token:graduated', handleGraduated);
      socket.off('price:update', handlePriceUpdate);
    };
  }, [socket, connected]);

  // ── Merge API data + live new tokens + real-time overrides ──
  const all = useMemo(() => {
    const map = new Map<string, Token>();

    // Base layer: API fetched tokens
    [
      ...(newData?.tokens ?? []),
      ...(gradData?.tokens ?? []),
      ...(listedData?.tokens ?? []),
      ...liveNew,
    ].forEach((t) => map.set(t.mint, t));

    // Override layer: real-time reserve/graduation patches (most recent wins)
    for (const [mint, patch] of Object.entries(overrides)) {
      const existing = map.get(mint);
      if (existing) {
        map.set(mint, { ...existing, ...patch });
      }
    }

    return Array.from(map.values());
  }, [newData, gradData, listedData, liveNew, overrides]);

  // ── Categorise ────────────────────────────────────────
  const newList = useMemo(
    () =>
      all
        .filter((t) => getBondingProgress(t) < 75 && !t.graduated)
        .sort(
          (a, b) =>
            new Date(String(b.createdAt)).getTime() -
            new Date(String(a.createdAt)).getTime()
        ),
    [all]
  );

  const graduating = useMemo(
    () =>
      all
        .filter((t) => getBondingProgress(t) >= 75 && !t.graduated)
        .sort((a, b) => getBondingProgress(b) - getBondingProgress(a)),
    [all]
  );

  const listed = useMemo(
    () =>
      all
        .filter((t) => t.graduated === true)
        .sort((a, b) => getBondingProgress(b) - getBondingProgress(a)),
    [all]
  );

  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
      style={{ gap: 16, padding: 16 }}
    >
      <Panel title="Newly Created" tokens={newList} isLoading={!newData} variant="new" />
      <Panel title="Graduating" tokens={graduating} isLoading={!gradData} variant="graduating" />
      <Panel title="Listed on Meteora" tokens={listed} isLoading={!listedData} variant="listed" />
    </div>
  );
};