'use client';

import { FC, useState, useEffect } from 'react';
import { TokenCard } from './TokenCard';
import { Search, Filter, TrendingUp, Clock, Flame, Loader2 } from 'lucide-react';
import { useTokens, Token } from '@/hooks/useApi';
import { useSocket } from '@/components/providers/SocketProvider';
import toast from 'react-hot-toast';
import { AppLoader } from '../Apploader';

type SortOption = 'trending' | 'newest' | 'marketCap' | 'volume';

const sortFieldMap: Record<SortOption, string> = {
  trending: 'priceChange24h',
  newest: 'createdAt',
  marketCap: 'marketCap',
  volume: 'volume24h',
};

export const TokenList: FC = () => {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('trending');
  const [showGraduated, setShowGraduated] = useState(true);
  const [page, setPage] = useState(1);
  const [newTokens, setNewTokens] = useState<Token[]>([]);

  const { socket, subscribeToFeed, unsubscribeFromFeed, connected } = useSocket();

  const { data, isLoading, error, refetch } = useTokens({
    page,
    limit: 20,
    sort: sortFieldMap[sortBy],
    order: 'desc',
    graduated: showGraduated ? undefined : false,
    search: search || undefined,
  });

  useEffect(() => {
    if (!socket || !connected) return;

    subscribeToFeed();

    const handleNewToken = (token: Token) => {
      toast.success(`New token: ${token.name} ($${token.symbol})`, {
        icon: '🚀',
        duration: 4000,
      });

      if (page === 1 && sortBy === 'newest') {
        setNewTokens(prev => [token, ...prev].slice(0, 5));
      }

      refetch();
    };

    const handleGraduated = (data: { mint: string }) => {
      refetch();
    };

    socket.on('token:created', handleNewToken);
    socket.on('token:graduated', handleGraduated);

    return () => {
      unsubscribeFromFeed();
      socket.off('token:created', handleNewToken);
      socket.off('token:graduated', handleGraduated);
    };
  }, [socket, connected, subscribeToFeed, unsubscribeFromFeed, page, sortBy, refetch]);

  useEffect(() => {
    setNewTokens([]);
  }, [data]);

  const tokens = data?.tokens || [];
  const pagination = data?.pagination;

  const displayTokens = [
    ...newTokens.filter(nt => !tokens.some(t => t.mint === nt.mint)),
    ...tokens,
  ];

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 mb-4">Failed to load tokens</p>
        <button onClick={() => refetch()} className="btn-primary" style={{backgroundColor:'#528EFC'}}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div id="tokens" className="space-y-6">

      {/* Search + Buttons */}
      <div className="flex flex-col md:flex-row gap-4" style={{ justifyContent: 'space-between' }}>
        
        {/* Search */}
   <div className="w-full md:w-[600px]">
  <div
    className="flex items-center h-11 sm:h-12 px-3 sm:px-4"
    style={{
      backgroundColor: '#08172A',
      border: '1px solid #34557D',
      borderRadius: '12px',
      padding:'28px',
    }}
  >
    {/* ICON */}
    <Search className="w-5 h-5 sm:w-5 sm:h-5 text-white opacity-60 mr-2 flex-shrink-0" />

    {/* INPUT */}
    <input
      type="text"
      placeholder="Search tokens..."
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className="w-full bg-transparent outline-none text-lg text-white placeholder-[#ffffff9d]"
    />
  </div>
</div>

        {/* Buttons */}
     <>
  {/* 🔥 LOCAL SCROLLBAR HIDE (only for this section) */}
  <style jsx>{`
    .no-scrollbar::-webkit-scrollbar {
      display: none;
    }
  `}</style>

  <div
    className="flex gap-2 overflow-x-auto whitespace-nowrap sm:flex-wrap no-scrollbar"
    style={{
      scrollbarWidth: 'none',     // Firefox
      msOverflowStyle: 'none',    // IE/Edge
    }}
  >

    {/* Trending */}
    <button
      onClick={() => setSortBy('trending')}
      className={`flex-shrink-0 flex items-center justify-center space-x-2 w-auto sm:w-auto px-6 py-3 rounded-[15px] transition-all duration-200 ${
        sortBy === 'trending'
          ? 'bg-white text-black'
          : 'bg-[#182536] text-gray-300 hover:text-white'
      }`}
    >
      <Flame className={`w-6 h-6 ${sortBy === 'trending' ? 'text-black' : 'text-gray-400'}`} />
      <span className="text-[18px]">Trending</span>
    </button>

    {/* New */}
    <button
      onClick={() => setSortBy('newest')}
      className={`flex-shrink-0 flex items-center justify-center space-x-2 w-auto sm:w-auto px-5 py-3 rounded-[15px] transition-all duration-200 ${
        sortBy === 'newest'
          ? 'bg-white text-black'
          : 'bg-[#182536] text-gray-300 hover:text-white'
      }`}
    >
      <Clock className={`w-6 h-6 ${sortBy === 'newest' ? 'text-black' : 'text-gray-400'}`} />
      <span className="text-[18px]">New</span>
    </button>

    {/* Market Cap */}
    <button
      onClick={() => setSortBy('marketCap')}
      className={`flex-shrink-0 flex items-center justify-center space-x-2 w-auto sm:w-auto px-5 py-3 rounded-[15px] transition-all duration-200 ${
        sortBy === 'marketCap'
          ? 'bg-white text-black'
          : 'bg-[#182536] text-gray-300 hover:text-white'
      }`}
    >
      <TrendingUp className={`w-6 h-6 ${sortBy === 'marketCap' ? 'text-black' : 'text-gray-400'}`} />
      <span className="text-[18px]">Market Cap</span>
    </button>

  </div>
</>
      </div>

      {/* 🔥 NEW: Dynamic Heading */}
      <div className="flex items-center space-x-2">

        {sortBy === 'trending' && <Flame className="w-8 h-8 text-white" />}
        {sortBy === 'newest' && <Clock className="w-8 h-8 text-white" />}
        {sortBy === 'marketCap' && <TrendingUp className="w-8 h-8 text-white" />}

        <h2 className="text-2xl md:text-4xl font-semibold text-white">
          {sortBy === 'trending' && 'Trending Now'}
          {sortBy === 'newest' && 'New Tokens'}
          {sortBy === 'marketCap' && 'Market Cap'}
        </h2>

      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-12">
       <AppLoader size={50}  />
        </div>
      )}

      {/* Grid */}
      {!isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {displayTokens.map((token) => (
            <TokenCard key={token.mint} token={token} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && pagination && pagination.pages > 1 && (
        <div className="flex justify-center space-x-2 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>

          <span className="flex items-center px-4 text-gray-400">
            Page {page} of {pagination.pages}
          </span>

          <button
            onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
            disabled={page === pagination.pages}
            className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}

      {!isLoading && displayTokens.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p>No tokens found </p>
        </div>
      )}
    </div>
  );
};