'use client';

import { FC, useState, useEffect, useRef, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, ColorType, UTCTimestamp, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import { Loader2 } from 'lucide-react';
import { useSocket } from '@/components/providers/SocketProvider';
import { AppLoader } from '../Apploader';

interface PriceChartProps {
  mint: string;
}

interface Trade {
  signature: string;
  isBuy: boolean;
  solAmount: string;
  tokenAmount: string;
  price: number;
  timestamp: string;
}

interface OHLCData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type TimeRange = '1m' | '5m' | '15m' | '1H' | '4H';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Aggregate trades into OHLC candlesticks with volume
function aggregateToCandles(trades: Trade[], intervalMs: number) {
  if (trades.length === 0) return { candles: [], volumes: [] };

  const sortedTrades = [...trades].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const candleMap: Map<number, { 
    open: number; high: number; low: number; close: number; 
    time: number; volume: number; isBuyDominant: boolean;
    buyVolume: number; sellVolume: number;
  }> = new Map();

  sortedTrades.forEach(trade => {
    const time = new Date(trade.timestamp).getTime();
    const candleTime = Math.floor(time / intervalMs) * intervalMs;
    const price = trade.price;
    // solAmount is stored in lamports, convert to SOL
    const volume = parseFloat(trade.solAmount) / 1e9;

    if (candleMap.has(candleTime)) {
      const candle = candleMap.get(candleTime)!;
      candle.high = Math.max(candle.high, price);
      candle.low = Math.min(candle.low, price);
      candle.close = price;
      candle.volume += volume;
      if (trade.isBuy) {
        candle.buyVolume += volume;
      } else {
        candle.sellVolume += volume;
      }
      candle.isBuyDominant = candle.buyVolume > candle.sellVolume;
    } else {
      candleMap.set(candleTime, {
        open: price,
        high: price,
        low: price,
        close: price,
        time: candleTime,
        volume: volume,
        buyVolume: trade.isBuy ? volume : 0,
        sellVolume: trade.isBuy ? 0 : volume,
        isBuyDominant: trade.isBuy,
      });
    }
  });

  const sortedCandles = Array.from(candleMap.values()).sort((a, b) => a.time - b.time);
  
  const candles = sortedCandles.map(c => ({
    time: (c.time / 1000) as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));

  // Volume color based on candle direction (pump.fun style)
  const volumes = sortedCandles.map(c => ({
    time: (c.time / 1000) as UTCTimestamp,
    value: c.volume,
    color: c.close >= c.open ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)',
  }));

  return { candles, volumes, sortedCandles };
}

export const PriceChart: FC<PriceChartProps> = ({ mint }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('1m');
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);
  const [chartReady, setChartReady] = useState(false);
  const [ohlcData, setOhlcData] = useState<OHLCData | null>(null);
  
  const { socket } = useSocket();

  // Get interval in ms based on time range
  const getIntervalMs = useCallback((range: TimeRange): number => {
    switch (range) {
      case '1m': return 60 * 1000;
      case '5m': return 5 * 60 * 1000;
      case '15m': return 15 * 60 * 1000;
      case '1H': return 60 * 60 * 1000;
      case '4H': return 4 * 60 * 60 * 1000;
      default: return 60 * 1000;
    }
  }, []);

  // Fetch trades
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const tradesRes = await fetch(`${API_BASE}/api/trades/token/${mint}?limit=1000`);
        if (tradesRes.ok) {
          const tradesJson = await tradesRes.json();
          if (tradesJson.trades && Array.isArray(tradesJson.trades)) {
            setTrades(tradesJson.trades);
            
            // Set current price
            if (tradesJson.trades.length > 0) {
              const latestTrade = tradesJson.trades[0];
              setCurrentPrice(latestTrade.price);
              
              // Calculate price change
              if (tradesJson.trades.length > 1) {
                const oldestTrade = tradesJson.trades[tradesJson.trades.length - 1];
                const change = ((latestTrade.price - oldestTrade.price) / oldestTrade.price) * 100;
                setPriceChange(change);
              }
            }
          }
        }
      } catch (err) {
        console.error('Error fetching chart data:', err);
        setError('Failed to load chart data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    
    // Refresh every 30 seconds (reduced from 10s since we have real-time updates)
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [mint]);

  // Real-time trade updates via WebSocket
  // NOTE: TokenDetail manages the room subscription - we just listen for events
  useEffect(() => {
    if (!socket) return;

    const handleNewTrade = (trade: any) => {
      if (trade.mint !== mint) return;
      
      const newTrade: Trade = {
        signature: trade.signature,
        isBuy: trade.isBuy,
        solAmount: trade.solAmount,
        tokenAmount: trade.tokenAmount,
        price: trade.price,
        timestamp: trade.timestamp || new Date().toISOString(),
      };
      
      setTrades(prev => {
        if (prev.some(t => t.signature === trade.signature)) return prev;
        return [newTrade, ...prev].slice(0, 1000);
      });
      
      setCurrentPrice(trade.price);
    };

    socket.on('trade:new', handleNewTrade);

    return () => {
      socket.off('trade:new', handleNewTrade);
    };
  }, [socket, mint]);

  // Initialize chart after component mounts and container exists
  useEffect(() => {
    if (!chartContainerRef.current || chartRef.current) return;

    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      if (!chartContainerRef.current) return;
      
      const chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: '#08172A' },
          textColor: '#8fa4bb',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          fontSize: 11,
        },
        grid: {
          vertLines: { 
            color: 'rgba(31, 58, 89, 0.45)',
            visible: false,
          },
          horzLines: { 
            color: 'rgba(31, 58, 89, 0.45)',
          },
        },
        width: chartContainerRef.current.clientWidth,
        height: 400,
        crosshair: {
          mode: 0,
          vertLine: {
            color: 'rgba(255, 255, 255, 0.2)',
            width: 1,
            style: 3,
            labelBackgroundColor: '#1a2f46',
          },
          horzLine: {
            color: 'rgba(255, 255, 255, 0.2)',
            width: 1,
            style: 3,
            labelBackgroundColor: '#1a2f46',
          },
        },
        rightPriceScale: {
          borderColor: 'rgba(31, 58, 89, 0.55)',
          textColor: '#8fa4bb',
          scaleMargins: {
            top: 0.05,
            bottom: 0.2,
          },
        },
        timeScale: {
          borderColor: 'rgba(31, 58, 89, 0.55)',
          timeVisible: true,
          secondsVisible: false,
          barSpacing: 6,
          minBarSpacing: 2,
          rightOffset: 5,
        },
      });

      // Add volume series first (so it's behind candles)
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: 'volume',
      });
      
      volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.85,
          bottom: 0,
        },
      });

      // Add candlestick series - pump.fun thin candle style
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#1fd1c2',
        downColor: '#ff4d6d',
        borderUpColor: '#1fd1c2',
        borderDownColor: '#ff4d6d',
        wickUpColor: '#1fd1c2',
        wickDownColor: '#ff4d6d',
        borderVisible: false,
      });

      // Set proper price format for small numbers
      candleSeries.applyOptions({
        priceFormat: {
          type: 'price',
          precision: 10,
          minMove: 0.0000000001,
        },
      });

      // Subscribe to crosshair move for OHLC display
      chart.subscribeCrosshairMove((param) => {
        if (param.time && candleSeriesRef.current) {
          const data = param.seriesData.get(candleSeriesRef.current);
          if (data && 'open' in data) {
            setOhlcData({
              open: data.open,
              high: data.high,
              low: data.low,
              close: data.close,
              volume: 0,
            });
          }
        }
      });

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;
      volumeSeriesRef.current = volumeSeries;
      setChartReady(true);

      // Handle resize
      const handleResize = () => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: chartContainerRef.current.clientWidth,
          });
        }
      };

      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }, 100);

    return () => {
      clearTimeout(timer);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        candleSeriesRef.current = null;
        volumeSeriesRef.current = null;
      }
    };
  }, []);

  // Update chart when trades or time range changes
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !chartReady || trades.length === 0) return;

    const intervalMs = getIntervalMs(timeRange);
    const { candles, volumes, sortedCandles } = aggregateToCandles(trades, intervalMs);
    
    if (candles.length > 0 && sortedCandles && sortedCandles.length > 0) {
      candleSeriesRef.current.setData(candles);
      volumeSeriesRef.current.setData(volumes);
      chartRef.current?.timeScale().fitContent();
      
      // Set initial OHLC data
      const lastCandle = candles[candles.length - 1];
      const lastVolume = sortedCandles[sortedCandles.length - 1];
      setOhlcData({
        open: lastCandle.open,
        high: lastCandle.high,
        low: lastCandle.low,
        close: lastCandle.close,
        volume: lastVolume?.volume || 0,
      });
    }
  }, [trades, timeRange, getIntervalMs, chartReady]);

  const timeRanges: TimeRange[] = ['1m', '5m', '15m', '1H', '4H'];

  const formatPrice = (price: number) => {
    if (price < 0.0001) return price.toFixed(10);
    if (price < 0.01) return price.toFixed(8);
    if (price < 1) return price.toFixed(6);
    return price.toFixed(4);
  };

  return (
    <div className="overflow-hidden rounded-2xl  bg-[#08172A]">
      {/* Header with OHLC data - pump.fun style */}
      <div className="flex items-center justify-between border-b border-[#1f3a59] px-3 py-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            {timeRanges.map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-all ${
                  timeRange === range
                    ? 'bg-[#26a69a] text-black'
                    : 'text-[#8fa4bb] hover:text-white hover:bg-[#1a2f46]'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
          
          {/* OHLC Display */}
          {ohlcData && (
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-[#8fa4bb]">O <span className={ohlcData.close >= ohlcData.open ? 'text-[#1fd1c2]' : 'text-[#ff4d6d]'}>{formatPrice(ohlcData.open)}</span></span>
              <span className="text-[#8fa4bb]">H <span className={ohlcData.close >= ohlcData.open ? 'text-[#1fd1c2]' : 'text-[#ff4d6d]'}>{formatPrice(ohlcData.high)}</span></span>
              <span className="text-[#8fa4bb]">L <span className={ohlcData.close >= ohlcData.open ? 'text-[#1fd1c2]' : 'text-[#ff4d6d]'}>{formatPrice(ohlcData.low)}</span></span>
              <span className="text-[#8fa4bb]">C <span className={ohlcData.close >= ohlcData.open ? 'text-[#1fd1c2]' : 'text-[#ff4d6d]'}>{formatPrice(ohlcData.close)}</span></span>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-3">
          {currentPrice && (
            <span className={`text-sm font-medium ${priceChange >= 0 ? 'text-[#1fd1c2]' : 'text-[#ff4d6d]'}`}>
              {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
            </span>
          )}
        </div>
      </div>
      
      {/* Volume label */}
      <div className="px-3 py-1 text-xs text-[#8fa4bb]">
        Volume <span className={ohlcData && ohlcData.close >= ohlcData.open ? 'text-[#1fd1c2]' : 'text-[#ff4d6d]'}>
          {ohlcData?.volume?.toFixed(4) || '0'} SOL
        </span>
      </div>
      
      {/* Chart container */}
      <div className="relative h-[400px]">
        {loading && trades.length === 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#08172A]">
            <AppLoader size={50} text="Loading token..." />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#08172A] text-[#8fa4bb]">
            {error}
          </div>
        )}
        {!loading && trades.length === 0 && !error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#08172A] text-[#8fa4bb]">
            <span className="text-lg">No trades yet</span>
            <span className="text-sm mt-1">Be the first to trade!</span>
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>
    </div>
  );
};
