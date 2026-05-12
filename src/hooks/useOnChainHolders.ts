'use client';

import { useState, useEffect, useCallback } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const TOTAL_SUPPLY_UI = 1_000_000_000; // 1B tokens

export interface OnChainHolder {
  owner: string;
  tokenAccount: string;
  balance: number;   // raw (6 decimals)
  uiBalance: number; // display amount (divided by 1e6)
  percentage: number;
}

export function useOnChainHolders(mint: string) {
  const [holders, setHolders] = useState<OnChainHolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHolders = useCallback(async () => {
    if (!mint) return;
    try {
      // Fetch from backend DB — populated by MeteoraMonitor with full holder list
      // (avoids getTokenLargestAccounts which is hard-capped at 20 by Solana)
      const res = await fetch(`${API_URL}/api/tokens/${mint}/holders?limit=1000`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: Array<{ userAddress: string; balance: string | number }> = await res.json();

      const result: OnChainHolder[] = data.map((item) => {
        const rawBalance = Number(item.balance);
        const uiBalance = rawBalance / 1e6;
        return {
          owner: item.userAddress,
          tokenAccount: item.userAddress,
          balance: rawBalance,
          uiBalance,
          percentage: (uiBalance / TOTAL_SUPPLY_UI) * 100,
        };
      });

      setHolders(result);
      setError(null);
    } catch (err) {
      setError('Failed to fetch holders');
      console.error('useOnChainHolders error:', err);
    } finally {
      setLoading(false);
    }
  }, [mint]);

  useEffect(() => {
    setLoading(true);
    fetchHolders();
    const interval = setInterval(fetchHolders, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [fetchHolders]);

  return { holders, loading, error, refetch: fetchHolders };
}
