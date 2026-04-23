'use client';

export const AppLoader = ({
  size = 40,
  text,
}: {
  size?: number;
  text?: string;
}) => {
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      {/* 🔥 Glow circle */}
      <div
        className="relative flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        {/* spinning ring */}
        <div
          className="absolute inset-0 rounded-full border-2 border-transparent"
          style={{
            borderTopColor: '#528EFC',
            borderRightColor: '#FE9216',
            animation: 'spin 1s linear infinite',
          }}
        />

        {/* center icon */}
        <img
          src="/images/duck.png"
          alt="loading"
          className="w-[60%] h-[60%] object-contain"
        />

        {/* glow */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            boxShadow: '0 0 15px rgba(82,142,252,0.6)',
          }}
        />
      </div>

      {text && (
        <p className="text-sm text-[#8fa4bb] animate-pulse">{text}</p>
      )}

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};