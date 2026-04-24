'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// Token types
export interface Token {
  mint: string;
  name: string;
  meteoraPool?: string | null;
  symbol: string;
  description?: string;
  image?: string;
  uri?: string;
  banner?: string;
  creatorAddress: string;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  price: number;
  marketCap: number;
  volume24h: number;
  priceChange24h: number;
  graduated: boolean;
  graduatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  twitter?: string;
  telegram?: string;
  website?: string;
  _count?: {
    trades: number;
    holders: number;
  };
}

export interface Trade {
  id: string;
  signature: string;
  mint: string;
  userAddress: string;
  isBuy: boolean;
  solAmount: bigint;
  tokenAmount: bigint;
  price: number;
  timestamp: Date;
  token?: Token;
  user?: {
    address: string;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// Fetch tokens with pagination and filters
export interface FetchTokensParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  graduated?: boolean;
  search?: string;
}

export function useTokens(params: FetchTokensParams = {}) {
  return useQuery({
    queryKey: ['tokens', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params.page) searchParams.set('page', String(params.page));
      if (params.limit) searchParams.set('limit', String(params.limit));
      if (params.sort) searchParams.set('sort', params.sort);
      if (params.order) searchParams.set('order', params.order);
      if (params.graduated !== undefined) searchParams.set('graduated', String(params.graduated));
      if (params.search) searchParams.set('search', params.search);

      const response = await fetch(`${API_URL}/api/tokens?${searchParams}`);
      if (!response.ok) {
        throw new Error('Failed to fetch tokens');
      }
      const data = await response.json();
      return {
        tokens: data.tokens as Token[],
        pagination: data.pagination,
      };
    },
    staleTime: 10000, // 10 seconds
  });
}

// Fetch single token by mint
export function useToken(mint: string) {
  return useQuery({
    queryKey: ['token', mint],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/tokens/${mint}`);
      if (!response.ok) {
        throw new Error('Failed to fetch token');
      }
      return response.json() as Promise<Token>;
    },
    enabled: !!mint,
  });
}

// Fetch token price history
export function useTokenPrices(mint: string, interval = '5m', limit = 100) {
  return useQuery({
    queryKey: ['token-prices', mint, interval, limit],
    queryFn: async () => {
      const response = await fetch(
        `${API_URL}/api/tokens/${mint}/prices?interval=${interval}&limit=${limit}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch price history');
      }
      return response.json();
    },
    enabled: !!mint,
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

// Fetch token holders
export function useTokenHolders(mint: string, limit = 20) {
  return useQuery({
    queryKey: ['token-holders', mint, limit],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/tokens/${mint}/holders?limit=${limit}`);
      if (!response.ok) {
        throw new Error('Failed to fetch holders');
      }
      return response.json();
    },
    enabled: !!mint,
    refetchInterval: 15000, // Refresh every 15 seconds
    staleTime: 10000,
  });
}

// Fetch trending tokens
export function useTrendingTokens(limit = 10) {
  return useQuery({
    queryKey: ['trending-tokens', limit],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/tokens/stats/trending?limit=${limit}`);
      if (!response.ok) {
        throw new Error('Failed to fetch trending tokens');
      }
      return response.json() as Promise<Token[]>;
    },
    staleTime: 30000, // 30 seconds
  });
}

// Fetch recent trades
export function useTrades(params: { page?: number; limit?: number; mint?: string } = {}) {
  return useQuery({
    queryKey: ['trades', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params.page) searchParams.set('page', String(params.page));
      if (params.limit) searchParams.set('limit', String(params.limit));

      const endpoint = params.mint
        ? `${API_URL}/api/trades/token/${params.mint}`
        : `${API_URL}/api/trades`;

      const response = await fetch(`${endpoint}?${searchParams}`);
      if (!response.ok) {
        throw new Error('Failed to fetch trades');
      }
      const data = await response.json();
      return {
        trades: data.trades as Trade[],
        pagination: data.pagination,
      };
    },
    staleTime: 5000, // 5 seconds
  });
}

// Fetch volume stats
export function useVolumeStats(period: '1h' | '24h' | '7d' | '30d' = '24h') {
  return useQuery({
    queryKey: ['volume-stats', period],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/trades/stats/volume?period=${period}`);
      if (!response.ok) {
        throw new Error('Failed to fetch volume stats');
      }
      return response.json();
    },
    staleTime: 60000, // 1 minute
  });
}

// Fetch user profile
export function useUser(address: string) {
  return useQuery({
    queryKey: ['user', address],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/users/${address}`);
      if (!response.ok) {
        throw new Error('Failed to fetch user');
      }
      return response.json();
    },
    enabled: !!address,
  });
}

// Fetch user trades
export function useUserTrades(address: string, page = 1, limit = 50) {
  return useQuery({
    queryKey: ['user-trades', address, page, limit],
    queryFn: async () => {
      const response = await fetch(
        `${API_URL}/api/users/${address}/trades?page=${page}&limit=${limit}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch user trades');
      }
      return response.json();
    },
    enabled: !!address,
  });
}

// Fetch user PnL
export function useUserPnL(address: string) {
  return useQuery({
    queryKey: ['user-pnl', address],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/users/${address}/pnl`);
      if (!response.ok) {
        throw new Error('Failed to fetch user PnL');
      }
      return response.json();
    },
    enabled: !!address,
  });
}
