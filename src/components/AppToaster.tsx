'use client';

import { Toaster } from 'react-hot-toast';
import toast from 'react-hot-toast';

export const AppToaster = () => {
  return (
    <Toaster position="bottom-right">
      {(t) => (
        <div
          className={`
            flex items-center gap-3 px-4 py-3 rounded-[16px]
            transition-all duration-300 backdrop-blur-md
            ${t.visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-3 scale-95'}
          `}
          style={{
            background: 'linear-gradient(135deg, #0d2138, #08172A)',
            border: '1px solid rgba(82,142,252,0.4)',
            boxShadow:
              '0 0 12px rgba(82,142,252,0.25), inset 0 2px 6px rgba(255,255,255,0.15)',
            minWidth: '280px',
          }}
        >
          {/* 🔥 LEFT ACCENT BAR */}
          <div
            style={{
              width: '4px',
              height: '100%',
              borderRadius: '4px',
              background:
                t.type === 'error'
                  ? '#ef4444'
                  : t.type === 'success'
                  ? '#22c55e'
                  : '#528EFC',
            }}
          />

          {/* 🦆 Duck */}
          <div className="relative">
            <img
              src="/images/duck.png"
              alt="duck"
              className="w-8 h-8 rounded-xl object-cover"
            />

            {/* glow ring */}
            <div
              className="absolute inset-0 rounded-xl"
              style={{
                boxShadow: '0 0 10px rgba(82,142,252,0.6)',
              }}
            />
          </div>

          {/* TEXT */}
          <div className="flex-1">
            <p className="text-white text-sm font-semibold leading-tight">
              {t.message}
            </p>

            <p className="text-[11px] text-gray-400">
              Just now
            </p>
          </div>

          {/* ❌ CLOSE */}
          <button
            onClick={() => toast.dismiss(t.id)}
            className="text-gray-400 hover:text-white transition text-sm"
          >
            ✕
          </button>
        </div>
      )}
    </Toaster>
  );
};