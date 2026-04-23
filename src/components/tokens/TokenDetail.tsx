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
console.log("data",data);

        // Fetch metadata from URI if available
        if (data.uri) {
          try {
            const metaRes = await fetch(data.uri);
            const metaData = await metaRes.json();
            console.log("metaDassta",metaData);
            
            if (!cancelled) setMetadata(metaData);
          } catch (e) {
            console.log('Could not fetch metadata from URI');
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
      if (data.isMeteoraSwap && data.price) {
        setMeteoraPrice(data.price / 1000);
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
        console.log('Token ready to graduate!', data);
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
        console.log('Token graduated!', data);
        setIsGraduating(false);
        setToken(prev => prev ? { 
          ...prev, 
          graduated: true,
          meteoraPool: data.meteoraPool || prev.meteoraPool,
        } : null);
        toast.success(
          `🚀 Token graduated to Meteora!\n${data.meteoraPool ? `Pool: ${data.meteoraPool.slice(0, 8)}...` : ''}`,
          { id: 'graduation', duration: 5000 }
        );
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
    const interval = setInterval(() => fetchActivityTrades(false), 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mint]);

  // Fetch Meteora price for graduated tokens
  useEffect(() => {
    if (!token?.graduated || !token?.meteoraPool) {
      setMeteoraPrice(null);
      return;
    }

    const fetchMeteoraPrice = async () => {
      try {
        // Dynamically import to avoid SSR issues
        const { default: DLMM } = await import('@meteora-ag/dlmm');
        const { Connection, PublicKey } = await import('@solana/web3.js');
        
        const connection = new Connection(
          process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com'
        );
        
        const dlmm = await DLMM.create(
          connection, 
          new PublicKey(token.meteoraPool!),
          { cluster: 'devnet' }
        );
        
        const activeBin = await dlmm.getActiveBin();
        // Price from Meteora needs decimal adjustment
        // Token has 6 decimals, SOL has 9 decimals
        // activeBin.price is scaled by 10^(tokenDecimals - solDecimals) = 10^-3 = 0.001
        // So we divide by 1000 to get the actual SOL per token price
        const pricePerToken = parseFloat(activeBin.price) / 1000;
        setMeteoraPrice(pricePerToken);
        
        console.log('Meteora price fetched:', pricePerToken);
      } catch (err) {
        console.error('Failed to fetch Meteora price:', err);
      }
    };

    fetchMeteoraPrice();
    
    // Refresh price every 30 seconds
    const interval = setInterval(fetchMeteoraPrice, 30000);
    return () => clearInterval(interval);
  }, [token?.graduated, token?.meteoraPool]);

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
  
  // For graduated tokens, ONLY use Meteora price (bonding curve data is stale after graduation)
  // For non-graduated tokens, use bonding curve price
  const price = token.graduated ? meteoraPrice : bondingCurvePrice;
  const priceLoading = token.graduated && meteoraPrice === null;
  
  // Market cap calculation - price is in SOL, convert to USD (dynamic price)
  const TOTAL_SUPPLY = 1_000_000_000; // 1B total supply
  const marketCapUsd = price ? price * TOTAL_SUPPLY * solPriceUsd : null;

  // Calculate graduation progress (60 SOL threshold) - show 100% for graduated
  const realSol = Number(token.realSolReserves) / 1e9;
  const graduationThreshold = 60;
  const graduationProgress = token.graduated ? 100 : Math.min((realSol / graduationThreshold) * 100, 100);

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
  const holdersList = onChainHolders;
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
                          href={`https://devnet.meteora.ag/dlmm/${token.meteoraPool}`}
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
                        <a href={normalizeLink(socialLinks.telegram)} target="_blank" rel="noopener noreferrer" className="rounded-full border border-[#2e4a68] bg-[#15263d] p-2 hover:bg-[#223a55]">
                          <Image src="/images/tg.png" alt="Telegram" width={14} height={14} />
                        </a>
                      )}
                      {socialLinks.twitter && (
                        <a href={normalizeLink(socialLinks.twitter)} target="_blank" rel="noopener noreferrer" className="rounded-full border border-[#2e4a68] bg-[#15263d] p-2 hover:bg-[#223a55]">
                          <Image src="/images/x.png" alt="X" width={14} height={14} />
                        </a>
                      )}
                      {socialLinks.website && (
                        <a href={normalizeLink(socialLinks.website)} target="_blank" rel="noopener noreferrer" className="rounded-full border border-[#2e4a68] bg-[#15263d] p-2 hover:bg-[#223a55]">
                          <Image src="/images/web.png" alt="Website" width={14} height={14} />
                        </a>
                      )}
                      <a
                        href={`https://solscan.io/token/${mint}?cluster=devnet`}
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
                          {priceLoading ? <span className="text-gray-400">Loading...</span> : `$${formatNumber(marketCapUsd || 0)}`}
                        </p>
                      </div>
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

          <PriceChart mint={mint} />

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

                      return (
                        <Link
                          href={`/profile/${traderAddress}`}
                          className="flex items-center gap-[5px]"
                          title={traderAddress}
                        >
                          <Image src="/images/duck.png" alt="tg" width={18} height={18}/>
                          <span className="text-[#528EFC] hover:underline">
                            {shortenAddress(traderAddress || '', 4)}
                          </span>
                        </Link>
                      );
                    })()}
                        <span className={trade.isBuy ? 'text-[#45ef56]' : 'text-[#ef4444]'}>{trade.isBuy ? 'Buy' : 'Sell'}</span>
                        <span className="text-[#cdd9e5]">{(Number(trade.solAmount) / 1e9).toFixed(4)}</span>
                        <span className={trade.isBuy ? 'text-[#45ef56]' : 'text-[#ef4444]'}>{formatTokenAmt(trade.tokenAmount)}</span>
                        <span className="text-[#9ab0c7]">{formatTxnTime(trade.timestamp)}</span>
                        <a
                          href={`https://solscan.io/tx/${trade.signature}?cluster=devnet`}
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
                    <div className="grid grid-cols-4 border-b border-[#1e3a57] px-4 py-2 text-xs text-[#8fa4bb]">
                      <span>Holder</span>
                      <span>Balance</span>
                      <span>Share</span>
                      <span>Profile</span>
                    </div>
                <div className="max-h-[280px] overflow-y-auto">
                  {holdersLoading ? (
                    <div className="px-4 py-6 text-sm text-[#8fa4bb]">Loading holders...</div>
                  ) : holdersList.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-[#8fa4bb]">No holders yet</div>
                  ) : (
                   (() => {
                  const filtered = holdersList.filter((holder: any) => {
                    const addr =
                      holder.address || holder.userAddress || holder.owner || '';

                    const balRaw = Number(holder.balance || holder.amount || 0);
                    const bal = balRaw / 1e6;

                    const pct =
                      holder.percentage ??
                      (token.virtualTokenReserves
                        ? (bal / (Number(token.virtualTokenReserves) / 1e6)) * 100
                        : 0);

                    if (bal <= 0) return false;

                    if (pct > 80) return false;

                    return true;
                  });

                  if (filtered.length === 0) {
                    return (
                      <div className="px-4 py-6 text-sm text-[#8fa4bb]">
                        No active holders
                      </div>
                    );
                  }

                  return filtered.map((holder: any, idx: number) => {
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
                        <span className="text-[#8fc7ff]">
                          {shortenAddress(addr, 4)}
                        </span>

                        <span className="text-[#cdd9e5]">
                          {formatNumber(bal)}
                        </span>

                        <span className="text-[#cdd9e5]">
                          {Number(pct).toFixed(2)}%
                        </span>

                        <Link
                          href={`/profile/${addr}`}
                          className="text-[#9ab0c7] hover:text-white"
                        >
                          Open
                        </Link>
                      </div>
                    );
                  });
                })()
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
              <span className="text-xs text-gray-300">{graduationProgress.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#19314d]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#3b82f6] to-[#f59e0b]"
                style={{ width: `${graduationProgress}%` }}
              />
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
  );
};
