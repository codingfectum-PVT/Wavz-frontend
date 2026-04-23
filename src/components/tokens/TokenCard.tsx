'use client';

import { FC, useMemo, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { TrendingUp, TrendingDown, Users } from 'lucide-react';
import { formatNumber, formatPrice, formatTimeAgo } from '@/lib/utils';
import { useSolPrice } from '@/hooks/useSolPrice';
import type { Token } from '@/hooks/useApi';

export const TokenCard: FC<{ token: Token }> = ({ token }) => {
  const priceChange = token.priceChange24h || 0;
  const isPositive = priceChange >= 0;
  const holders = token._count?.holders || 0;

  const defaultImage = `https://api.dicebear.com/7.x/shapes/svg?seed=${token.mint}`;

  const { price: solPriceUsd } = useSolPrice();

  // 🔥 METADATA STATE
  const [metadata, setMetadata] = useState<any>(null);

  // 🔥 FETCH METADATA (same as detail page)
  useEffect(() => {
    if (!token.uri) return;

    const fetchMeta = async () => {
      try {
        const res = await fetch(token.uri!);
        const data = await res.json();
        setMetadata(data);
      } catch {
        console.log('metadata fetch failed');
      }
    };

    fetchMeta();
  }, [token.uri]);

  // 🔥 ATTRIBUTE PARSER (same as detail)
  const socialFromAttributes = Array.isArray(metadata?.attributes)
    ? metadata.attributes.reduce(
      (acc: any, item: any) => {
        const type = String(item?.trait_type || '').toLowerCase().trim();
        const value = String(item?.value || '').trim();
        if (!value) return acc;

        if (type === 'twitter' || type === 'x') acc.twitter = value;
        if (type === 'telegram' || type === 'tg') acc.telegram = value;
        if (type === 'website' || type === 'web') acc.website = value;

        return acc;
      },
      {}
    )
    : {};

  // 🔥 SAME SOCIAL LOGIC (IDENTICAL to TokenDetail)
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
    if (url.startsWith('http')) return url;
    return `https://${url}`;
  };

  // 🔥 SAME MARKET CAP LOGIC (UNCHANGED)
  const liquidityMarketCap = useMemo(() => {
    const TOTAL_SUPPLY = 1_000_000_000;

    const virtualSol = Number(token.virtualSolReserves || 0) / 1e9;
    const virtualTokens = Number(token.virtualTokenReserves || 0) / 1e6;

    if (virtualTokens > 0 && virtualSol > 0) {
      const currentPrice = virtualSol / virtualTokens;
      return currentPrice * TOTAL_SUPPLY * solPriceUsd;
    }
    return 0;
  }, [token, solPriceUsd]);

  return (
    <Link href={`/token/${token.mint}`}>
      <div className="relative rounded-2xl overflow-hidden bg-[#08172A] hover:scale-[1.02] transition-all duration-300 cursor-pointer">

        {/* 🔥 TOP BANNER */}
        <div className="relative h-[110px] w-full">
          <Image
            src={token.banner || token.image || defaultImage}
            alt={token.name}
            fill
            className="object-cover"
          />

          <div
            className={`absolute top-3 right-3 flex items-center gap-1 px-2 py-1 text-xs rounded-full ${isPositive ? 'bg-[#09182b] text-[#84FF00]' : 'bg-red-500 text-white'
              }`}
          >
            {isPositive ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}

            <span>
              {Math.abs(priceChange).toFixed(2)}%
            </span>
          </div>
        </div>

        {/* 🔥 CONTENT */}
        <div className="relative px-4 pb-4 pt-10">

          {/* FLOATING AVATAR */}
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 w-16 h-16 rounded-xl overflow-hidden border-2 border-[#071B2F] shadow-lg">
            <Image
              src={token.image || defaultImage}
              alt={token.name}
              fill
              className="object-cover"
            />
          </div>

          {/* NAME */}
          <div className="text-center mt-2">
            <h3 className="text-white font-semibold">{token.name}</h3>
            <p className="text-xs text-gray-400">${token.symbol}</p>
          </div>

          {/* PRICE */}
          <div className="flex justify-between items-center mt-4">
            <div>
              <p className="text-xs text-gray-400">Price</p>

              {/* 🔥 PRICE + SOCIALS (NO DESIGN CHANGE) */}
              <div className="flex items-center gap-2">
                <p className="text-white font-medium">
                  {formatPrice(token.price || 0, solPriceUsd)}
                </p>
              </div>
            </div>

            <div className={`flex items-center gap-1`}>
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
          </div>

          {/* STATS */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            <div className="bg-[#182536] rounded-xl p-2 ">
              <p className="text-[13px] text-gray-400">MarketCap</p>
              <p className="text-white text-sm font-medium">
                ${formatNumber(liquidityMarketCap)}
              </p>
            </div>

            <div className="bg-[#182536] rounded-xl p-2 ">
              <p className="text-[13px] text-gray-400">Volume</p>
              <p className="text-white text-sm font-medium">
                ${formatNumber((token.volume24h || 0) * solPriceUsd)}
              </p>
            </div>

            <div className="bg-[#182536] rounded-xl p-2 ">
              <p className="text-[13px] text-gray-400">Holders</p>
              <p className="text-white text-sm font-medium flex items-center gap-1">
                {/* <Users size={12}/> */}
                {holders}
              </p>
            </div>
          </div>

          {/* FOOTER */}
          <div className="mt-4 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-[#6FA8FF]">
              <img
                src="/images/duck.png"
                alt="creator"
                className="w-4 h-4 object-contain"
              />
              <span className="font-medium">
                {token.creatorAddress.slice(0, 4)}...
                {token.creatorAddress.slice(-4)}
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