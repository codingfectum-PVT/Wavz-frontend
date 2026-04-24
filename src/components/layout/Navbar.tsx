'use client';
import Image from 'next/image';
import { FC, useState, useEffect } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Plus, Search, Menu, X, User } from 'lucide-react';
import { Token, useTokens } from '@/hooks/useApi';

export const Navbar: FC = () => {
  const { publicKey } = useWallet();
const [results, setResults] = useState<Token[]>([]);
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
const { data } = useTokens({ limit: 100 });
useEffect(() => {
  if (!search.trim()) {
    setResults([]);
    return;
  }

const query = search.trim().toLowerCase();

if (query.length < 1) {
  setResults([]); // 🔥 don't show for 1 char
  return;
}

const filtered =
  data?.tokens?.filter((t: any) => {
    const name = t.name?.toLowerCase() || '';
    const symbol = t.symbol?.toLowerCase() || '';
    const mint = t.mint?.toLowerCase() || '';

    // 🔥 STRICT MATCH
    return (
      name.startsWith(query) ||
      symbol.startsWith(query) ||
      mint.startsWith(query)
    );
  }) || [];

setResults(filtered.slice(0, 6));
}, [search, data]);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1280);
    checkMobile();
    setMounted(true);
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!isMobile) setMenuOpen(false);
  }, [isMobile]);

  if (!mounted) {
    return (
      <nav className="sticky top-0 z-50" style={{ backgroundColor: '#08172A' }}>
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <Image src="/images/logo.png" alt="logo" width={140} height={80} />
          </div>
        </div>
      </nav>
    );
  }

  return (
    <>
      {/* Scoped style to force wallet button full width inside mobile menu only */}
      <style>{`
        .mobile-menu-wallet .wallet-adapter-button {
          width: 100% !important;
          height: 48px !important;
          border-radius: 14px !important;
          justify-content: center !important;
          padding: 0 !important;
          font-size: 15px !important;
          font-weight: 600 !important;
        }
        .mobile-menu-wallet .wallet-adapter-dropdown {
          width: 100% !important;
          display: block !important;
        }
        .mobile-menu-wallet .wallet-adapter-button-trigger {
          width: 100% !important;
        }
      `}</style>

      <nav className="sticky top-0 z-50" style={{ backgroundColor: '#08172A' }}>
        <div className="container mx-auto px-4">

          {/* TOP BAR */}
          <div className="flex items-center justify-between h-16">

            {/* LEFT */}
            <div className="flex items-center gap-6">
             <Link href="/"> <Image src="/images/logo.png" alt="logo" width={140} height={80} /></Link>

              {!isMobile && (
                <div className="flex items-center gap-6">
                  <Link href="/" className="text-white">Home</Link>
                  <Link href="/pulse" className="text-white">Pulse</Link>
                  <Link href="/#" className="text-white">GitBook</Link>
                  {/* <Link href="/#" className="text-white">How it Works</Link> */}
                </div>
              )}
            </div>

            {/* RIGHT DESKTOP */}
            {!isMobile && (
              <div className="flex items-center gap-3">
            <div className="relative w-[360px]">
  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white opacity-60" />

  <input
    type="text"
    placeholder="Search tokens..."
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    className="w-full h-11 pl-10 pr-4 text-sm text-white placeholder-[#ffffff9d] outline-none"
    style={{
      backgroundColor: '#08172A',
      border: '1px solid #34557D',
      borderRadius: '12px',
    }}
  />

  {/* 🔥 DROPDOWN */}
  {results.length > 0 && (
    <div className="absolute top-full mt-2 w-full bg-[#08172A] border border-[#34557D] rounded-xl overflow-hidden z-50 shadow-lg">
      {results.map((token: any) => (
        <Link
          key={token.mint}
          href={`/token/${token.mint}`}
          onClick={() => setSearch('')}
          className="flex items-center gap-3 px-4 py-3 hover:bg-[#0d2138] transition"
        >
          <img
            src={token.image || `https://api.dicebear.com/7.x/shapes/svg?seed=${token.mint}`}
            className="w-8 h-8 rounded-lg object-cover"
          />

          <div>
            <p className="text-white text-sm font-semibold">{token.name}</p>
            <p className="text-xs text-gray-400">${token.symbol}</p>
          </div>
        </Link>
      ))}
    </div>
  )}
</div>

                <Link
                  href="/create"
                  className="flex items-center gap-1 px-6 py-3 text-white"
                  style={{ backgroundColor: '#FE9216', borderRadius: '14px',textAlign:'left',fontSize:'18px',boxShadow: "rgba(255, 255, 255, 0.5) 0px 6px 4px 0px inset,rgba(254, 146, 22, 0.15) 0px 0px 12px 0px" }}
                >
                  <Plus className="w-6 h-6" />
                  <span style={{fontSize:'18px',color:'#fff'}}>Create Token</span>
                </Link>

                   <div className="relative custom-wallet">
    <WalletMultiButton
      className={`${publicKey ? '!px-4' : '!pl-11 !pr-5'} !h-11 !rounded-xl`}
    />

    {!publicKey && (
      <img
        src="/images/wallet.png"
        alt="wallet"
        className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none"
      />
    )}
  </div>

  {/* PROFILE ICON (ONLY WHEN CONNECTED) */}
  {publicKey && (
    <Link
      href={`/profile/${publicKey.toBase58()}`}
      className="flex items-center justify-center w-11 h-11 rounded-xl bg-[#182536] hover:bg-[#24364d] transition"
    >
      <User className="w-5 h-5 text-white" />
    </Link>
  )}
              </div>
            )}

            {/* MOBILE — hamburger only */}
           {isMobile && (
  <div className="flex items-center gap-2">

    {/* 🔍 SEARCH ICON */}
    <button
      className="text-white p-2"
      onClick={() => setMobileSearchOpen(true)}
    >
      <Search size={22} />
    </button>

    {/* ☰ MENU */}
    <button
      className="text-white p-2"
      onClick={() => setMenuOpen(!menuOpen)}
    >
      {menuOpen ? <X size={24} /> : <Menu size={24} />}
    </button>

  </div>
)}
          </div>
          {isMobile && mobileSearchOpen && (
  <div className="fixed inset-0 z-[100] bg-[#08172A] px-4 pt-4">

    {/* TOP BAR */}
    <div className="flex items-center gap-2 mb-4">

      {/* CLOSE */}
      <button
        onClick={() => setMobileSearchOpen(false)}
        className="text-white"
      >
        <X size={24} />
      </button>

      {/* INPUT */}
      <div className="flex items-center flex-1 h-12 px-4 rounded-[15px]"
        style={{
          backgroundColor: '#0d2138',
          border: '1px solid #34557D'
        }}
      >
        <Search className="w-5 h-5 text-white opacity-60 mr-2" />

        <input
          autoFocus
          type="text"
          placeholder="Search tokens..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-transparent outline-none text-sm text-white placeholder-[#ffffff9d]"
        />
      </div>
    </div>

    {/* DROPDOWN RESULTS */}
    {results.length > 0 && (
      <div className="flex flex-col gap-2">
        {results.map((token: any) => (
          <Link
            key={token.mint}
            href={`/token/${token.mint}`}
            onClick={() => {
              setMobileSearchOpen(false);
              setSearch('');
            }}
            className="flex items-center gap-3 p-3 rounded-xl bg-[#0d2138]"
          >
            <img
              src={token.image || `https://api.dicebear.com/7.x/shapes/svg?seed=${token.mint}`}
              className="w-8 h-8 rounded-lg object-cover"
            />

            <div>
              <p className="text-white text-sm font-semibold">{token.name}</p>
              <p className="text-xs text-gray-400">${token.symbol}</p>
            </div>
          </Link>
        ))}
      </div>
    )}
  </div>
)}

          {/* MOBILE MENU */}
          {isMobile && menuOpen && (
            <div
              className="flex flex-col gap-5 pb-6 pt-4"
              style={{ borderTop: '1px solid #34557D44' }}
            >
              <Link onClick={() => setMenuOpen(false)} href="/" className="text-white">Home</Link>
              <Link onClick={() => setMenuOpen(false)} href="/#" className="text-white">GitBook</Link>
              <Link onClick={() => setMenuOpen(false)} href="/#" className="text-white">How it Works</Link>

              

              {/* CREATE — full width */}
              <Link
                onClick={() => setMenuOpen(false)}
                href="/create"
                className="flex items-center justify-center gap-2 w-full py-3 text-white font-semibold mb-2 mt-2"
                style={{backgroundColor: '#FE9216', borderRadius: '14px',textAlign:'left',fontSize:'18px',boxShadow: "rgba(255, 255, 255, 0.5) 0px 6px 4px 0px inset,rgba(254, 146, 22, 0.15) 0px 0px 12px 0px"  }}
              >
                <Plus className="w-5 h-5" />
                <span>Create Token</span>
              </Link>

              {/* WALLET — full width override via .mobile-menu-wallet */}
<div className="custom-wallet mobile-menu-wallet w-full">
    <WalletMultiButton />
  </div>

  {/* PROFILE */}
  {publicKey && (
    <Link
      href={`/profile/${publicKey.toBase58()}`}
      onClick={() => setMenuOpen(false)}
      className="flex items-center justify-center gap-2 w-full py-3 text-white bg-[#182536] rounded-xl"
    >
      <User className="w-5 h-5" />
      <span>Profile</span>
    </Link>
  )}


            </div>
          )}

        </div>
      </nav>
    </>
  );
};