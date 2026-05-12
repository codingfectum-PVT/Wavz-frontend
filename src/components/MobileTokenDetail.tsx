'use client';

import { FC, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ExternalLink, Copy, Check, Rocket, TrendingUp, Info, DollarSign } from 'lucide-react';
import { formatNumber, shortenAddress, formatTimeAgo } from '@/lib/utils';
import { TradePanel } from './tokens/TradePanel';
import { PriceChart } from './tokens/PriceChart';
import { CommentSection } from './tokens/CommentSection';

// ─── Types ────────────────────────────────────────────────────────────────────

type ActivityTab = 'transactions' | 'holders' | 'threads';
type MarketWindow = '5m' | '1h' | '6h' | '24h';
type MainTab = 'info' | 'chart' | 'buysell';

interface MobileTokenDetailProps {
  // Pass all the same data that TokenDetail already computes
  token: any;
  metadata: any;
  mint: string;
  price: number | null;
  priceLoading: boolean;
  marketCapUsd: number | null;
  volume24hUsd: number;
  holders: number;
  graduationProgress: number;
  graduationThreshold: number;
  isGraduating: boolean;
  activityTrades: any[];
  activityLoading: boolean;
  filteredHoldersList: any[];
  holdersLoading: boolean;
  selectedMarketStats: any;
  marketStatsByWindow: any;
  marketWindow: MarketWindow;
  setMarketWindow: (w: MarketWindow) => void;
  solPriceUsd: number;
  socialLinks: { twitter?: string; telegram?: string; website?: string };
  tokenImage: string;
  tokenDescription: string;
  tokenName: string;
  tokenSymbol: string;
  tradeToken: any;
  onTradeSuccess: (update: any) => void;
  onCopyAddress: () => void;
  copied: boolean;
  formatTxnTime: (ts: string) => string;
  formatMoneyCompact: (v: number) => string;
  formatTokenAmt: (v: string | number) => string;
  normalizeLink: (url?: string) => string;
  onChartPriceUpdate?: (price: number) => void;
}

// ─── Bonding Curve Bar (shown at top across ALL tabs) ────────────────────────

const BondingCurveBar: FC<{
  progress: number;
  threshold: number;
  isGraduating: boolean;
  graduated: boolean;
  realSol: number;
}> = ({ progress, threshold, isGraduating, graduated, realSol }) => (
  <div className="bg-[#08172A] px-4 pt-3 pb-3 border-b border-white/5">
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-white">
        <TrendingUp className="w-4 h-4 text-[#f59e0b]" />
        Bonding Curve Progress
      </div>
      <span className="text-sm font-bold text-[#f59e0b]">{(progress || 0).toFixed(2)}%</span>
    </div>

    <div className="h-1.5 overflow-hidden rounded-full bg-[#19314d] mb-2">
      <div
        className="h-full rounded-full bg-gradient-to-r from-[#3b82f6] to-[#f59e0b] transition-all duration-500"
        style={{ width: `${progress}%` }}
      />
    </div>

    <p className="text-[11px] text-[#8fa4bb] leading-relaxed">
      {isGraduating
        ? 'Creating Meteora DLMM pool...'
        : graduated
        ? 'Coin has graduated 🚀'
        : `${realSol.toFixed(2)} / ${threshold} SOL raised. When ${threshold} SOL is reached, liquidity moves to Meteora.`}
    </p>
  </div>
);

// ─── Tab Bar ─────────────────────────────────────────────────────────────────

const TAB_CONFIG: { id: MainTab; label: string; icon: FC<any> }[] = [
  { id: 'info',    label: 'Info',     icon: Info },
  { id: 'chart',   label: 'Chart',    icon: TrendingUp },
  { id: 'buysell', label: 'Buy/Sell', icon: DollarSign },
];

