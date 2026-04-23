'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useUser, useUserTrades, Token } from '@/hooks/useApi';
import {
  Loader2,
  Search,
  Coins,
  ArrowUpRight,
  ArrowDownLeft,
  Heart,
  RefreshCcw,
  ArrowUpDown,
  Plus,
  ChevronDown,
  Copy,
  Check,
  Wallet,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import Image from 'next/image';
import { AppLoader } from '@/components/Apploader';

type Holding = {
  token: Token;
  balance: string;
};

type UserProfile = {
  address: string;
  trustScore?: number;
  _count?: {
    tokensCreated?: number;
    trades?: number;
  };
  holdings?: Holding[];
  tokensCreated?: Token[];
};

export default function ProfilePage() {
  const params = useParams();
  const address = params.address as string;
  const wallet = useWallet();
  const isOwnProfile = wallet.publicKey?.toBase58() === address;

  const {
    data: user,
    isLoading: userLoading,
    error: userError,
    refetch: refetchUser,
  } = useUser(address);

  const {
    data: tradesData,
    isLoading: tradesLoading,
    refetch: refetchTrades,
  } = useUserTrades(address, 1, 20);

  const profile = user as UserProfile | undefined;

  const [activeTab, setActiveTab] = useState<'owned' | 'created'>('owned');
  const [tokenSearch, setTokenSearch] = useState('');
  const [tradeSearch, setTradeSearch] = useState('');
  const [sortBy, setSortBy] = useState<'creation' | 'name'>('creation');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [refreshingTokens, setRefreshingTokens] = useState(false);
  const [refreshingTrades, setRefreshingTrades] = useState(false);
  const [copied, setCopied] = useState(false);

  const holdings = profile?.holdings || [];
  const createdTokens = profile?.tokensCreated || [];

  const shortAddress = `${address.slice(0, 4)}...${address.slice(-4)}`;

  const filteredOwned = useMemo(() => {
    const query = tokenSearch.toLowerCase().trim();
    const data = holdings.filter((h) => {
      if (!query) return true;
      return (
        h.token.name?.toLowerCase().includes(query) ||
        h.token.symbol?.toLowerCase().includes(query)
      );
    });

    return [...data].sort((a, b) => {
      let comp = 0;
      if (sortBy === 'name') {
        comp = (a.token.name || '').localeCompare(b.token.name || '');
      } else {
        const aTime = a.token.createdAt ? new Date(a.token.createdAt).getTime() : 0;
        const bTime = b.token.createdAt ? new Date(b.token.createdAt).getTime() : 0;
        comp = aTime - bTime;
      }
      return sortOrder === 'asc' ? comp : -comp;
    });
  }, [holdings, tokenSearch, sortBy, sortOrder]);

  const filteredCreated = useMemo(() => {
    const query = tokenSearch.toLowerCase().trim();
    const data = createdTokens.filter((t) => {
      if (!query) return true;
      return t.name?.toLowerCase().includes(query) || t.symbol?.toLowerCase().includes(query);
    });

    return [...data].sort((a, b) => {
      let comp = 0;
      if (sortBy === 'name') {
        comp = (a.name || '').localeCompare(b.name || '');
      } else {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        comp = aTime - bTime;
      }
      return sortOrder === 'asc' ? comp : -comp;
    });
  }, [createdTokens, tokenSearch, sortBy, sortOrder]);

  const filteredTrades = useMemo(() => {
    const query = tradeSearch.toLowerCase().trim();
    const trades = tradesData?.trades || [];

    return trades.filter((trade: { token?: Token; isBuy: boolean }) => {
      if (!query) return true;
      const side = trade.isBuy ? 'buy' : 'sell';
      return (
        trade.token?.name?.toLowerCase().includes(query) ||
        trade.token?.symbol?.toLowerCase().includes(query) ||
        side.includes(query)
      );
    });
  }, [tradesData?.trades, tradeSearch]);

  const handleRefreshTokens = async () => {
    setRefreshingTokens(true);
    try {
      await refetchUser();
    } finally {
      setRefreshingTokens(false);
    }
  };

  const handleRefreshTrades = async () => {
    setRefreshingTrades(true);
    try {
      await refetchTrades();
    } finally {
      setRefreshingTrades(false);
    }
  };

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  if (userLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <AppLoader size={50} />
      </div>
    );
  }

  if (userError) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-red-400">Failed to load profile</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 text-white">
      <div className="mb-6 rounded-2xl border border-[#1f3c5a] bg-[#08172A] p-4 md:p-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.45fr_2fr]">
          <div className="flex items-center gap-4 rounded-xl  p-4">
            <div className="relative h-16 w-16 overflow-hidden rounded-xl bg-[#182536]">
              <Image src="/images/img-placeholder.png" alt="Avatar" fill className="object-cover" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">{shortAddress}</h1>
              <div className="mt-1 flex items-center gap-2 text-sm text-[#8fa4bb]">
                <span>{shortAddress}</span>
                <button
                  onClick={handleCopyAddress}
                  className="rounded-md p-1 text-white hover:bg-white/10"
                  title="Copy wallet address"
                  aria-label="Copy wallet address"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <a
                href={`https://solscan.io/account/${address}${process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'devnet' ? '?cluster=devnet' : ''}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 flex items-center gap-2 text-sm text-[#32d1ff] hover:opacity-80"
              >
                <Image src="/images/solscan-logo.png" alt="Solscan" width={14} height={14} />
                <span>View on solscan</span>
              </a>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl bg-[#182536] p-4">
              <p className="flex items-center gap-1.5 text-sm text-[#8fa4bb]">
                <Wallet className="h-3.5 w-3.5 fill-current text-[#8fa4bb]" />
                <span>Token Owned</span>
              </p>
              <p className="mt-1 text-2xl font-semibold">{holdings.length}</p>
            </div>
            <div className="rounded-xl bg-[#182536] p-4">
              <p className="flex items-center gap-1.5 text-sm text-[#8fa4bb]">
                <Image src="/images/coin.png" alt="Coin" width={15} height={15} />
                <span>Token Created</span>
              </p>
              <p className="mt-1 text-2xl font-semibold">{profile?._count?.tokensCreated || createdTokens.length || 0}</p>
            </div>
            <div className="rounded-xl bg-[#182536] p-4">
              <p className="flex items-center gap-1.5 text-sm text-[#8fa4bb]">
                <TrendingUp className="h-3.5 w-3.5 fill-current text-[#8fa4bb]" />
                <span>Total Trades</span>
              </p>
              <p className="mt-1 text-2xl font-semibold">{profile?._count?.trades || 0}</p>
            </div>
            <div className="rounded-xl bg-[#182536] p-4">
              <p className="flex items-center gap-1 text-sm text-[#8fa4bb]">
                <Heart className="h-3.5 w-3.5 fill-current text-[#8fa4bb]" />
                <span>Trust Score</span>
              </p>
              <p className="mt-1 text-2xl font-semibold">{profile?.trustScore ?? 50}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={() => setActiveTab('owned')}
          className={`rounded-xl px-4 py-2 font-medium transition-colors ${
            activeTab === 'owned' ? 'bg-white text-[#08172A]' : 'bg-[#182536] text-[#9db0c6] hover:text-white'
          }`}
        >
          <span className="flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            Token Owned
          </span>
        </button>
        <button
          onClick={() => setActiveTab('created')}
          className={`rounded-xl px-4 py-2 font-medium transition-colors ${
            activeTab === 'created' ? 'bg-white text-[#08172A]' : 'bg-[#182536] text-[#9db0c6] hover:text-white'
          }`}
        >
          <span className="flex items-center gap-2">
            <Coins className="h-4 w-4" />
            Token Created
          </span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-2xl bg-[#08172A] p-4 md:p-5">
          <h2 className="mb-3 text-2xl font-semibold">{activeTab === 'owned' ? 'Token Owned' : 'Token Created'}</h2>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8fa4bb]" />
              <input
                type="text"
                value={tokenSearch}
                onChange={(e) => setTokenSearch(e.target.value)}
                placeholder="Search tokens..."
                className="w-full rounded-xl border border-[#2a4664] bg-transparent py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-[#8197ae] focus:border-[#3b5f85] focus:outline-none"
              />
            </div>

            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'creation' | 'name')}
                className="appearance-none rounded-xl border border-[#2a4664] bg-[#182536] px-4 py-2.5 pr-9 text-sm text-white focus:border-[#3b5f85] focus:outline-none"
              >
                <option value="creation">Creation Time</option>
                <option value="name">Name</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8fa4bb]" />
            </div>

            <button
              onClick={() => setSortOrder((s) => (s === 'asc' ? 'desc' : 'asc'))}
              className="rounded-xl border border-[#2a4664] bg-[#182536] p-2.5 text-[#c2d0df] hover:bg-[#213248]"
              title={`Order: ${sortOrder}`}
            >
              <ArrowUpDown className="h-4 w-4" />
            </button>

            <button
              onClick={handleRefreshTokens}
              disabled={refreshingTokens}
              className="rounded-xl border border-[#2a4664] bg-[#182536] p-2.5 text-[#c2d0df] hover:bg-[#213248] disabled:opacity-50"
              title="Refresh"
            >
              {refreshingTokens ? <AppLoader size={50}  /> : <RefreshCcw className="h-4 w-4" />}
            </button>

            {isOwnProfile && (
              <Link
                href="/create"
                className="inline-flex items-center gap-2 rounded-xl  px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e68312]"
                                  style={{ backgroundColor: '#FE9216', borderRadius: '14px',textAlign:'left',fontSize:'18px' ,boxShadow: "rgba(255, 255, 255, 0.5) 0px 6px 4px 0px inset,rgba(254, 146, 22, 0.15) 0px 0px 12px 0px"}}
              >
                <Plus className="h-4 w-4" />
                Create Token
              </Link>
            )}
          </div>

          <div className="rounded-xl  min-h-[330px]">
            {activeTab === 'owned' ? (
              filteredOwned.length > 0 ? (
                <div className="space-y-3">
                  {filteredOwned.map((holding) => (
                    <Link
                      key={holding.token.mint}
                      href={`/token/${holding.token.mint}`}
                      className="flex items-center justify-between rounded-xl p-2.5 hover:bg-[#0f213b]"
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative h-9 w-9 overflow-hidden rounded-full bg-[#182536]">
                          <Image
                            src={holding.token.image || '/images/coin.png'}
                            alt={holding.token.symbol || 'Token'}
                            fill
                            className="object-cover"
                          />
                        </div>
                        <div>
                          <p className="font-medium">{holding.token.name || holding.token.symbol}</p>
                          <p className="text-xs text-[#93a6bc]">
                            {(Number(holding.balance) / 1e6).toLocaleString()} {holding.token.symbol}
                          </p>
                        </div>
                      </div>
                      <p className="font-semibold text-white">${Math.round((holding.token.price || 0) * (Number(holding.balance) / 1e6)).toLocaleString()}</p>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="py-12 text-center text-[#8ca0b6]">No owned tokens found</p>
              )
            ) : filteredCreated.length > 0 ? (
              <div className="space-y-3">
                {filteredCreated.map((token) => (
                  <Link
                    key={token.mint}
                    href={`/token/${token.mint}`}
                    className="flex items-center justify-between rounded-xl p-2.5 hover:bg-[#0f213b]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative h-9 w-9 overflow-hidden rounded-full bg-[#182536]">
                        <Image
                          src={token.image || '/images/coin.png'}
                          alt={token.symbol || 'Token'}
                          fill
                          className="object-cover"
                        />
                      </div>
                      <div>
                        <p className="font-medium">{token.name || token.symbol}</p>
                        <p className="text-xs text-[#93a6bc]">{token.symbol}</p>
                      </div>
                    </div>
                    <p className="font-semibold text-white">${token.marketCap?.toLocaleString() || '0'}</p>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="py-12 text-center text-[#8ca0b6]">No created tokens found</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-[#08172A] p-4 md:p-5">
          <h2 className="mb-3 text-2xl font-semibold">Recent Trades</h2>

          <div className="mb-4 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8fa4bb]" />
              <input
                type="text"
                value={tradeSearch}
                onChange={(e) => setTradeSearch(e.target.value)}
                placeholder="Search trades..."
                className="w-full rounded-xl border border-[#2a4664] bg-transparent py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-[#8197ae] focus:border-[#3b5f85] focus:outline-none"
              />
            </div>
            <button
              onClick={handleRefreshTrades}
              disabled={refreshingTrades}
              className="rounded-xl border border-[#2a4664] bg-[#182536] p-2.5 text-[#c2d0df] hover:bg-[#213248] disabled:opacity-50"
              title="Refresh trades"
            >
              {refreshingTrades ? <AppLoader size={50}  /> : <RefreshCcw className="h-4 w-4" />}
            </button>
          </div>

          <div className="min-h-[330px] rounded-xl ">
            {tradesLoading ? (
              <div className="flex justify-center py-10">
                <AppLoader size={50}  />
              </div>
            ) : filteredTrades.length > 0 ? (
              <div className="space-y-3">
                {filteredTrades.map(
                  (trade: {
                    id: string;
                    isBuy: boolean;
                    solAmount: string | number;
                    tokenAmount: string | number;
                    timestamp: string;
                    token?: Token;
                  }) => (
                    <div key={trade.id} className="flex items-center justify-between rounded-xl p-2.5 hover:bg-[#0f213b]">
                      <div className="flex items-center gap-3">
                        <div className={`rounded-full p-2 ${trade.isBuy ? 'bg-green-500/15' : 'bg-red-500/15'}`}>
                          {trade.isBuy ? (
                            <ArrowUpRight className="h-4 w-4 text-green-400" />
                          ) : (
                            <ArrowDownLeft className="h-4 w-4 text-red-400" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium">
                            {trade.isBuy ? 'Buy' : 'Sell'} {trade.token?.name || trade.token?.symbol || 'Token'}
                          </p>
                          <p className="text-xs text-[#8ca0b6]">{new Date(trade.timestamp).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-medium ${trade.isBuy ? 'text-green-400' : 'text-red-400'}`}>
                          {trade.isBuy ? '+' : '-'}{(Number(trade.tokenAmount) / 1e6).toLocaleString()} {trade.token?.symbol || 'token'}
                        </p>
                        <p className="text-xs text-[#8ca0b6]">{(Number(trade.solAmount) / 1e9).toFixed(4)} SOL</p>
                      </div>
                    </div>
                  )
                )}
              </div>
            ) : (
              <p className="py-12 text-center text-[#8ca0b6]">No trades found</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
