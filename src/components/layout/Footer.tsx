'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';

export const Footer = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
const navLinks = [
  { name: 'Home', href: '/' },
  { name: 'Pulse', href: '/pulse' },
  { name: 'Gitbook', href: '#' },
  { name: 'Support', href: '/#' },
  { name: 'Terms', href: '/#' },
  { name: 'Privacy', href: '/#' },
];
  return (
    <footer
      style={{
        backgroundColor: '#08172A',
        borderTop: '1px solid #1a3a5c',
        width: '100%',
        padding: isMobile ? '16px 0' : '0',
        height: isMobile ? 'auto' : '56px',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <div
        className="container mx-auto px-4"
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: isMobile ? '16px' : '0',
          width: '100%',
        }}
      >
        {/* LEFT — Logo + Social Icons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Image src="/images/logo.png" alt="Wavz.fun" width={112} height={36} />

          <span style={{ color: '#34557D', fontSize: '18px' }}>|</span>

          {/* Telegram */}
          <Link href="https://t.me/wavzfunportal" aria-label="Telegram" target='blank'>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M21.944 2.506a1.5 1.5 0 0 0-1.53-.21L2.53 9.607a1.5 1.5 0 0 0 .09 2.79l4.38 1.46 1.67 5.01a1.5 1.5 0 0 0 2.54.49l2.4-2.77 4.7 3.45a1.5 1.5 0 0 0 2.34-1.03l2-15a1.5 1.5 0 0 0-.636-1.498zM10 18l-1.2-3.6 8.2-7.4-7 8.4V18z"
                fill="#ffffff"
                opacity="0.85"
              />
            </svg>
          </Link>

          <span style={{ color: '#34557D', fontSize: '18px' }}>|</span>

          {/* X (Twitter) */}
          <Link href="https://x.com/wavzfun?s=21" aria-label="X / Twitter" target='blank'>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L2.25 2.25h6.883l4.259 5.631L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"
                fill="#ffffff"
                opacity="0.85"
              />
            </svg>
          </Link>
        </div>

        {/* RIGHT — Nav Links */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            justifyContent: isMobile ? 'center' : 'flex-end',
            gap: isMobile ? '16px 20px' : '28px',
          }}
        >
       {navLinks.map((item) => (
  <Link
    key={item.name}
    href={item.href}
    target={item.href.startsWith('http') ? '_blank' : '_self'}
    style={{
      color: '#ffffff',
      fontSize: '14px',
      textDecoration: 'none',
      whiteSpace: 'nowrap',
    }}
  >
    {item.name}
  </Link>
))}
        </div>
      </div>
    </footer>
  );
};

export default Footer;