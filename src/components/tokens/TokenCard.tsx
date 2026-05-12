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

  const { holders: onChainHolders } = useOnChainHolders(token.mint);
  const { socket } = useSocket();
  const { price: solPriceUsd } = useSolPrice();

  const [isNew, setIsNew] = useState(false);
  const [meteoraPrice, setMeteoraPrice] = useState<number | null>(null);
  const [metadata, setMetadata] = useState<any>(null);
  const [latestTradePrice, setLatestTradePrice] = useState<number | null>(null);
  const [priceInitializing, setPriceInitializing] = useState(true);

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

  // Fetch latest trade price from trades so Price + MC match the detail page
  useEffect(() => {
    let cancelled = false;
    const fetchLatestPrice = async () => {
      try {
        const res = await fetch(`${API_URL}/api/trades/token/${token.mint}?limit=1`);
        if (!res.ok) return;
        const data = await res.json();
        const trades: any[] = Array.isArray(data.trades) ? data.trades : [];
        if (trades.length > 0 && trades[0].price && !cancelled) {
          setLatestTradePrice(trades[0].price);
        }
      } catch {}
       finally {
        if (!cancelled) setPriceInitializing(false);
      }
    };
    fetchLatestPrice();
    return () => { cancelled = true; };
  }, [token.mint]);

  // 🔥 FETCH TRADES from DB on mount only — WS handles real-time updates.
  // Poll every 60s as fallback in case WS drops (not 15s — reduces DB connection pressure)
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
    const interval = setInterval(() => fetchTrades(false), 60000);
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
    if (data.price) setLatestTradePrice(data.price);
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
        const reserveToken = Number(tokenABalance.value.amount);
        const reserveSOL = Number(tokenBBalance.value.amount);
        if (reserveToken > 0) {
          setMeteoraPrice(reserveSOL / (reserveToken * 1000));
        }
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
        const R2_BASE = 'https://pub-ba4662261f8d44beb9881f35fde247ee.r2.dev';
        const uri = token.uri!.startsWith(R2_BASE)
          ? token.uri!.replace(R2_BASE, '/api/r2')
          : token.uri!;
        const res = await fetch(uri);
        setMetadata(await res.json());
      } catch {}
    };
    fetchMeta();
  }, [token.uri]);

  // Keep latestTradePrice in sync with activityTrades once they load
  useEffect(() => {
    if (activityTrades.length > 0 && activityTrades[0].price) {
      setLatestTradePrice(activityTrades[0].price);
    }
  }, [activityTrades]);

  // Live 24h price change from activityTrades (first trade 24h ago vs latest)
  const livepriceChange24h = useMemo(() => {
    const windowMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const trades24h = activityTrades
      .filter((t: any) => now - new Date(t.timestamp).getTime() <= windowMs && t.price && Number(t.price) > 0)
      .slice() // copy
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    if (trades24h.length < 2) return token.priceChange24h || 0;
    const oldest = Number(trades24h[0].price);
    const newest = Number(trades24h[trades24h.length - 1].price);
    return oldest > 0 ? ((newest - oldest) / oldest) * 100 : 0;
  }, [activityTrades, token.priceChange24h]);

  const priceChange = livepriceChange24h;
  const isPositive = priceChange >= 0;

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

  // 🔥 MARKET CAP — Meteora for graduated, latest trade price otherwise (matches detail page)
  const liquidityMarketCap = useMemo(() => {
    const TOTAL_SUPPLY = 1_000_000_000;
    if (token.graduated && meteoraPrice !== null) {
      return meteoraPrice * TOTAL_SUPPLY * solPriceUsd;
    }
    // Prefer latest trade price (same source as detail page)
    if (latestTradePrice) {
      return latestTradePrice * TOTAL_SUPPLY * solPriceUsd;
    }
    // Fallback to live reserves
    const virtualSol = Number(liveReserves.virtualSolReserves || 0) / 1e9;
    const virtualTokens = Number(liveReserves.virtualTokenReserves || 0) / 1e6;
    if (virtualTokens > 0 && virtualSol > 0) {
      return (virtualSol / virtualTokens) * TOTAL_SUPPLY * solPriceUsd;
    }
    return 0;
  }, [latestTradePrice, liveReserves.virtualSolReserves, liveReserves.virtualTokenReserves, token.graduated, meteoraPrice, solPriceUsd]);

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
          {activityLoading ? (
            <div className="absolute top-3 right-3 w-16 h-6 rounded-full bg-[#09182b] animate-pulse" />
          ) : (
            <div
              className={`absolute top-3 right-3 flex items-center gap-1 px-2 py-1 text-xs rounded-full ${
                isPositive ? 'bg-[#09182b] text-[#84FF00]' : 'bg-red-500 text-white'
              }`}
            >
              {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              <span>{Math.abs(priceChange).toFixed(2)}%</span>
            </div>
          )}
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
                {priceInitializing && latestTradePrice === null
                  ? <span className="inline-block h-4 w-20 animate-pulse rounded bg-[#2a3f5a]" />
                  : formatPrice(latestTradePrice ?? token.price ?? 0, solPriceUsd)
                }
              </p>
            </div>
            <div className="flex items-center gap-1">
              {socialLinks.telegram && (
                <a href={normalizeLink(socialLinks.telegram)} target="_blank">
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
                <a href={normalizeLink(socialLinks.twitter)} target="_blank">
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
                <a href={normalizeLink(socialLinks.website)} target="_blank">
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
            </div>
          </div>

          {/* STATS */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            <div className="bg-[#182536] rounded-xl p-2">
              <p className="text-[13px] text-gray-400">MarketCap</p>
              <p className="text-white text-sm font-medium">
                {(token.graduated && meteoraPrice === null) || (!token.graduated && priceInitializing && latestTradePrice === null)
                  ? <span className="inline-block h-4 w-14 animate-pulse rounded bg-[#2a3f5a]" />
                  : `$${formatNumber(liquidityMarketCap)}`
                }
              </p>
            </div>

            <div className="bg-[#182536] rounded-xl p-2">
              <p className="text-[13px] text-gray-400">Volume</p>
              <p className="text-white text-sm font-medium">
                {activityLoading
                  ? <span className="inline-block h-4 w-14 animate-pulse rounded bg-[#2a3f5a]" />
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