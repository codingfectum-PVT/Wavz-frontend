'use client';

import { FC, useState, useEffect, useRef, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, ColorType, UTCTimestamp, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import { useSocket } from '@/components/providers/SocketProvider';
import { AppLoader } from '../Apploader';

interface PriceChartProps {
  mint: string;
}

interface CandleBar {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface VolumeBar {
  time: UTCTimestamp;
  value: number;
  color: string;
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

export const PriceChart: FC<PriceChartProps> = ({ mint }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('5m');
  const [candles, setCandles] = useState<CandleBar[]>([]);
  const [volumes, setVolumes] = useState<VolumeBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);
  const [chartReady, setChartReady] = useState(false);
  const [ohlcData, setOhlcData] = useState<OHLCData | null>(null);
  // Track whether initial data has been loaded into the chart
  const initialLoadDoneRef = useRef(false);
  // Keep last-fetched dataset ref so WS handler can compute live candle without setState
  const candlesRef = useRef<CandleBar[]>([]);
  const volumesRef = useRef<VolumeBar[]>([]);
  const { socket } = useSocket();

  const getBucketSec = useCallback((range: TimeRange): number => {
    switch (range) {
      case '1m':  return 60;
      case '5m':  return 300;
      case '15m': return 900;
      case '1H':  return 3600;
      case '4H':  return 14400;
      default:    return 60;
    }
  }, []);

  // ── Fetch pre-built OHLC from backend ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const fetchCandles = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/tokens/${mint}/candles?interval=${timeRange}&limit=500`);
        if (!res.ok) throw new Error('Failed to fetch candles');
        const data = await res.json();

        if (cancelled) return;

        const c: CandleBar[] = (data.candles || []).map((d: any) => ({
          time: d.time as UTCTimestamp,
          open: d.open, high: d.high, low: d.low, close: d.close,
        }));
        const v: VolumeBar[] = (data.volumes || []).map((d: any) => ({
          time: d.time as UTCTimestamp,
          value: d.value,
          color: d.color,
        }));

        candlesRef.current = c;
        volumesRef.current = v;
        // Trigger a full setData via state — this effect owns the bulk load
        setCandles(c);
        setVolumes(v);
        initialLoadDoneRef.current = false; // force setData + fitContent on next effect run

        if (c.length > 0) {
          const last = c[c.length - 1];
          setCurrentPrice(last.close);
          if (c.length > 1) {
            const first = c[0];
            setPriceChange(((last.close - first.open) / first.open) * 100);
          }
          setOhlcData({ open: last.open, high: last.high, low: last.low, close: last.close, volume: v[v.length - 1]?.value ?? 0 });
        }
      } catch (err) {
        if (!cancelled) setError('Failed to load chart data');
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchCandles();
    const interval = setInterval(fetchCandles, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [mint, timeRange]);

  // ── Real-time: directly update chart series without going through setState ──
  // Using series.update() avoids full setData + fitContent on every trade.
  useEffect(() => {
    if (!socket) return;
    const bucketSec = getBucketSec(timeRange);

    const handleNewTrade = (trade: any) => {
      if (trade.mint !== mint) return;
      const price: number = trade.price;
      const solAmt: number = Number(trade.solAmount) / 1e9;
      const tsSec = Math.floor(Date.now() / 1000);
      const bucketTime = (Math.floor(tsSec / bucketSec) * bucketSec) as UTCTimestamp;
      const isBuy: boolean = trade.isBuy;

      // ── Update refs for future data merges ──────────────────────────────────
      const prevCandles = candlesRef.current;
      const lastCandle = prevCandles[prevCandles.length - 1];
      let liveCandle: CandleBar;
      if (lastCandle && lastCandle.time === bucketTime) {
        liveCandle = {
          ...lastCandle,
          high:  Math.max(lastCandle.high, price),
          low:   Math.min(lastCandle.low,  price),
          close: price,
        };
        candlesRef.current = [...prevCandles.slice(0, -1), liveCandle];
      } else {
        liveCandle = { time: bucketTime, open: price, high: price, low: price, close: price };
        candlesRef.current = [...prevCandles, liveCandle];
      }

      const prevVolumes = volumesRef.current;
      const lastVol = prevVolumes[prevVolumes.length - 1];
      let liveVol: VolumeBar;
      if (lastVol && lastVol.time === bucketTime) {
        liveVol = { ...lastVol, value: lastVol.value + solAmt };
        volumesRef.current = [...prevVolumes.slice(0, -1), liveVol];
      } else {
        liveVol = { time: bucketTime, value: solAmt, color: isBuy ? 'rgba(38,166,154,0.3)' : 'rgba(239,83,80,0.3)' };
        volumesRef.current = [...prevVolumes, liveVol];
      }

      // ── Push directly to chart series — no setState, no setData, no fitContent ──
      candleSeriesRef.current?.update(liveCandle);
      volumeSeriesRef.current?.update(liveVol);

      // ── Only update UI state for OHLC header display ────────────────────────
      setCurrentPrice(price);
      setOhlcData(prev => {
        if (!prev) return { open: price, high: price, low: price, close: price, volume: liveVol.value };
        return { ...prev, high: Math.max(prev.high, price), low: Math.min(prev.low, price), close: price, volume: liveVol.value };
      });
    };

    socket.on('trade:new', handleNewTrade);
    return () => { socket.off('trade:new', handleNewTrade); };
  }, [socket, mint, timeRange, getBucketSec]);

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
          scaleMargins: { top: 0.08, bottom: 0.05 },
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

  // ── Full reload: only when fetch returns new dataset (interval change or 30s poll) ──
  // WS updates bypass this effect entirely via direct series.update() calls above.
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !chartReady || candles.length === 0) return;
    if (initialLoadDoneRef.current) return; // skip — WS updates handle incremental changes
    candleSeriesRef.current.setData(candles);
    volumeSeriesRef.current.setData(volumes);
    chartRef.current?.timeScale().fitContent();
    initialLoadDoneRef.current = true;
  }, [candles, volumes, chartReady]);

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
        {loading && candles.length === 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#08172A]">
            <AppLoader size={50} text="Loading chart..." />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#08172A] text-[#8fa4bb]">
            {error}
          </div>
        )}
        {!loading && candles.length === 0 && !error && (
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
