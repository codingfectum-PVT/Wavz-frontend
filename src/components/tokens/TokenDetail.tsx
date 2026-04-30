'use client';

import { FC, useState, useEffect, useMemo, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { 
  ExternalLink, 
  Users, 
  Copy,
  Check,
  Rocket,
  Loader2
} from 'lucide-react';
import { TradePanel } from './TradePanel';
import { PriceChart } from './PriceChart';
import { CommentSection } from './CommentSection';
import { formatNumber, shortenAddress, formatTimeAgo } from '@/lib/utils';
import { useSocket } from '@/components/providers/SocketProvider';
import { useSolPrice } from '@/hooks/useSolPrice';
import { useOnChainHolders } from '@/hooks/useOnChainHolders';
import toast from 'react-hot-toast';
import { AppLoader } from '../Apploader';
import { MobileTokenDetail } from '../MobileTokenDetail';

interface TokenDetailProps {
  mint: string;
}

interface Token {
  mint: string;
  name: string;
  symbol: string;
  uri: string | null;
  description?: string;
  image?: string;
  creatorAddress: string;
  virtualSolReserves: string;
  virtualTokenReserves: string;
  realSolReserves: string;
  realTokenReserves: string;
  graduated: boolean;
  meteoraPool?: string;
  createdAt: string;
  _count?: {
    trades: number;
    holders: number;
  };
  volume24h?: number;
  twitter?: string;
  telegram?: string;
  website?: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export const TokenDetail: FC<TokenDetailProps> = ({ mint }) => {
  const [copied, setCopied] = useState(false);
  const [token, setToken] = useState<Token | null>(null);
  const [metadata, setMetadata] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGraduating, setIsGraduating] = useState(false);
  const [meteoraPrice, setMeteoraPrice] = useState<number | null>(null);
  const [chartPrice, setChartPrice] = useState<number | null>(null);
  const [latestTradePrice, setLatestTradePrice] = useState<number | null>(null);
  const [priceInitializing, setPriceInitializing] = useState(true);
  const [activityTab, setActivityTab] = useState<'transactions' | 'holders' | 'threads'>('transactions');
  const [marketWindow, setMarketWindow] = useState<'5m' | '1h' | '6h' | '24h'>('5m');
  const [activityTrades, setActivityTrades] = useState<any[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  
  const { socket, subscribeToToken, unsubscribeFromToken, connected } = useSocket();
  const { price: solPriceUsd } = useSolPrice();
  const { holders: onChainHolders, loading: holdersLoading, refetch: refetchHolders } = useOnChainHolders(mint);
  // Keep a ref so the WebSocket effect closure always calls the latest refetch
  const refetchHoldersRef = useRef(refetchHolders);
  useEffect(() => { refetchHoldersRef.current = refetchHolders; }, [refetchHolders]);

  useEffect(() => {
    let cancelled = false;

    const fetchToken = async (retries = 5) => {
      try {
        setLoading(true);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(`${API_URL}/api/tokens/${mint}`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
          if (res.status === 404 && retries > 0) {
            // Token might not be in DB yet - retry after a short delay
            await new Promise(r => setTimeout(r, 1500));
            if (!cancelled) return fetchToken(retries - 1);
            return;
          }
          throw new Error('Token not found');
        }
        const data = await res.json();
        if (cancelled) return;
        setToken(data);
// console.log("data",data);

        // Fetch metadata from URI if available
        if (data.uri) {
          try {
            const metaRes = await fetch(data.uri);
            const metaData = await metaRes.json();
            // console.log("metaDassta",metaData);
            
            if (!cancelled) setMetadata(metaData);
          } catch (e) {
            // console.log('Could not fetch metadata from URI');
          }
        }
      } catch (err) {
        if (!cancelled) {
          // On timeout or network error, retry if we have retries left
          if (retries > 0 && (err instanceof DOMException || (err instanceof Error && err.message !== 'Token not found'))) {
            await new Promise(r => setTimeout(r, 1500));
            if (!cancelled) return fetchToken(retries - 1);
            return;
          }
          setError(err instanceof Error ? err.message : 'Failed to load token');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchToken();

    return () => { cancelled = true; };
  }, [mint]);

  // Fetch latest trade price immediately so the card shows the correct price before the chart loads
  useEffect(() => {
    let cancelled = false;
    const fetchLatestPrice = async () => {
      try {
        const res = await fetch(`${API_URL}/api/trades/token/${mint}?limit=1`);
        if (!res.ok) return;
        const data = await res.json();
        const trades: any[] = Array.isArray(data.trades) ? data.trades : [];
        if (trades.length > 0 && trades[0].price && !cancelled) {
          setLatestTradePrice(trades[0].price);
        }
      } catch {
        // silently ignore — bonding curve price is the fallback
      } finally {
        if (!cancelled) setPriceInitializing(false);
      }
    };
    fetchLatestPrice();
    return () => { cancelled = true; };
  }, [mint]);

  // WebSocket connection for real-time updates
  useEffect(() => {
    if (!socket) return;

    // Subscribe when socket connects
    const handleConnect = () => {
      socket.emit('subscribe:token', mint);
    };

    // If already connected, subscribe immediately
    if (socket.connected) {
      socket.emit('subscribe:token', mint);
    }

    socket.on('connect', handleConnect);

    // Handle price updates (bonding curve)
    const handlePriceUpdate = (data: any) => {
      if (data.mint === mint) {
        setToken(prev => prev ? {
          ...prev,
          virtualSolReserves: data.virtualSolReserves,
          virtualTokenReserves: data.virtualTokenReserves,
          realSolReserves: data.realSolReserves ?? prev.realSolReserves,
        } : null);
      }
    };

    // Handle new trade (for price updates, holders, trade count, and reserves)
    const handleNewTrade = (data: any) => {
      if (data.mint !== mint) return;
      
      // Update Meteora price from trade
      // data.price is already normalized (SOL/token) — backend divides by 1000 before storing/emitting
      if (data.isMeteoraSwap && data.price) {
        setMeteoraPrice(data.price);
      }

      // Update latest trade price for bonding curve tokens
      if (!data.isMeteoraSwap && data.price) {
        setLatestTradePrice(data.price);
      }

      // Prepend new trade to activity list in real-time
      setActivityTrades((prev: any[]) => {
        if (prev.some((t: any) => t.signature === data.signature)) return prev;
        const newTrade = {
          signature: data.signature,
          isBuy: data.isBuy,
          solAmount: data.solAmount,
          tokenAmount: data.tokenAmount,
          price: data.price,
          timestamp: data.timestamp ?? new Date().toISOString(),
          walletAddress: data.userAddress,
        };
        return [newTrade, ...prev].slice(0, 50);
      });
      
      // Update holder count, trade count, and reserves from every trade
      setToken(prev => {
        if (!prev) return null;
        const updates: Partial<Token> = {
          _count: {
            trades: (prev._count?.trades ?? 0) + 1,
            holders: data.holderCount ?? prev._count?.holders ?? 0,
          },
        };
        // For bonding curve trades, update reserves from trade data
        if (!data.isMeteoraSwap) {
          if (data.virtualSolReserves) updates.virtualSolReserves = data.virtualSolReserves;
          if (data.virtualTokenReserves) updates.virtualTokenReserves = data.virtualTokenReserves;
          if (data.realSolReserves) updates.realSolReserves = data.realSolReserves;
        }
        return { ...prev, ...updates };
      });

      // Refetch on-chain holders so the list updates immediately after a trade
      refetchHoldersRef.current();
    };

    // Handle ready to graduate event
    const handleReadyToGraduate = (data: any) => {
      if (data.mint === mint) {
        // console.log('Token ready to graduate!', data);
        setIsGraduating(true);
        setToken(prev => prev ? {
          ...prev,
          realSolReserves: data.realSolReserves || prev.realSolReserves,
        } : null);
        toast.loading('🎓 Graduating to Meteora...', { id: 'graduation' });
      }
    };

    // Handle graduation complete event
    const handleGraduated = (data: any) => {
      if (data.mint === mint) {
        // console.log('Token graduated!', data);
        setIsGraduating(false);
        setToken(prev => prev ? { 
          ...prev, 
          graduated: true,
          meteoraPool: data.meteoraPool || prev.meteoraPool,
        } : null);
        // toast.success(
        //   `🚀 Token graduated to Meteora!\n${data.meteoraPool ? `Pool: ${data.meteoraPool.slice(0, 8)}...` : ''}`,
        //   { id: 'graduation', duration: 5000 }
        // );
      }
    };

    socket.on('price:update', handlePriceUpdate);
    socket.on('trade:new', handleNewTrade);
    socket.on('token:ready_to_graduate', handleReadyToGraduate);
    socket.on('token:graduated', handleGraduated);

    return () => {
      socket.emit('unsubscribe:token', mint);
      socket.off('connect', handleConnect);
      socket.off('price:update', handlePriceUpdate);
      socket.off('trade:new', handleNewTrade);
      socket.off('token:ready_to_graduate', handleReadyToGraduate);
      socket.off('token:graduated', handleGraduated);
    };
  }, [socket, mint]);

  // Activity trades for transaction tab — fetch from DB + poll every 15s
  useEffect(() => {
    let cancelled = false;
    const fetchActivityTrades = async (isInitial = false) => {
      if (isInitial) setActivityLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/trades/token/${mint}?limit=50`);
        if (!res.ok) throw new Error('Failed to fetch activity trades');
        const data = await res.json();
        const dbTrades: any[] = Array.isArray(data.trades) ? data.trades : [];
        if (!cancelled) {
          // Merge: keep any real-time WS trades not yet in DB, put them first
          setActivityTrades(prev => {
            const dbSigs = new Set(dbTrades.map((t: any) => t.signature));
            const rtOnly = prev.filter((t: any) => !dbSigs.has(t.signature));
            return [...rtOnly, ...dbTrades].slice(0, 50);
          });
        }
      } catch (err) {
        console.error('Failed to fetch activity trades:', err);
        if (isInitial && !cancelled) setActivityTrades([]);
      } finally {
        if (isInitial && !cancelled) setActivityLoading(false);
      }
    };
    fetchActivityTrades(true);
    const interval = setInterval(() => fetchActivityTrades(false), 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mint]);

  // Keep latestTradePrice in sync with the most recent trade from activityTrades
  useEffect(() => {
    if (activityTrades.length > 0 && activityTrades[0].price) {
      setLatestTradePrice(activityTrades[0].price);
    }
  }, [activityTrades]);

  // Fetch Meteora price for graduated tokens
  useEffect(() => {
    if (!token?.graduated || !token?.meteoraPool) {
      setMeteoraPrice(null);
      return;
    }

    const fetchMeteoraPrice = async () => {
      try {
        const { deriveTokenVaultAddress } = await import('@meteora-ag/cp-amm-sdk');
        const { Connection, PublicKey } = await import('@solana/web3.js');
        const { NATIVE_MINT } = await import('@solana/spl-token');

        const connection = new Connection(
          process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com'
        );

        const poolPubkey = new PublicKey(token.meteoraPool!);
        const mintPubkey = new PublicKey(token.mint!);

        const tokenAVault = deriveTokenVaultAddress(mintPubkey, poolPubkey);
        const tokenBVault = deriveTokenVaultAddress(NATIVE_MINT, poolPubkey);

        const [tokenABalance, tokenBBalance] = await Promise.all([
          connection.getTokenAccountBalance(tokenAVault),
          connection.getTokenAccountBalance(tokenBVault),
        ]);

        const reserveToken = Number(tokenABalance.value.amount); // token units (6 decimals)
        const reserveSOL = Number(tokenBBalance.value.amount);   // lamports (9 decimals)

        if (reserveToken > 0) {
          // SOL per token = (reserveSOL / 1e9) / (reserveToken / 1e6)
          const pricePerToken = reserveSOL / (reserveToken * 1000);
          setMeteoraPrice(pricePerToken);
        }
      } catch (err) {
        console.error('Failed to fetch Meteora price:', err);
      }
    };

    fetchMeteoraPrice();

    // Refresh price every 30 seconds
    const interval = setInterval(fetchMeteoraPrice, 30000);
    return () => clearInterval(interval);
  }, [token?.graduated, token?.meteoraPool, token?.mint]);

  const marketStatsByWindow = useMemo(() => {
    const windows = [
      { key: '5m', ms: 5 * 60 * 1000 },
      { key: '1h', ms: 60 * 60 * 1000 },
      { key: '6h', ms: 6 * 60 * 60 * 1000 },
      { key: '24h', ms: 24 * 60 * 60 * 1000 },
    ] as const;
    const now = Date.now();

    return windows.reduce((acc, windowDef) => {
      const trades = activityTrades.filter((t: any) => now - new Date(t.timestamp).getTime() <= windowDef.ms);
      const buys = trades.filter((t: any) => t.isBuy);
      const sells = trades.filter((t: any) => !t.isBuy);

      const buyVolSol = buys.reduce((sum: number, t: any) => sum + (Number(t.solAmount) / 1e9 || 0), 0);
      const sellVolSol = sells.reduce((sum: number, t: any) => sum + (Number(t.solAmount) / 1e9 || 0), 0);
      const totalVolUsd = (buyVolSol + sellVolSol) * solPriceUsd;
      const buyVolUsd = buyVolSol * solPriceUsd;
      const sellVolUsd = sellVolSol * solPriceUsd;

      const getAddr = (t: any) => t.userAddress || t.user?.address || t.walletAddress || '';
      const allMakersSet = new Set(trades.map(getAddr).filter(Boolean));
      const buyMakersSet = new Set(buys.map(getAddr).filter(Boolean));
      const sellMakersSet = new Set(sells.map(getAddr).filter(Boolean));

      acc[windowDef.key] = {
        txns: trades.length,
        buys: buys.length,
        sells: sells.length,
        volume: totalVolUsd,
        volumeBuys: buyVolUsd,
        volumeSells: sellVolUsd,
        makers: allMakersSet.size,
        makersBuys: buyMakersSet.size,
        makersSells: sellMakersSet.size,
      };
      return acc;
    }, {} as Record<'5m' | '1h' | '6h' | '24h', {
      txns: number;
      buys: number;
      sells: number;
      volume: number;
      volumeBuys: number;
      volumeSells: number;
      makers: number;
      makersBuys: number;
      makersSells: number;
    }>);
  }, [activityTrades, solPriceUsd]);
  const selectedMarketStats = marketStatsByWindow[marketWindow] || {
    txns: 0, buys: 0, sells: 0, volume: 0, volumeBuys: 0, volumeSells: 0, makers: 0, makersBuys: 0, makersSells: 0,
  };
  const txnTotal = Math.max(selectedMarketStats.buys + selectedMarketStats.sells, 1);
  const volumeTotal = Math.max(selectedMarketStats.volumeBuys + selectedMarketStats.volumeSells, 1);
  const makersTotal = Math.max(selectedMarketStats.makersBuys + selectedMarketStats.makersSells, 1);

  // Optimistic update after bonding curve trade
  const handleTradeSuccess = (update: { isBuy: boolean; solAmount: number; tokenAmount: number }) => {
    setToken(prev => {
      if (!prev) return null;
      const solDelta = BigInt(update.solAmount);
      const tokenDelta = BigInt(update.tokenAmount);
      const prevVSol = BigInt(prev.virtualSolReserves);
      const prevVToken = BigInt(prev.virtualTokenReserves);
      const prevRSol = BigInt(prev.realSolReserves);
      
      const newVSol = update.isBuy ? prevVSol + solDelta : prevVSol - solDelta;
      const newVToken = update.isBuy ? prevVToken - tokenDelta : prevVToken + tokenDelta;
      const newRSol = update.isBuy ? prevRSol + solDelta : prevRSol - solDelta;
      
      return {
        ...prev,
        virtualSolReserves: newVSol.toString(),
        virtualTokenReserves: newVToken.toString(),
        realSolReserves: newRSol.toString(),
        _count: {
          trades: (prev._count?.trades ?? 0) + 1,
          holders: prev._count?.holders ?? 0,
        },
      };
    });
  };

  const copyAddress = () => {
    navigator.clipboard.writeText(mint);
    setCopied(true);
    toast.success('Address copied!');
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
       <AppLoader size={50}  />
      </div>
    );
  }

  if (error || !token) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-red-500">{error || 'Token not found'}</p>
      </div>
    );
  }

  // Calculate price - use Meteora price for graduated tokens, bonding curve for others
  const virtualSol = Number(token.virtualSolReserves) / 1e9;
  const virtualTokens = Number(token.virtualTokenReserves) / 1e6;
  const bondingCurvePrice = virtualSol / virtualTokens;
  
  // For graduated tokens, use Meteora vault price; fall back to latest trade price while loading
  const price = token.graduated
    ? (meteoraPrice ?? latestTradePrice ?? chartPrice ?? bondingCurvePrice)
    : (chartPrice ?? latestTradePrice ?? bondingCurvePrice);
  const priceLoading = (token.graduated && meteoraPrice === null && latestTradePrice === null && chartPrice === null) || (!token.graduated && priceInitializing && latestTradePrice === null && chartPrice === null);
  
  // Market cap calculation - price is in SOL, convert to USD (dynamic price)
  const TOTAL_SUPPLY = 1_000_000_000; // 1B total supply
  const marketCapUsd = price ? price * TOTAL_SUPPLY * solPriceUsd : null;

  // Calculate graduation progress (2 SOL threshold) - show 100% for graduated
  const realSol = Number(token.realSolReserves) / 1e9;
  const graduationThreshold = 2;
  const graduationProgress = token.graduated ? 100 : Math.max(0, Math.min((realSol / graduationThreshold) * 100, 100));

  // Use metadata image or fallback
  const tokenImage = metadata?.image || token.image || `https://api.dicebear.com/7.x/shapes/svg?seed=${mint}`;
  const tokenDescription = metadata?.description || token.description || 'No description available';
  const tokenName = token.name || 'Unknown Token';
  const tokenSymbol = token.symbol || 'UNK';
  // Prefer on-chain count (always fresh); fall back to DB count if on-chain hasn't loaded yet
const holders = onChainHolders.length > 0
  ? onChainHolders.filter((holder: any) => {
      const bal = Number(holder.balance || holder.amount || 0) / 1e6;

      const pct =
        token.virtualTokenReserves
          ? (bal / (Number(token.virtualTokenReserves) / 1e6)) * 100
          : 0;

      // ❌ remove zero balance
      if (bal <= 0) return false;

      // ❌ remove liquidity pool
      if (pct > 80) return false;

      return true;
    }).length
  : (token._count?.holders || 0);
  // volume24h in DB is stored in SOL — convert to USD, or use live activityTrades-based calc
  const volume24hUsd = !activityLoading && marketStatsByWindow['24h'].volume > 0
    ? marketStatsByWindow['24h'].volume
    : Number(token.volume24h || 0) * solPriceUsd;
  const socialFromAttributes = Array.isArray(metadata?.attributes)
    ? metadata.attributes.reduce(
        (acc: { twitter?: string; telegram?: string; website?: string }, item: any) => {
          const traitType = String(item?.trait_type || '').toLowerCase().trim();
          const value = String(item?.value || '').trim();
          if (!value) return acc;
          if (traitType === 'twitter' || traitType === 'x') acc.twitter = value;
          if (traitType === 'telegram' || traitType === 'tg') acc.telegram = value;
          if (traitType === 'website' || traitType === 'web') acc.website = value;
          return acc;
        },
        {}
      )
    : {};

  const socialLinks = {
    twitter:
      token.twitter ||
      metadata?.twitter ||
      metadata?.x ||
      socialFromAttributes.twitter ||
      metadata?.extensions?.twitter ||
      '',
    telegram:
      token.telegram ||
      metadata?.telegram ||
      socialFromAttributes.telegram ||
      metadata?.extensions?.telegram ||
      '',
    website:
      token.website ||
      metadata?.website ||
      metadata?.external_url ||
      socialFromAttributes.website ||
      metadata?.extensions?.website ||
      '',
  };

  const normalizeLink = (url?: string) => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `https://${url}`;
  };

  // Create token object for TradePanel
  // TradePanel needs a price for calculations - use Meteora price if available, otherwise bonding curve
  const tradeToken = {
    mint: token.mint,
    name: tokenName,
    symbol: tokenSymbol,
    price: price ?? bondingCurvePrice,
    virtualSolReserves: Number(token.virtualSolReserves),
    virtualTokenReserves: Number(token.virtualTokenReserves),
    graduated: token.graduated,
    meteoraPool: token.meteoraPool,
    createdAt: token.createdAt,
    creatorAddress: token.creatorAddress,
  };

  const totalTxns = token._count?.trades || 0;
  const buyTxns = Math.round(totalTxns * 0.57);
  const sellTxns = Math.max(totalTxns - buyTxns, 0);
  const buyVolume = volume24hUsd * 0.49;
  const sellVolume = Math.max(volume24hUsd - buyVolume, 0);
  const makers = holders;
  const buyMakers = Math.round(makers * 0.51);
  const sellMakers = Math.max(makers - buyMakers, 0);
  // On-chain holders: owner resolves to the wallet address, balance is raw (6 decimals)
const filteredHoldersList = onChainHolders.filter((holder: any) => {
  const addr = holder.address || holder.userAddress || holder.owner || '';

  const balRaw = Number(holder.balance || holder.amount || 0);
  const bal = balRaw / 1e6;

  const pct =
    holder.percentage ??
    (token.virtualTokenReserves
      ? (bal / (Number(token.virtualTokenReserves) / 1e6)) * 100
      : 0);

  // remove empty wallets
  if (bal <= 0) return false;

  // remove Meteora liquidity pool
  if (token.meteoraPool && addr === token.meteoraPool) return false;

  // remove LP / reserve wallets
  if (pct > 20) return false;

  return true;
});
  const formatTxnTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffMs / 60000);
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMins < 60) return `${diffMins}m ago`;
    return `${Math.floor(diffMins / 60)}h ago`;
  };
  const formatMoneyCompact = (value: number) => {
    if (value >= 1_000_000) return `$${Math.round(value / 1_000_000)}M`;
    if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
    return `$${value.toFixed(2)}`;
  };
  const formatTokenAmt = (amount: string | number) => {
    const val = Number(amount) / 1e6;
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(2)}K`;
    return val.toFixed(2);
  };

  return (
    <>
      <div className="lg:hidden">
      <MobileTokenDetail
        token={token}
        metadata={metadata}
        mint={mint}
        price={price}
        priceLoading={priceLoading}
        marketCapUsd={marketCapUsd}
        volume24hUsd={volume24hUsd}
        holders={holders}
        graduationProgress={graduationProgress}
        graduationThreshold={graduationThreshold}
        isGraduating={isGraduating}
        activityTrades={activityTrades}
        activityLoading={activityLoading}
        filteredHoldersList={filteredHoldersList}
        holdersLoading={holdersLoading}
        selectedMarketStats={selectedMarketStats}
        marketStatsByWindow={marketStatsByWindow}
        marketWindow={marketWindow}
        setMarketWindow={setMarketWindow}
        solPriceUsd={solPriceUsd}
        socialLinks={socialLinks}
        tokenImage={tokenImage}
        tokenDescription={tokenDescription}
        tokenName={tokenName}
        tokenSymbol={tokenSymbol}
        tradeToken={tradeToken}
        onTradeSuccess={handleTradeSuccess}
        onCopyAddress={copyAddress}
        copied={copied}
        formatTxnTime={formatTxnTime}
        formatMoneyCompact={formatMoneyCompact}
        formatTokenAmt={formatTokenAmt}
        normalizeLink={normalizeLink}
        onChartPriceUpdate={setChartPrice}
      />
    </div>
    <div className="hidden lg:block">
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-2xl  bg-[#08172A] p-4">
            <div className="flex flex-col gap-4 lg:flex-row">
              <div className="relative h-52 w-52 overflow-hidden rounded-2xl bg-surface-light flex-shrink-0">
                <Image src={tokenImage} alt={tokenName} fill className="object-cover" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h1 className="text-2xl leading-none font-bold">{tokenName}</h1>
                      {token.graduated && (
                        <span className="flex items-center space-x-1 rounded-full bg-primary-500/20 px-2 py-1 text-xs text-primary-400">
                          <Rocket className="w-3 h-3" />
                          <span>Graduated</span>
                        </span>
                      )}
                      {token.graduated && token.meteoraPool && (
                        <a
                          href={`https://meteora.ag/dlmm/${token.meteoraPool}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center space-x-1 rounded-full bg-blue-500/20 px-2 py-1 text-xs text-blue-400 hover:bg-blue-500/30 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Meteora</span>
                        </a>
                      )}
                    </div>
                    <p className="text-xl text-gray-400">{tokenSymbol.toLowerCase()}</p>
                    <div className="mt-2 text-sm leading-tight text-[#9fb0c2]">
                      <p>
                        Creator:{' '}
                        <Link href={`/profile/${token.creatorAddress}`} className="text-[#7bc6ff] hover:underline">
                          {shortenAddress(token.creatorAddress, 4)}
                        </Link>
                      </p>
                      <p>Created: {formatTimeAgo(new Date(token.createdAt).getTime())}</p>
                    </div>
                  </div>

                    <div className="space-y-2 lg:w-[390px]">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={copyAddress}
                        className="inline-flex items-center gap-2 rounded-full border border-[#2e4a68] bg-[#15263d] px-3 py-1 text-xs text-[#d4e4f5] hover:bg-[#223a55]"
                      >
                        <span>{shortenAddress(mint, 6)}</span>
                        {copied ? <Check className="w-4 h-4 text-primary-500" /> : <Copy className="w-4 h-4" />}
                      </button>
                      {socialLinks.telegram && (
                        <a href={normalizeLink(socialLinks.telegram)} target="_blank" rel="noopener noreferrer" >
                               <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g filter="url(#filter0_i_7_953)">
                <rect width="30" height="30" rx="15" fill="#182536"/>
                </g>
                <rect x="0.25" y="0.25" width="29.5" height="29.5" rx="14.75" stroke="white" stroke-opacity="0.6" stroke-width="0.5"/>
                <path d="M13.5129 16.8051L18.547 20.4965C19.0689 20.8322 19.5164 20.6459 19.6658 19.9746L21.7165 10.3547C21.904 9.53463 21.3809 9.16148 20.8215 9.42275L8.85265 14.048C8.06948 14.3462 8.06948 14.8312 8.70326 15.0175L11.7978 15.9869L18.8826 11.4754C19.2183 11.2879 19.5164 11.3635 19.2926 11.6247" fill="white"/>
                <defs>
                <filter id="filter0_i_7_953" x="0" y="0" width="30" height="32" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
                <feFlood flood-opacity="0" result="BackgroundImageFix"/>
                <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
                <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
                <feOffset dy="2"/>
                <feGaussianBlur stdDeviation="1"/>
                <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1"/>
                <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.25 0"/>
                <feBlend mode="normal" in2="shape" result="effect1_innerShadow_7_953"/>
                </filter>
                </defs>
                </svg>
                        </a>
                      )}
                      {socialLinks.twitter && (
                        <a href={normalizeLink(socialLinks.twitter)} target="_blank" rel="noopener noreferrer" >
                           <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <g filter="url(#filter0_i_7_956)">
                    <rect width="30" height="30" rx="15" fill="#182536"/>
                    </g>
                    <rect x="0.25" y="0.25" width="29.5" height="29.5" rx="14.75" stroke="white" stroke-opacity="0.6" stroke-width="0.5"/>
                    <path d="M9.09641 20.5811L13.7315 15.6267L9.06055 9.37558C9.17807 9.36496 9.25443 9.35168 9.33145 9.35168C10.3015 9.35168 11.2715 9.35699 12.2416 9.34571C12.3298 9.34083 12.4178 9.35984 12.4962 9.40073C12.5746 9.44163 12.6405 9.50289 12.6871 9.57809C13.6166 10.8299 14.5503 12.0785 15.4883 13.3241C15.5387 13.3905 15.5925 13.4569 15.6649 13.5492C15.9504 13.2498 16.2259 12.9649 16.4968 12.6754C17.4323 11.6762 18.3745 10.6836 19.2934 9.66905C19.3798 9.55221 19.496 9.46074 19.6298 9.4042C19.7637 9.34767 19.9103 9.32816 20.0543 9.3477C20.233 9.35765 20.4121 9.35765 20.5908 9.3477L16.1064 14.1587L20.94 20.6243C20.8072 20.6362 20.7408 20.6488 20.6671 20.6488C19.7449 20.6488 18.8213 20.6362 17.8998 20.6568C17.7704 20.6685 17.6404 20.6441 17.5241 20.5863C17.4078 20.5285 17.3099 20.4396 17.2411 20.3295C16.299 19.0401 15.3376 17.7646 14.3821 16.4845C14.3204 16.4015 14.2493 16.3239 14.167 16.2189C13.7255 16.689 13.2966 17.1432 12.8703 17.5993C11.9806 18.5508 11.0969 19.5082 10.1979 20.4503C10.0747 20.5566 9.92211 20.623 9.76036 20.6409C9.55395 20.6597 9.34639 20.6623 9.13957 20.6488L9.09641 20.5811ZM10.5398 10.094C10.6242 10.2181 10.668 10.2885 10.7178 10.3549C11.225 11.0321 11.7325 11.7089 12.2402 12.3853C14.0577 14.8118 15.8758 17.2379 17.6946 19.6635C17.761 19.7505 17.8533 19.8753 17.9376 19.8793C18.4442 19.8999 18.9521 19.8893 19.5059 19.8893C19.4122 19.7565 19.3551 19.6728 19.2941 19.5912L16.2339 15.5065C14.9343 13.7723 13.6336 12.0391 12.3318 10.3071C12.268 10.2072 12.1689 10.1349 12.0543 10.1046C11.571 10.0827 11.0869 10.094 10.5398 10.094Z" fill="white"/>
                    <defs>
                    <filter id="filter0_i_7_956" x="0" y="0" width="30" height="32" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
                    <feFlood flood-opacity="0" result="BackgroundImageFix"/>
                    <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
                    <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
                    <feOffset dy="2"/>
                    <feGaussianBlur stdDeviation="1"/>
                    <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1"/>
                    <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.25 0"/>
                    <feBlend mode="normal" in2="shape" result="effect1_innerShadow_7_956"/>
                    </filter>
                    </defs>
                    </svg>
                        </a>
                      )}
                      {socialLinks.website && (
                        <a href={normalizeLink(socialLinks.website)} target="_blank" rel="noopener noreferrer" >
                          <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g filter="url(#filter0_i_7_959)">
                <rect width="30" height="30" rx="15" fill="#182536"/>
                </g>
                <rect x="0.25" y="0.25" width="29.5" height="29.5" rx="14.75" stroke="white" stroke-opacity="0.6" stroke-width="0.5"/>
                <path d="M13.4408 22.9604C11.3431 22.5521 9.53436 21.3261 8.35201 19.648H11.3136C11.8198 21.1417 12.5633 22.3176 13.4408 22.9604ZM10.602 15.3516C10.6298 16.6239 10.805 17.8409 11.0958 18.9289H7.90189C7.30924 17.8594 6.9504 16.6424 6.8949 15.3516H10.602ZM14.6385 15.3516V18.9289H11.9208C11.6341 17.8594 11.4593 16.6424 11.4318 15.3516H14.6385ZM12.1416 19.648H14.6385V22.7022C13.6243 22.4872 12.727 21.3445 12.1416 19.648ZM7.90743 11.0551H11.094C10.8025 12.1246 10.6277 13.3417 10.6015 14.6509H6.89453C6.94911 13.3417 7.31016 12.1246 7.90743 11.0551ZM14.6385 11.0551V14.6509H11.4313C11.4571 13.3417 11.6315 12.1062 11.919 11.0551H14.6385ZM11.3114 10.336H8.35901C9.53584 8.65796 11.3298 7.45292 13.4104 7.03969C12.5448 7.68785 11.8119 8.84236 11.3114 10.336ZM14.6385 7.24321V10.336H12.1392C12.7246 8.62108 13.6243 7.45858 14.6385 7.24321ZM15.3576 19.648H17.8512C17.2706 21.3261 16.3718 22.4682 15.3576 22.6968V19.648ZM18.561 15.3516C18.5335 16.6424 18.3587 17.8594 18.0719 18.9289H15.3576V15.3516H18.561ZM18.0738 11.0551C18.3613 12.1062 18.5357 13.3417 18.5615 14.6509H15.3576V11.0551H18.0738ZM17.8536 10.336H15.3576V7.24856C16.3903 7.47758 17.2728 8.63952 17.8536 10.336ZM21.6419 10.336H18.6814C18.1804 8.84236 17.4463 7.68545 16.5796 7.03748C18.6648 7.44868 20.463 8.65796 21.6419 10.336ZM23.1064 14.6509H19.3913C19.3651 13.3417 19.1903 12.1246 18.8988 11.0551H22.0935C22.6907 12.1246 23.0518 13.3417 23.1064 14.6509ZM18.6792 19.648H21.6489C20.4643 21.3261 18.6513 22.5564 16.5488 22.9626C17.4277 22.3203 18.1724 21.1417 18.6792 19.648ZM23.106 15.3516C23.0505 16.6424 22.6916 17.8594 22.099 18.9289H18.8969C19.1877 17.8409 19.3629 16.6239 19.3908 15.3516H23.106Z" fill="white"/>
                <defs>
                <filter id="filter0_i_7_959" x="0" y="0" width="30" height="32" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
                <feFlood flood-opacity="0" result="BackgroundImageFix"/>
                <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
                <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
                <feOffset dy="2"/>
                <feGaussianBlur stdDeviation="1"/>
                <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1"/>
                <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.25 0"/>
                <feBlend mode="normal" in2="shape" result="effect1_innerShadow_7_959"/>
                </filter>
                </defs>
                </svg>
                        </a>
                      )}
                      <a
                        href={`https://solscan.io/token/${mint}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-[#2e4a68] bg-[#15263d] p-2 hover:bg-[#223a55]"
                      >
                        <Image src="/images/solscan-logo.png" alt="Solscan" width={14} height={14} />
                      </a>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-xl bg-[#1b2c43] p-2">
                        <p className="text-[11px] text-[#8fa4bb]">Marketcap</p>
                        <p className="mt-1 text-base font-bold">
                          {priceLoading ? <span className="inline-block h-4 w-16 animate-pulse rounded bg-[#2a3f5a]" /> : `$${formatNumber(marketCapUsd || 0)}`}
                        </p>
                      </div>
                      {/* <div className="rounded-xl bg-[#1b2c43] p-2">
                        <p className="text-[11px] text-[#8fa4bb]">Price</p>
                        <p className="mt-1 text-base font-bold">
                          {priceLoading ? (
                            <span className="text-gray-400">Loading...</span>
                          ) : price ? (
                            (() => {
                              const usdPrice = price * solPriceUsd;
                              if (usdPrice < 0.000001)  return '$' + usdPrice.toFixed(9);
                              if (usdPrice < 0.00001)   return '$' + usdPrice.toFixed(8);
                              if (usdPrice < 0.0001)    return '$' + usdPrice.toFixed(7);
                              if (usdPrice < 0.01)      return '$' + usdPrice.toFixed(5);
                              return '$' + usdPrice.toFixed(4);
                            })()
                          ) : '$0'}
                        </p>
                      </div> */}
                      <div className="rounded-xl bg-[#1b2c43] p-2">
                        <p className="text-[11px] text-[#8fa4bb]">Volume</p>
                        <p className="mt-1 text-base font-bold">${formatNumber(volume24hUsd)}</p>
                      </div>
                      <div className="rounded-xl bg-[#1b2c43] p-2">
                        <p className="text-[11px] text-[#8fa4bb]">Holders</p>
                        <p className="mt-1 flex items-center text-base font-bold">
                          {/* <Users className="mr-1 h-4 w-4 text-[#8fa4bb]" /> */}
                          {holders}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-3 rounded-xl bg-[#15263d] p-3 text-[13px] leading-relaxed text-gray-300 whitespace-pre-wrap">
                  {tokenDescription}
                </div>
              </div>
            </div>
          </div>

          <PriceChart mint={mint} onPriceUpdate={setChartPrice} />

          <div className="rounded-2xl bg-[#08172A] p-3">
            <div className="mb-3 flex items-center gap-4 overflow-x-auto whitespace-nowrap pb-1">
              {[
                { id: 'transactions', label: 'Transaction' },
                { id: 'holders', label: 'Holders' },
                { id: 'threads', label: 'Comments' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActivityTab(tab.id as 'transactions' | 'holders' | 'threads')}
                  className={`inline-flex min-w-[10px] items-center justify-center gap-2 rounded-[20px] px-4 py-2 text-base font-semibold transition-colors ${
                    activityTab === tab.id ? 'bg-white text-[#050E1A]' : 'bg-[#1a2f46] text-[rgba(255,255,255,0.6)]'
                  }`}
                >
                  {tab.id === 'transactions' && (
                    <svg width="14" height="12" viewBox="0 0 16 14" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-current">
                      <path d="M0.5 3H13.5C13.7763 3 14 2.77625 14 2.5V0.5C14 0.223751 13.7763 0 13.5 0H0.5C0.223749 0 0 0.223751 0 0.5V2.5C0 2.77625 0.223749 3 0.5 3ZM15.5 5.5H2.5C2.22375 5.5 2 5.72375 2 6V8C2 8.27625 2.22375 8.5 2.5 8.5H15.5C15.7763 8.5 16 8.27625 16 8V6C16 5.72375 15.7763 5.5 15.5 5.5ZM13.5 11H0.5C0.223749 11 0 11.2237 0 11.5V13.5C0 13.7762 0.223749 14 0.5 14H13.5C13.7763 14 14 13.7762 14 13.5V11.5C14 11.2237 13.7763 11 13.5 11Z" fill="currentColor" />
                    </svg>
                  )}
                  {tab.id === 'holders' && (
                     <svg width="13" height="14" viewBox="0 0 15 17" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-current">
                      <path d="M6.55515 3.92272L4.52986 0.547436C4.44659 0.408587 4.32877 0.293672 4.18789 0.213887C4.04701 0.134101 3.88786 0.0921651 3.72595 0.0921631H0.469608C0.0902134 0.0921631 -0.131857 0.519019 0.0855258 0.829859L3.34539 5.48689C4.21609 4.67331 5.32351 4.11491 6.55515 3.92272ZM14.5304 0.0921631H11.274C10.9447 0.0921631 10.6394 0.265015 10.4701 0.547436L8.4448 3.92272C9.67644 4.11491 10.7839 4.67331 11.6546 5.4866L14.9144 0.829859C15.1319 0.519019 14.9097 0.0921631 14.5304 0.0921631ZM7.49997 4.77966C4.65232 4.77966 2.34372 7.08826 2.34372 9.93591C2.34372 12.7836 4.65232 15.0921 7.49997 15.0921C10.3476 15.0921 12.6562 12.7836 12.6562 9.93591C12.6562 7.08826 10.3476 4.77966 7.49997 4.77966ZM10.2105 9.38689L9.0993 10.4697L9.36209 11.9996C9.40896 12.2738 9.1201 12.4833 8.8743 12.3538L7.49997 11.6316L6.12595 12.3538C5.87986 12.4841 5.59129 12.2735 5.63816 11.9996L5.90095 10.4697L4.78972 9.38689C4.58992 9.19236 4.70037 8.85281 4.97576 8.81296L6.5118 8.58914L7.19822 7.19695C7.26004 7.07156 7.37957 7.00974 7.49939 7.00974C7.6198 7.00974 7.74021 7.07244 7.80202 7.19695L8.48845 8.58914L10.0245 8.81296C10.2999 8.85281 10.4103 9.19236 10.2105 9.38689Z" fill="currentColor" />
                    </svg>
                   
                  )}
                  {tab.id === 'threads' && (
                    <svg width="14" height="13" viewBox="0 0 16 15" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-current">
                      <path d="M14.952 1.36023H1.04803C0.469205 1.36023 0 1.80011 0 2.34276V10.596C0 11.1387 0.46924 11.5786 1.04803 11.5786H5.66288L7.19797 13.2896C7.3971 13.5115 7.69066 13.6397 8.00004 13.6397C8.30941 13.6397 8.60293 13.5116 8.8021 13.2896L10.3372 11.5786H14.952C15.5308 11.5786 16 11.1387 16 10.596V2.34276C16 1.80011 15.5308 1.36023 14.952 1.36023ZM11.3158 9.22049H2.89446C2.60507 9.22049 2.37045 9.00054 2.37045 8.72923C2.37045 8.45791 2.60507 8.23796 2.89446 8.23796H11.3158C11.6052 8.23796 11.8399 8.45791 11.8399 8.72923C11.8399 9.00054 11.6052 9.22049 11.3158 9.22049ZM2.37045 6.50939C2.37045 6.23808 2.60507 6.01812 2.89446 6.01812H9.36094C9.65034 6.01812 9.88496 6.23808 9.88496 6.50939C9.88496 6.7807 9.65034 7.00066 9.36094 7.00066H2.89446C2.60507 7.00066 2.37045 6.7807 2.37045 6.50939ZM13.1055 4.78075H2.89446C2.60507 4.78075 2.37045 4.5608 2.37045 4.28949C2.37045 4.01818 2.60507 3.79822 2.89446 3.79822H13.1055C13.3949 3.79822 13.6295 4.01818 13.6295 4.28949C13.6296 4.5608 13.3949 4.78075 13.1055 4.78075Z" fill="currentColor" />
                    </svg>
                  )}
                  {tab.label}
                </button>
              ))}
            </div>

            {activityTab === 'transactions' && (
              <div className="overflow-hidden rounded-xl bg-[#0d2138]">
                <div className="overflow-x-auto">
                  <div className="min-w-[640px]">
                    <div className="grid grid-cols-[1.1fr_.8fr_1fr_1.2fr_.9fr_.9fr] border-b border-[#1e3a57] px-4 py-2 text-xs text-[#8fa4bb]">
                      <span>Trader</span>
                      <span>Action</span>
                      <span>Amount(SOL)</span>
                      <span>Amount({tokenSymbol.toLowerCase()})</span>
                      <span>Time</span>
                      <span>Txn</span>
                    </div>
                <div className="max-h-[280px] overflow-y-auto">
                  {activityLoading ? (
                    <div className="px-4 py-6 text-sm text-[#8fa4bb]">Loading transactions...</div>
                  ) : activityTrades.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-[#8fa4bb]">No transactions yet</div>
                  ) : (
                    activityTrades.map((trade: any) => (
                      <div key={trade.signature} className="grid grid-cols-[1.1fr_.8fr_1fr_1.2fr_.9fr_.9fr] px-4 py-2 text-sm">
                      {(() => {
                      const traderAddress =
                    trade.walletAddress || trade.userAddress || trade.user?.address;

                  const isDev =
                    traderAddress &&
                    traderAddress.toLowerCase() === token.creatorAddress.toLowerCase();

                      return (
                 <Link
                    href={`/profile/${traderAddress}`}
                    className="flex items-center gap-[6px]"
                    title={traderAddress}
                  >
                    <Image src="/images/duck.png" alt="tg" width={18} height={18} />

                    <span className="text-[#528EFC] hover:underline">
                      {shortenAddress(traderAddress || '', 4)}
                    </span>
{isDev && (
  <span className="relative group flex items-center">

    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path
        d="M15.3634 4.57481C15.2103 2.73685 13.4117 1.39339 11.6087 1.79599C11.2893 1.86601 10.983 1.99729 10.6723 2.10232C10.1865 0.898888 9.31567 0.124318 7.99847 0.0149158C6.39244 -0.120743 5.31592 0.675707 4.69013 2.12857C3.89368 1.74348 3.23289 1.63845 2.53272 1.78724C1.07548 2.10232 0.0733492 3.28386 0.00333159 4.78049C-0.0623099 6.15896 0.847919 7.43678 2.21326 7.88752C2.27015 7.90502 2.33579 7.97942 2.34892 8.03631C2.51959 8.8984 2.67713 9.76487 2.84342 10.627C2.92219 11.0427 3.00096 11.4584 3.07973 11.8741C3.91556 11.8741 4.7339 11.8741 5.5566 11.8741C5.5566 11.8435 5.5566 11.8216 5.5566 11.8041C5.45595 10.6926 5.3553 9.58107 5.25027 8.47392C5.22839 8.23761 5.34217 8.06694 5.54785 8.04068C5.76665 8.01443 5.92857 8.15008 5.95045 8.39515C6.02047 9.15221 6.08611 9.90928 6.15175 10.6663C6.18676 11.0689 6.22615 11.4715 6.26115 11.8785C7.21952 11.8785 8.16476 11.8785 9.11875 11.8785C9.18876 11.0996 9.25878 10.3338 9.3288 9.56794C9.36381 9.17409 9.39444 8.78462 9.43383 8.39077C9.45571 8.15884 9.61325 8.02318 9.8233 8.04068C10.0158 8.05819 10.1515 8.22448 10.134 8.43016C10.1034 8.8065 10.064 9.18284 10.0334 9.55919C9.96333 10.325 9.89332 11.0952 9.8233 11.8741C10.6591 11.8741 11.4818 11.8741 12.3045 11.8741C12.5452 10.5963 12.7859 9.33163 13.0222 8.06256C13.0397 7.96191 13.0791 7.91815 13.1754 7.88314C14.6239 7.40177 15.4903 6.09332 15.3634 4.57481Z"
        fill={trade.isBuy ? "#45EF56" : "#EF4444"}
      />
      <path
        d="M12.2313 12.5874C9.19863 12.5874 6.18787 12.5874 3.15524 12.5874C3.15086 12.653 3.14648 12.7012 3.14648 12.7493C3.14648 13.4757 3.14648 14.2022 3.14648 14.9286C3.14648 15.2612 3.26902 15.3837 3.6016 15.3837C6.33228 15.3837 9.05859 15.3837 11.7893 15.3837C12.1175 15.3837 12.24 15.2568 12.24 14.9242C12.24 14.2022 12.24 13.4801 12.24 12.7581C12.24 12.7056 12.2356 12.6443 12.2313 12.5874Z"
        fill={trade.isBuy ? "#45EF56" : "#EF4444"}
      />
    </svg>

    {/* Tooltip */}
    <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap
      bg-[#0e2035] text-white text-[10px] px-2 py-1 rounded
      opacity-0 group-hover:opacity-100 transition pointer-events-none
      border border-white/10 shadow-md">
      Developer
    </span>

  </span>
)}
                  </Link>
                      );
                    })()}
                        <span className={trade.isBuy ? 'text-[#45ef56]' : 'text-[#ef4444]'}>{trade.isBuy ? 'Buy' : 'Sell'}</span>
                        <span className="text-[#cdd9e5]">{(Number(trade.solAmount) / 1e9).toFixed(4)}</span>
                        <span className={trade.isBuy ? 'text-[#45ef56]' : 'text-[#ef4444]'}>{formatTokenAmt(trade.tokenAmount)}</span>
                        <span className="text-[#9ab0c7]">{formatTxnTime(trade.timestamp)}</span>
                        <a
                          href={`https://solscan.io/tx/${trade.signature}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#9ab0c7] hover:text-white"
                        >
                          {shortenAddress(trade.signature, 3)}
                        </a>
                      </div>
                    ))
                  )}
                </div>
                  </div>
                </div>
              </div>
            )}

     {activityTab === 'holders' && (
  <div className="overflow-hidden rounded-xl bg-[#0d2138]">
    <div className="overflow-x-auto">
      <div className="min-w-[520px]">
        
        {/* HEADER */}
        <div className="grid grid-cols-4 border-b border-[#1e3a57] px-4 py-2 text-xs text-[#8fa4bb]">
          <span>Holder</span>
          <span>Balance</span>
          <span>Share</span>
          <span>Profile</span>
        </div>

        {/* BODY */}
        <div className="max-h-[280px] overflow-y-auto">
          
          {holdersLoading ? (
            <div className="px-4 py-6 text-sm text-[#8fa4bb]">
              Loading holders...
            </div>
          ) : filteredHoldersList.length === 0 ? (
            <div className="px-4 py-6 text-sm text-[#8fa4bb]">
              No holders yet
            </div>
          ) : (
            filteredHoldersList.map((holder: any, idx: number) => {
              
              const addr =
                holder.address || holder.userAddress || holder.owner || '';

              const bal =
                Number(holder.balance || holder.amount || 0) / 1e6;

              const pct =
                holder.percentage ??
                (token.virtualTokenReserves
                  ? (bal / (Number(token.virtualTokenReserves) / 1e6)) * 100
                  : 0);

              return (
                <div
                  key={`${addr}-${idx}`}
                  className="grid grid-cols-4 px-4 py-2 text-sm"
                >
                  {/* HOLDER */}
                  <span className="text-[#8fc7ff]">
                    {shortenAddress(addr, 4)}
                  </span>

                  {/* BALANCE */}
                  <span className="text-[#cdd9e5]">
                    {formatNumber(bal)}
                  </span>

                  {/* SHARE */}
                  <span className="text-[#cdd9e5]">
                    {pct.toFixed(2)}%
                  </span>

                  {/* PROFILE */}
                  <Link
                    href={`/profile/${addr}`}
                    className="text-[#9ab0c7] hover:text-white"
                  >
                    Open
                  </Link>
                </div>
              );
            })
          )}
        </div>

      </div>
    </div>
  </div>
)}

            {activityTab === 'threads' && (
              <div className="rounded-xl bg-[#0d2138] p-2">
                <CommentSection mint={mint} />
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 lg:col-span-1">
          <TradePanel token={tradeToken} onTradeSuccess={handleTradeSuccess} />

          <div className="rounded-2xl border border-[#f59e0b] bg-[#08172A] p-4 shadow-[0_0_18px_rgba(245,158,11,0.25)]">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">Bonding curve progress</span>
              <span className="text-xs text-gray-300">{(graduationProgress || 0).toFixed(0)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#19314d]">
              <div
                   className="relative h-full rounded-full bg-gradient-to-r from-[#3b82f6] to-[#f59e0b] overflow-hidden"
                style={{ width: `${graduationProgress}%` }}
              >
                 <span className="particle p1" />
                <span className="particle p2" />
                <span className="particle p3" />
              </div>
            </div>
            <p className="mt-2 text-xs text-[#8fa4bb]">
              {isGraduating ? 'Creating Meteora DLMM pool...' : token.graduated ? 'Coin has graduated' : `When ${graduationThreshold} SOL is raised, liquidity moves to Meteora`}
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-[#1f3a59] bg-[#08172A]">
            <div className="grid grid-cols-4 bg-[#1a2f46] text-xs">
              {(['5m', '1h', '6h', '24h'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setMarketWindow(t)}
                  className={`py-2.5 font-semibold transition-colors border-r border-[#15263d] last:border-r-0 ${
                    marketWindow === t ? 'bg-white text-[#08172A]' : 'text-[#97acc2] hover:bg-[#223750]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="text-xs">
              <div className="grid grid-cols-3 gap-2 px-5 py-4">
                <div>
                  <p className="text-[#8fa4bb]">Txns</p>
                  <p className="mt-1 text-2xl text-white">{selectedMarketStats.txns.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[#8fa4bb]">Buys</p>
                  <p className="mt-1 text-2xl text-white">{selectedMarketStats.buys.toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-[#8fa4bb]">Sells</p>
                  <p className="mt-1 text-2xl text-white">{selectedMarketStats.sells.toLocaleString()}</p>
                </div>
                <div className="col-span-3 ml-[25%] w-[75%] flex h-0.5 overflow-hidden rounded-full bg-[#1a2f46]">
                  <div style={{ width: `${(selectedMarketStats.buys / txnTotal) * 100}%` }} className="bg-[#45ef56]" />
                  <div style={{ width: `${(selectedMarketStats.sells / txnTotal) * 100}%` }} className="bg-[#ff4d6d]" />
                </div>
              </div>

              <div className="border-t border-[#1f3a59] grid grid-cols-3 gap-2 px-5 py-4">
                <div>
                  <p className="text-[#8fa4bb]">Volume</p>
                  <p className="mt-1 text-2xl text-white">{formatMoneyCompact(selectedMarketStats.volume)}</p>
                </div>
                <div>
                  <p className="text-[#8fa4bb]">Buys</p>
                  <p className="mt-1 text-2xl text-white">{formatMoneyCompact(selectedMarketStats.volumeBuys)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[#8fa4bb]">Sells</p>
                  <p className="mt-1 text-2xl text-white">{formatMoneyCompact(selectedMarketStats.volumeSells)}</p>
                </div>
                <div className="col-span-3 ml-[25%] w-[75%] flex h-0.5 overflow-hidden rounded-full bg-[#1a2f46]">
                  <div style={{ width: `${(selectedMarketStats.volumeBuys / volumeTotal) * 100}%` }} className="bg-[#45ef56]" />
                  <div style={{ width: `${(selectedMarketStats.volumeSells / volumeTotal) * 100}%` }} className="bg-[#ff4d6d]" />
                </div>
              </div>

              <div className="border-t border-[#1f3a59] grid grid-cols-3 gap-2 px-5 py-4">
                <div>
                  <p className="text-[#8fa4bb]">Makers</p>
                  <p className="mt-1 text-2xl text-white">{selectedMarketStats.makers.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[#8fa4bb]">Buys</p>
                  <p className="mt-1 text-2xl text-white">{selectedMarketStats.makersBuys.toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-[#8fa4bb]">Sells</p>
                  <p className="mt-1 text-2xl text-white">{selectedMarketStats.makersSells.toLocaleString()}</p>
                </div>
                <div className="col-span-3 ml-[25%] w-[75%] flex h-0.5 overflow-hidden rounded-full bg-[#1a2f46]">
                  <div style={{ width: `${(selectedMarketStats.makersBuys / makersTotal) * 100}%` }} className="bg-[#45ef56]" />
                  <div style={{ width: `${(selectedMarketStats.makersSells / makersTotal) * 100}%` }} className="bg-[#ff4d6d]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
    </>
  );
};
