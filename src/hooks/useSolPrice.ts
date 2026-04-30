import { useState, useEffect } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
// SOL price is fetched via backend proxy to avoid CORS restrictions on Jupiter/CoinGecko
const SOL_PRICE_URL = `${API_URL}/api/sol-price`;
const CACHE_DURATION = 60_000; // 1 minute cache
const FALLBACK_PRICE = 83; // Last-resort hardcoded fallback

interface PriceCache {
  price: number;
  timestamp: number;
}

let priceCache: PriceCache | null = null;

/**
 * Hook to get current SOL price in USD
 * Fetches via backend proxy → Jupiter API → CoinGecko fallback
 */
export function useSolPrice() {
  const [price, setPrice] = useState<number>(priceCache?.price || FALLBACK_PRICE);
  const [loading, setLoading] = useState(!priceCache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPrice = async () => {
      // Check cache first
      if (priceCache && Date.now() - priceCache.timestamp < CACHE_DURATION) {
        setPrice(priceCache.price);
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(SOL_PRICE_URL);
        if (!response.ok) throw new Error('SOL price fetch failed');
        const data = await response.json() as { price?: number };
        if (!data.price || isNaN(data.price)) throw new Error('Invalid price response');
        priceCache = { price: data.price, timestamp: Date.now() };
        setPrice(data.price);
        setError(null);
      } catch (err) {
        console.warn('SOL price fetch failed, using fallback:', err);
        setError('Price fetch failed — using last known price');
        // Keep cached price or hardcoded fallback (already set as initial state)
      } finally {
        setLoading(false);
      }
    };

    fetchPrice();

    // Refresh price every minute
    const interval = setInterval(fetchPrice, CACHE_DURATION);
    return () => clearInterval(interval);
  }, []);

  return { price, loading, error };
}

/**
 * Get SOL price synchronously (from cache or fallback)
 * Useful for non-hook contexts
 */
export function getSolPrice(): number {
  if (priceCache && Date.now() - priceCache.timestamp < CACHE_DURATION) {
    return priceCache.price;
  }
  return FALLBACK_PRICE;
}

/**
 * Calculate USD value from SOL amount
 */
export function solToUsd(solAmount: number, solPrice?: number): number {
  return solAmount * (solPrice || getSolPrice());
}
