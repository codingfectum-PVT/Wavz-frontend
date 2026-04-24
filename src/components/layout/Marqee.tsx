'use client';

import React, { useEffect, useState } from 'react';

interface TickerEvent {
  id: string;
  wallet: string;
  action: 'Bought' | 'Sold';
  amount: string;
  token: string;
}

const shortAddress = (addr: string) =>
  addr ? `${addr.slice(0, 4)}..${addr.slice(-4)}` : '----';

export const Marqee = () => {
  const [events, setEvents] = useState<TickerEvent[]>([]);
  const [mounted, setMounted] = useState(false);

  const fetchTrades = async () => {
    try {
      const res = await fetch('https://api.wavz.fun/api/trades');
      const data = await res.json();

      // 🔥 DEBUG (you can remove later)
      // console.log('FIRST TRADE:', data?.trades?.[0]);

      const mapped: TickerEvent[] =
        data?.trades?.map((t: any) => {
          const walletRaw =
            t.userAddress || t.user?.address || '';

          return {
            id: t.signature,

            wallet: shortAddress(walletRaw),

            action: t.isBuy ? 'Bought' : 'Sold',

            // 🔥 lamports → SOL
            amount: (Number(t.solAmount) / 1e9).toFixed(3),

            // 🔥 correct token source
            token: t.token?.symbol || t.token?.name || 'TOKEN',
          };
        }) || [];

      setEvents(mapped.slice(0, 20));
      setMounted(true);
    } catch (err) {
      console.error('Error fetching trades:', err);
    }
  };

  // initial fetch
  useEffect(() => {
    fetchTrades();
  }, []);

  // auto refresh
  useEffect(() => {
    const interval = setInterval(fetchTrades, 5000);
    return () => clearInterval(interval);
  }, []);

  if (!mounted || events.length === 0) {
    return (
      <div style={{ backgroundColor: '#4284FD', height: '60px', width: '100%' }} />
    );
  }

  const list = [...events, ...events];

  return (
    <div
      style={{
        backgroundColor: '#4284FD',
        height: '60px',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        width: '100%',
      }}
    >
      <div
        className="marquee-track"
        style={{
          display: 'flex',
          alignItems: 'center',
          width: 'max-content',
          gap: '8px',
          padding: '0 8px',
        }}
      >
        {list.map((e, i) => (
          <span
            key={`${e.id}-${i}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              borderRadius: '14px',
              padding: '8px 10px',
              whiteSpace: 'nowrap',
              fontSize: '12px',
              backgroundColor: '#255DC3',
              flexShrink: 0,
            }}
          >
            {/* WALLET */}
            <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: '#fff',
              fontWeight: 500,
              fontSize: '15px',
            }}
          >
            <img
              src="/images/duck.png"
              alt="wallet"
              width={16}
              height={16}
              style={{ borderRadius: '50%' }}
            />
            {e.wallet}
          </span>

            {/* ACTION */}
            <span
              style={{
                color: e.action === 'Bought' ? '#4ade80' : '#f87171',
                fontWeight: 600,
              }}
            >
              {e.action}
            </span>

            {/* AMOUNT */}
            <span style={{ color: '#fff' }}>
              {e.amount} SOL
            </span>

            {/* TOKEN */}
            <span style={{ color: '#fff', fontWeight: 600 }}>
              {e.token}
            </span>
          </span>
        ))}
      </div>

      <style>{`
        .marquee-track {
          animation: marquee-scroll 40s linear infinite;
        }
        .marquee-track:hover {
          animation-play-state: paused;
        }
        @keyframes marquee-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
};

export default Marqee;