const TabBar: FC<{ active: MainTab; onChange: (t: MainTab) => void }> = ({ active, onChange }) => (
  <div className="flex bg-[#08172A] border-b border-white/5">
    {TAB_CONFIG.map(({ id, label, icon: Icon }) => (
      <button
        key={id}
        onClick={() => onChange(id)}
        className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-semibold transition-colors border-b-2 ${
          active === id
            ? 'text-[#ffffff] border-[#ffffff]'
            : 'text-[#7a9bb5] border-transparent'
        }`}
      >
        <Icon className="w-3.5 h-3.5" />
        {label}
      </button>
    ))}
  </div>
);

// ─── INFO TAB ─────────────────────────────────────────────────────────────────

const InfoTab: FC<MobileTokenDetailProps> = (props) => {
  const {
    token, mint, tokenImage, tokenName, tokenSymbol, tokenDescription,
    price, priceLoading, marketCapUsd, volume24hUsd, holders,
    socialLinks, normalizeLink, copied, onCopyAddress,
    filteredHoldersList, holdersLoading, solPriceUsd,
    activityTrades, activityLoading, formatTxnTime, formatTokenAmt,
  } = props;

  const [activityTab, setActivityTab] = useState<ActivityTab>('transactions');

  return (
    <div >
      {/* Token header */}
      <div className="bg-[#08172A] p-4 flex gap-3">
        <div className="relative w-[72px] h-[72px] flex-shrink-0 rounded-2xl overflow-hidden bg-[#0e2035]">
          <Image src={tokenImage} alt={tokenName} fill className="object-cover" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold leading-none">{tokenName}</h1>
            {token.graduated && (
              <span className="flex items-center gap-1 rounded-full bg-primary-500/20 px-2 py-0.5 text-[10px] text-primary-400">
                <Rocket className="w-2.5 h-2.5" /> Graduated
              </span>
            )}
          </div>
          <p className="text-sm text-gray-400">{tokenSymbol.toLowerCase()}</p>
          <p className="text-[11px] text-[#9fb0c2] mt-1">
            Creator:{' '}
            <Link href={`/profile/${token.creatorAddress}`} className="text-[#7bc6ff] hover:underline">
              {shortenAddress(token.creatorAddress, 4)}
            </Link>
          </p>
          <p className="text-[11px] text-[#9fb0c2]">Created: {formatTimeAgo(new Date(token.createdAt).getTime())}</p>
        </div>
      </div>

      {/* Social + address row */}
      <div className="bg-[#08172A] px-4 pb-3 pt-3 flex items-center justify-between gap-2 flex-wrap border-t border-white/5">
        <div className="flex items-center gap-2">
          {socialLinks.telegram && (
            <a href={normalizeLink(socialLinks.telegram)} target="_blank" rel="noopener noreferrer"
              className="w-7 h-7 rounded-full bg-[#0e2035] border border-white/10 flex items-center justify-center text-[#8fa4bb] hover:text-white text-[10px]">
              TG
            </a>
          )}
          {socialLinks.twitter && (
            <a href={normalizeLink(socialLinks.twitter)} target="_blank" rel="noopener noreferrer"
              className="w-7 h-7 rounded-full bg-[#0e2035] border border-white/10 flex items-center justify-center text-[#8fa4bb] hover:text-white">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>
          )}
          {socialLinks.website && (
            <a href={normalizeLink(socialLinks.website)} target="_blank" rel="noopener noreferrer"
              className="w-7 h-7 rounded-full bg-[#0e2035] border border-white/10 flex items-center justify-center text-[#8fa4bb] hover:text-white">
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {token.graduated && token.meteoraPool && (
            <a href={`https://meteora.ag/dammv2/${token.meteoraPool}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] text-blue-400 border border-blue-500/20">
              <ExternalLink className="w-2.5 h-2.5" /> Meteora
            </a>
          )}
        </div>

        <button onClick={onCopyAddress}
          className="flex items-center gap-1.5 rounded-full border border-[#2e4a68] bg-[#15263d] px-3 py-1 text-[11px] text-[#d4e4f5] hover:bg-[#223a55]">
          {shortenAddress(mint, 5)}
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2 px-4 py-3 bg-[#08172A] border-t border-white/5">
        <div className="rounded-xl bg-[#1b2c43] p-2.5">
          <p className="text-[10px] text-[#8fa4bb]">Market Cap</p>
          <p className="mt-1 text-sm font-bold">
            {priceLoading ? <span className="inline-block h-4 w-16 animate-pulse rounded bg-[#2a3f5a]" /> : `$${formatNumber(marketCapUsd || 0)}`}
          </p>
        </div>
        <div className="rounded-xl bg-[#1b2c43] p-2.5">
          <p className="text-[10px] text-[#8fa4bb]">Price</p>
          <p className="mt-1 text-sm font-bold">
            {priceLoading ? (
              <span className="inline-block h-4 w-20 animate-pulse rounded bg-[#2a3f5a]" />
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
        </div>
        <div className="rounded-xl bg-[#1b2c43] p-2.5">
          <p className="text-[10px] text-[#8fa4bb]">Volume</p>
          <p className="mt-1 text-sm font-bold">${formatNumber(volume24hUsd)}</p>
        </div>
        <div className="rounded-xl bg-[#1b2c43] p-2.5">
          <p className="text-[10px] text-[#8fa4bb]">Holders</p>
          <p className="mt-1 text-sm font-bold">{holders}</p>
        </div>
      </div>

      {/* Description */}
      <div className="mx-4 mt-3 rounded-xl bg-[#15263d] p-3 text-[12px] leading-relaxed text-gray-300 whitespace-pre-wrap">
        {tokenDescription}
      </div>

      {/* Activity tabs */}
      <div className="mx-4 mt-4 rounded-2xl bg-[#08172A] overflow-hidden">
        <div className="flex border-b border-white/5">
          {(['transactions', 'holders', 'threads'] as ActivityTab[]).map((tab) => (
            <button key={tab} onClick={() => setActivityTab(tab)}
              className={`flex-1 py-2.5 text-xs font-semibold capitalize transition-colors ${
                activityTab === tab ? 'bg-white text-[#050E1A]' : 'text-[rgba(255,255,255,0.5)]'
              }`}>
              {tab === 'transactions' ? 'Txns' : tab === 'holders' ? 'Holders' : 'Comments'}
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
                    className="flex items-center gap-[2px]"
                    title={traderAddress}
                  >
                    <Image src="/images/duck.png" alt="tg" width={17} height={17} />

                    <span className="text-[#528EFC] hover:underline">
                      {shortenAddress(traderAddress || '', 4)}
                    </span>

                    {isDev && (
                      <span className="relative group flex items-center mr-3">
                        
                        {/* SVG */}
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          className="text-blue-300"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M6.81815 22L6.81819 19.143C6.66235 17.592 5.63284 16.4165 4.68213 15" />
                          <path d="M14.4545 22L14.4545 20.2858C19.3636 20.2858 18.8182 14.5717 18.8182 14.5717C18.8182 14.5717 21 14.5717 21 12.286L18.8182 8.8576C18.8182 4.28632 15.1094 2.04169 11.1818 2.00068C8.98139 1.97771 7.22477 2.53124 5.91201 3.5" />
                          <path d="M13 7L15 9.5L13 12" />
                          <path d="M5 7L3 9.5L5 12" />
                          <path d="M10 6L8 13" />
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
          <div className="overflow-x-auto">
            <div className="min-w-[320px]">
              <div className="grid grid-cols-[1fr_80px_70px_50px] px-3 py-2 text-[10px] text-[#8fa4bb] border-b border-white/5">
                <span>Holder</span><span>Balance</span><span>Share</span><span>Link</span>
              </div>
              <div className="max-h-[240px] overflow-y-auto">
                {holdersLoading ? (
                  <div className="px-3 py-5 text-xs text-[#8fa4bb]">Loading…</div>
                ) : filteredHoldersList.length === 0 ? (
                  <div className="px-3 py-5 text-xs text-[#8fa4bb]">No holders yet</div>
                ) : filteredHoldersList.map((h: any, i: number) => {
                  const addr = h.address || h.userAddress || h.owner || '';
                  const bal = Number(h.balance || h.amount || 0) / 1e6;
                  const pct = h.percentage ?? (token.virtualTokenReserves ? (bal / (Number(token.virtualTokenReserves) / 1e6)) * 100 : 0);
                  return (
                    <div key={`${addr}-${i}`} className="grid grid-cols-[1fr_80px_70px_50px] px-3 py-2 text-xs border-t border-white/5">
                      <span className="text-[#8fc7ff] truncate">{shortenAddress(addr, 4)}</span>
                      <span className="text-[#cdd9e5]">{formatNumber(bal)}</span>
                      <span className="text-[#cdd9e5]">{pct.toFixed(2)}%</span>
                      <Link href={`/profile/${addr}`} className="text-[#9ab0c7] hover:text-white">Open</Link>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activityTab === 'threads' && (
          <div className="p-2">
            <CommentSection mint={mint} />
          </div>
        )}
      </div>

      {/* Supply */}
      <div className="mx-4 mt-3 text-[11px] text-[#8fa4bb]">
        Total Supply: 1,000,000,000
      </div>
    </div>
  );
};

// ─── CHART TAB ────────────────────────────────────────────────────────────────

const ChartTab: FC<Pick<MobileTokenDetailProps,
  'mint' | 'selectedMarketStats' | 'marketWindow' | 'setMarketWindow' | 'formatMoneyCompact' | 'onChartPriceUpdate'
>> = ({ mint, selectedMarketStats, marketWindow, setMarketWindow, formatMoneyCompact, onChartPriceUpdate }) => {
  const txnTotal   = Math.max(selectedMarketStats.buys + selectedMarketStats.sells, 1);
  const volumeTotal = Math.max(selectedMarketStats.volumeBuys + selectedMarketStats.volumeSells, 1);
  const makersTotal = Math.max(selectedMarketStats.makersBuys + selectedMarketStats.makersSells, 1);

  return (
    <div className="pb-6">
      <PriceChart mint={mint} onPriceUpdate={onChartPriceUpdate} />

      {/* Time window selector */}
      <div className="overflow-hidden rounded-2xl border border-[#1f3a59] bg-[#08172A] mx-4 mt-4">
        <div className="grid grid-cols-4 bg-[#1a2f46] text-xs">
          {(['5m', '1h', '6h', '24h'] as const).map((t) => (
            <button key={t} onClick={() => setMarketWindow(t)}
              className={`py-2.5 font-semibold transition-colors border-r border-[#15263d] last:border-r-0 ${
                marketWindow === t ? 'bg-white text-[#08172A]' : 'text-[#97acc2] hover:bg-[#223750]'
              }`}>
              {t}
            </button>
          ))}
        </div>

        <div className="text-xs">
          {/* Txns */}
          <div className="grid grid-cols-3 gap-2 px-4 py-3">
            <div><p className="text-[#8fa4bb]">Txns</p><p className="mt-1 text-xl text-white">{selectedMarketStats.txns}</p></div>
            <div><p className="text-[#8fa4bb]">Buys</p><p className="mt-1 text-xl text-white">{selectedMarketStats.buys}</p></div>
            <div className="text-right"><p className="text-[#8fa4bb]">Sells</p><p className="mt-1 text-xl text-white">{selectedMarketStats.sells}</p></div>
            <div className="col-span-3 flex h-1 overflow-hidden rounded-full bg-[#1a2f46]">
              <div style={{ width: `${(selectedMarketStats.buys / txnTotal) * 100}%` }} className="bg-[#45ef56]" />
              <div style={{ width: `${(selectedMarketStats.sells / txnTotal) * 100}%` }} className="bg-[#ff4d6d]" />
            </div>
          </div>

          {/* Volume */}
          <div className="border-t border-[#1f3a59] grid grid-cols-3 gap-2 px-4 py-3">
            <div><p className="text-[#8fa4bb]">Volume</p><p className="mt-1 text-xl text-white">{formatMoneyCompact(selectedMarketStats.volume)}</p></div>
            <div><p className="text-[#8fa4bb]">Buys</p><p className="mt-1 text-xl text-white">{formatMoneyCompact(selectedMarketStats.volumeBuys)}</p></div>
            <div className="text-right"><p className="text-[#8fa4bb]">Sells</p><p className="mt-1 text-xl text-white">{formatMoneyCompact(selectedMarketStats.volumeSells)}</p></div>
            <div className="col-span-3 flex h-1 overflow-hidden rounded-full bg-[#1a2f46]">
              <div style={{ width: `${(selectedMarketStats.volumeBuys / volumeTotal) * 100}%` }} className="bg-[#45ef56]" />
              <div style={{ width: `${(selectedMarketStats.volumeSells / volumeTotal) * 100}%` }} className="bg-[#ff4d6d]" />
            </div>
          </div>

          {/* Makers */}
          <div className="border-t border-[#1f3a59] grid grid-cols-3 gap-2 px-4 py-3">
            <div><p className="text-[#8fa4bb]">Makers</p><p className="mt-1 text-xl text-white">{selectedMarketStats.makers}</p></div>
            <div><p className="text-[#8fa4bb]">Buys</p><p className="mt-1 text-xl text-white">{selectedMarketStats.makersBuys}</p></div>
            <div className="text-right"><p className="text-[#8fa4bb]">Sells</p><p className="mt-1 text-xl text-white">{selectedMarketStats.makersSells}</p></div>
            <div className="col-span-3 flex h-1 overflow-hidden rounded-full bg-[#1a2f46]">
              <div style={{ width: `${(selectedMarketStats.makersBuys / makersTotal) * 100}%` }} className="bg-[#45ef56]" />
              <div style={{ width: `${(selectedMarketStats.makersSells / makersTotal) * 100}%` }} className="bg-[#ff4d6d]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── BUY/SELL TAB ─────────────────────────────────────────────────────────────

const BuySellTab: FC<Pick<MobileTokenDetailProps, 'tradeToken' | 'onTradeSuccess'>> = ({
  tradeToken, onTradeSuccess,
}) => (
  <div className="pb-6">
    <TradePanel token={tradeToken} onTradeSuccess={onTradeSuccess} />
  </div>
);

// ─── MAIN MOBILE COMPONENT ────────────────────────────────────────────────────

export const MobileTokenDetail: FC<MobileTokenDetailProps> = (props) => {
  const [activeTab, setActiveTab] = useState<MainTab>('info');

  const realSol = Number(props.token.realSolReserves) / 1e9;

  return (
    <div className="flex flex-col min-h-screen bg-[#050E1A]">
      {/* Bonding curve — always visible */}
      <BondingCurveBar
        progress={props.graduationProgress}
        threshold={props.graduationThreshold}
        isGraduating={props.isGraduating}
        graduated={props.token.graduated}
        realSol={realSol}
      />

      {/* Tab bar — always visible */}
      <div className="sticky top-0 z-10">
        <TabBar active={activeTab} onChange={setActiveTab} />
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'info'    && <InfoTab    {...props} />}
        {activeTab === 'chart'   && <ChartTab
            mint={props.mint}
            selectedMarketStats={props.selectedMarketStats}
            marketWindow={props.marketWindow}
            setMarketWindow={props.setMarketWindow}
            formatMoneyCompact={props.formatMoneyCompact}
            onChartPriceUpdate={props.onChartPriceUpdate}
          />}
        {activeTab === 'buysell' && <BuySellTab
            tradeToken={props.tradeToken}
            onTradeSuccess={props.onTradeSuccess}
          />}
      </div>
    </div>
  );
};