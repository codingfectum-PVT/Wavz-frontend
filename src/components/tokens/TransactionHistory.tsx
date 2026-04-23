'use client';

import { FC, useState, useEffect, useRef } from 'react';
import { ArrowUpRight, ArrowDownRight, ExternalLink, Loader2 } from 'lucide-react';
import { useSocket } from '@/components/providers/SocketProvider';
import { AppLoader } from '../Apploader';

interface TransactionHistoryProps {
  mint: string;
}

interface Trade {
  signature: string;
  isBuy: boolean;
  solAmount: string;
  tokenAmount: string;
  price: number;
  timestamp: string;
  walletAddress?: string;
  userAddress?: string;
  user?: { address: string };
  mint?: string;
  isNew?: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export const TransactionHistory: FC<TransactionHistoryProps> = ({ mint }) => {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { socket } = useSocket();
  const initialFetchDone = useRef(false);

  // Initial fetch
  useEffect(() => {
    const fetchTrades = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const res = await fetch(`${API_BASE}/api/trades/token/${mint}?limit=50`);
        if (!res.ok) throw new Error('Failed to fetch trades');
        
        const data = await res.json();
        if (data.trades && Array.isArray(data.trades)) {
          setTrades(data.trades);
        }
      } catch (err) {
        console.error('Error fetching trades:', err);
        setError('Failed to load transactions');
      } finally {
        setLoading(false);
        initialFetchDone.current = true;
      }
    };

    fetchTrades();
  }, [mint]);

  // Real-time updates via WebSocket
  // NOTE: TokenDetail manages the room subscription - we just listen for events
  useEffect(() => {
    if (!socket) return;

    const handleNewTrade = (trade: Trade) => {
      if (trade.mint !== mint) return;
      
      setTrades(prev => {
        if (prev.some(t => t.signature === trade.signature)) return prev;
        return [{ ...trade, isNew: true }, ...prev].slice(0, 50);
      });

      setTimeout(() => {
        setTrades(prev => 
          prev.map(t => t.signature === trade.signature ? { ...t, isNew: false } : t)
        );
      }, 2000);
    };

    socket.on('trade:new', handleNewTrade);

    return () => {
      socket.off('trade:new', handleNewTrade);
    };
  }, [socket, mint]);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const formatAmount = (amount: string, decimals: number = 6) => {
    const num = parseFloat(amount) / Math.pow(10, decimals);
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
    return num.toFixed(4);
  };

  const formatSOL = (amount: string) => {
    const sol = parseFloat(amount) / 1e9;
    return sol.toFixed(4);
  };

  const shortenAddress = (address: string) => {
    if (!address) return '';
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  if (loading && trades.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-gray-800 p-4">
        <h3 className="text-lg font-semibold mb-4">Recent Transactions</h3>
        <div className="flex items-center justify-center py-8">
          <AppLoader size={50}  />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-xl border border-gray-800 p-4">
      <h3 className="text-lg font-semibold mb-4">Recent Transactions</h3>
      
      {error ? (
        <div className="text-center py-8 text-gray-500">{error}</div>
      ) : trades.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No transactions yet. Be the first to trade!
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {trades.map((trade) => (
            <div
              key={trade.signature}
              className={`flex items-center justify-between p-3 bg-background rounded-lg hover:bg-surface-light transition-all duration-300 ${
                trade.isNew 
                  ? 'animate-pulse ring-2 ring-primary-500/50 bg-primary-500/5' 
                  : ''
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-lg ${
                  trade.isBuy 
                    ? 'bg-green-500/10 text-green-500' 
                    : 'bg-red-500/10 text-red-500'
                }`}>
                  {trade.isBuy ? (
                    <ArrowUpRight className="w-4 h-4" />
                  ) : (
                    <ArrowDownRight className="w-4 h-4" />
                  )}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className={`font-medium ${
                      trade.isBuy ? 'text-green-500' : 'text-red-500'
                    }`}>
                      {trade.isBuy ? 'Buy' : 'Sell'}
                    </span>
                    <span className="text-gray-500 text-sm">
                      {formatTime(trade.timestamp)}
                    </span>
                  </div>
                  <div className="text-sm text-gray-400">
                    {shortenAddress(trade.walletAddress || trade.user?.address || '')}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className="font-medium">
                  {formatAmount(trade.tokenAmount)} tokens
                </div>
                <div className="text-sm text-gray-400">
                  {formatSOL(trade.solAmount)} SOL
                </div>
              </div>

              <a
                href={`https://solscan.io/tx/${trade.signature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 text-gray-500 hover:text-white transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
