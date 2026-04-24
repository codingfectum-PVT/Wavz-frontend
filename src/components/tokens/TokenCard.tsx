'use client';

import { FC, useMemo, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatNumber, formatPrice, formatTimeAgo } from '@/lib/utils';
import { useSolPrice } from '@/hooks/useSolPrice';
import type { Token } from '@/hooks/useApi';
import { useOnChainHolders } from '@/hooks/useOnChainHolders';
import { useSocket } from '@/components/providers/SocketProvider';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export const TokenCard: FC<{ token: Token }> = ({ token }) => {
  const priceChange = token.priceChange24h || 0;
  const isPositive = priceChange >= 0;

  const { holders: onChainHolders } = useOnChainHolders(token.mint);
  const { socket } = useSocket();
  const { price: solPriceUsd } = useSolPrice();

  const [isNew, setIsNew] = useState(false);
  const [meteoraPrice, setMeteoraPrice] = useState<number | null>(null);
  const [metadata, setMetadata] = useState<any>(null);

  // 🔥 LIVE TRADES STATE (mirrors TokenDetail)
  const [activityTrades, setActivityTrades] = useState<any[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
const [liveReserves, setLiveReserves] = useState({
  virtualSolReserves: token.virtualSolReserves,
  virtualTokenReserves: token.virtualTokenReserves,
});
  useEffect(() => {
    setIsNew(true);
    const timer = setTimeout(() => setIsNew(false), 800);
    return () => clearTimeout(timer);
  }, [token.mint]);

  // 🔥 FETCH TRADES from DB + poll every 15s (identical to TokenDetail)
  useEffect(() => {
    let cancelled = false;

    const fetchTrades = async (isInitial = false) => {
      if (isInitial) setActivityLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/trades/token/${token.mint}?limit=50`);
        if (!res.ok) throw new Error('Failed to fetch trades');
        const data = await res.json();
        const dbTrades: any[] = Array.isArray(data.trades) ? data.trades : [];
        if (!cancelled) {
          setActivityTrades(prev => {
            const dbSigs = new Set(dbTrades.map((t: any) => t.signature));
            const rtOnly = prev.filter((t: any) => !dbSigs.has(t.signature));
            return [...rtOnly, ...dbTrades].slice(0, 50);
          });
        }
      } catch {
        if (isInitial && !cancelled) setActivityTrades([]);
      } finally {
        if (isInitial && !cancelled) setActivityLoading(false);
      }
    };

    fetchTrades(true);
    const interval = setInterval(() => fetchTrades(false), 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token.mint]);

  // 🔥 REAL-TIME TRADE updates via WebSocket (mirrors TokenDetail)
  useEffect(() => {
    if (!socket) return;

    if (socket.connected) socket.emit('subscribe:token', token.mint);
    const handleConnect = () => socket.emit('subscribe:token', token.mint);
    socket.on('connect', handleConnect);

  const handleNewTrade = (data: any) => {
  if (data.mint !== token.mint) return;

  // 🔥 update trades (existing)
  setActivityTrades(prev => {
    if (prev.some((t: any) => t.signature === data.signature)) return prev;
    return [{
      signature: data.signature,
      isBuy: data.isBuy,
      solAmount: data.solAmount,
      tokenAmount: data.tokenAmount,
      price: data.price,
      timestamp: data.timestamp ?? new Date().toISOString(),
      walletAddress: data.userAddress,
    }, ...prev].slice(0, 50);
  });

  // 🔥 NEW: update reserves (THIS IS THE FIX)
  if (!data.isMeteoraSwap) {
    setLiveReserves(prev => ({
      virtualSolReserves: data.virtualSolReserves || prev.virtualSolReserves,
      virtualTokenReserves: data.virtualTokenReserves || prev.virtualTokenReserves,
    }));
  }
};

    socket.on('trade:new', handleNewTrade);
    return () => {
      socket.emit('unsubscribe:token', token.mint);
      socket.off('connect', handleConnect);
      socket.off('trade:new', handleNewTrade);
    };
  }, [socket, token.mint]);

  // 🔥 METEORA PRICE for graduated tokens
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
        const dlmm = await DLMM.create(connection, new PublicKey(token.meteoraPool!), { cluster: 'devnet' });
        const activeBin = await dlmm.getActiveBin();
        setMeteoraPrice(parseFloat(activeBin.price) / 1000);
      } catch (err) {
        console.error('TokenCard: Failed to fetch Meteora price:', err);
      }
    };

    fetchMeteoraPrice();
    const interval = setInterval(fetchMeteoraPrice, 30000);
    return () => clearInterval(interval);
  }, [token.graduated, token.meteoraPool]);

  // 🔥 METADATA
  useEffect(() => {
    if (!token.uri) return;
    const fetchMeta = async () => {
      try {
        const res = await fetch(token.uri!);
        setMetadata(await res.json());
      } catch {}
    };
    fetchMeta();
  }, [token.uri]);

  // 🔥 24h VOLUME from live trades (identical to TokenDetail's marketStatsByWindow['24h'])
  const volume24hUsd = useMemo(() => {
    const windowMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const trades = activityTrades.filter(
      (t: any) => now - new Date(t.timestamp).getTime() <= windowMs
    );
    const volSol = trades.reduce(
      (sum: number, t: any) => sum + (Number(t.solAmount) / 1e9 || 0),
      0
    );
    const liveUsd = volSol * solPriceUsd;

    // Fall back to DB value if live trades haven't loaded yet
    return !activityLoading && liveUsd > 0
      ? liveUsd
      : Number(token.volume24h || 0) * solPriceUsd;
  }, [activityTrades, activityLoading, solPriceUsd, token.volume24h]);

  // 🔥 MARKET CAP — Meteora for graduated, bonding curve otherwise
  const liquidityMarketCap = useMemo(() => {
    const TOTAL_SUPPLY = 1_000_000_000;
    if (token.graduated && meteoraPrice !== null) {
      return meteoraPrice * TOTAL_SUPPLY * solPriceUsd;
    }
 const virtualSol = Number(liveReserves.virtualSolReserves || 0) / 1e9;
   const virtualTokens = Number(liveReserves.virtualTokenReserves || 0) / 1e6;
    if (virtualTokens > 0 && virtualSol > 0) {
      return (virtualSol / virtualTokens) * TOTAL_SUPPLY * solPriceUsd;
    }
    return 0;
  },  [
  liveReserves.virtualSolReserves,
  liveReserves.virtualTokenReserves,
  token.graduated,
  meteoraPrice,
  solPriceUsd
]);;

  const holders = onChainHolders.length > 0
    ? onChainHolders.filter((holder: any) => {
        const bal = Number(holder.balance || holder.amount || 0) / 1e6;
        const pct = token.virtualTokenReserves
          ? (bal / (Number(token.virtualTokenReserves) / 1e6)) * 100
          : 0;
        if (bal <= 0) return false;
        if (pct > 80) return false;
        return true;
      }).length
    : (token._count?.holders || 0);

  const defaultImage = `https://api.dicebear.com/7.x/shapes/svg?seed=${token.mint}`;

  const socialFromAttributes = Array.isArray(metadata?.attributes)
    ? metadata.attributes.reduce((acc: any, item: any) => {
        const type = String(item?.trait_type || '').toLowerCase().trim();
        const value = String(item?.value || '').trim();
        if (!value) return acc;
        if (type === 'twitter' || type === 'x') acc.twitter = value;
        if (type === 'telegram' || type === 'tg') acc.telegram = value;
        if (type === 'website' || type === 'web') acc.website = value;
        return acc;
      }, {})
    : {};

  const socialLinks = {
    twitter: token.twitter || metadata?.twitter || metadata?.x || socialFromAttributes.twitter || metadata?.extensions?.twitter || '',
    telegram: token.telegram || metadata?.telegram || socialFromAttributes.telegram || metadata?.extensions?.telegram || '',
    website: token.website || metadata?.website || metadata?.external_url || socialFromAttributes.website || metadata?.extensions?.website || '',
  };

  const normalizeLink = (url?: string) => {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    return `https://${url}`;
  };

  return (
    <Link href={`/token/${token.mint}`}>
      <div
        className={`relative rounded-2xl overflow-hidden bg-[#08172A] 
        hover:scale-[1.02] transition-all duration-300 cursor-pointer pump-hover
        ${isNew ? 'pump-animation' : ''}`}
      >
        {/* TOP BANNER */}
        <div className="relative h-[110px] w-full">
          <Image
            src={token.banner || token.image || defaultImage}
            alt={token.name}
            fill
            className="object-cover"
          />
          <div
            className={`absolute top-3 right-3 flex items-center gap-1 px-2 py-1 text-xs rounded-full ${
              isPositive ? 'bg-[#09182b] text-[#84FF00]' : 'bg-red-500 text-white'
            }`}
          >
            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            <span>{Math.abs(priceChange).toFixed(2)}%</span>
          </div>
        </div>

        {/* CONTENT */}
        <div className="relative px-4 pb-4 pt-10">
          {/* FLOATING AVATAR */}
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 w-16 h-16 rounded-xl overflow-hidden border-2 border-[#071B2F] shadow-lg">
            <Image src={token.image || defaultImage} alt={token.name} fill className="object-cover" />
          </div>

          {/* NAME */}
          <div className="text-center mt-2">
            <h3 className="text-white font-semibold">{token.name}</h3>
            <p className="text-xs text-gray-400">${token.symbol}</p>
          </div>

          {/* PRICE + SOCIALS */}
          <div className="flex justify-between items-center mt-4">
            <div>
              <p className="text-xs text-gray-400">Price</p>
              <p className="text-white font-medium">
                {formatPrice(token.price || 0, solPriceUsd)}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {socialLinks.telegram && (
                <a href={normalizeLink(socialLinks.telegram)} target="_blank">
                  <Image src="/images/tgbg.png" alt="tg" width={25} height={25} />
                </a>
              )}
              {socialLinks.twitter && (
                <a href={normalizeLink(socialLinks.twitter)} target="_blank">
                  <Image src="/images/xbg.png" alt="x" width={25} height={25} />
                </a>
              )}
              {socialLinks.website && (
                <a href={normalizeLink(socialLinks.website)} target="_blank">
                  <Image src="/images/webbg.png" alt="web" width={25} height={25} />
                </a>
              )}
            </div>
          </div>

          {/* STATS */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            <div className="bg-[#182536] rounded-xl p-2">
              <p className="text-[13px] text-gray-400">MarketCap</p>
              <p className="text-white text-sm font-medium">
                {token.graduated && meteoraPrice === null
                  ? <span className="text-gray-500 text-xs">Loading…</span>
                  : `$${formatNumber(liquidityMarketCap)}`
                }
              </p>
            </div>

            <div className="bg-[#182536] rounded-xl p-2">
              <p className="text-[13px] text-gray-400">Volume</p>
              <p className="text-white text-sm font-medium">
                {/* Show loading only when graduated and trades still fetching */}
                {token.graduated && activityLoading
                  ? <span className="text-gray-500 text-xs">Loading…</span>
                  : `$${formatNumber(volume24hUsd)}`
                }
              </p>
            </div>

            <div className="bg-[#182536] rounded-xl p-2">
              <p className="text-[13px] text-gray-400">Holders</p>
              <p className="text-white text-sm font-medium">{holders}</p>
            </div>
          </div>

          {/* FOOTER */}
          <div className="mt-4 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-[#6FA8FF]">
              <img src="/images/duck.png" alt="creator" className="w-4 h-4 object-contain" />
              <span className="font-medium">
                {token.creatorAddress.slice(0, 4)}...{token.creatorAddress.slice(-4)}
              </span>
            </div>
            <div className="text-gray-400">
              Created {formatTimeAgo(
                typeof token.createdAt === 'number'
                  ? token.createdAt
                  : new Date(token.createdAt).getTime()
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
};