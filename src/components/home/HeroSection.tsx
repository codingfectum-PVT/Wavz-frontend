'use client';

import { FC } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { motion } from 'framer-motion';

export const HeroSection: FC = () => {
  
  return (
    <div className="relative overflow-hidden rounded-2xl"  style={{ height: '380px' }}>

      {/* VIDEO BACKGROUND — tries mp4, webm, mov in order */}
      {/* DESKTOP VIDEO */}
<video
  autoPlay
  loop
  muted
  playsInline
  className="absolute top-0 left-0 w-full h-[100%] object-cover hidden lg:block"
  style={{ borderRadius: 'inherit' }}
>
  <source src="/images/mainvideo.mp4" type="video/mp4" />
</video>

{/* MOBILE VIDEO */}
<video
  autoPlay
  loop
  muted
  playsInline
  className="absolute inset-0 w-full h-full object-cover block lg:hidden"
  style={{ borderRadius: 'inherit' }}
>
  <source src="/images/mobilevideo.mp4" type="video/mp4" />
</video>

  

      {/* CONTENT — right-aligned */}
     <div className="relative flex items-center h-full px-8 md:px-16 justify-start lg:justify-end" >

        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-sm self-end lg:self-auto mb-3"
        >
         <h1 className="text-3xl md:text-6xl lg:text-6xl font-semibold text-white mb-2 leading-tight text-left">
          Launch Fair.<br />Trade Clean.
        </h1>

        <p className="text-sm md:text-lg lg:text-xl text-gray-200 mb-3 leading-relaxed text-left">
  Fair token launches from the first trade.<br />
  Built for transparent pricing, balanced
  <br className="hidden md:block" /> {/* 🔥 hidden on mobile */}
  distribution, and real participation.
</p>

          <Link
          
            href="/create"
            className="
  inline-flex items-center gap-2 
  px-4 py-2 text-sm        
  md:px-6 md:py-3 md:text-base  
  text-white
"
            style={{ backgroundColor: '#FE9216', borderRadius: '14px',textAlign:'left',fontSize:'18px',boxShadow:'0 6px 4px 0 rgba(255, 255, 255, 0.50) inset, 0 72px 20px 0 rgba(254, 146, 22, 0.00), 0 46px 18px 0 rgba(254, 146, 22, 0.03), 0 26px 16px 0 rgba(254, 146, 22, 0.11), 0 12px 12px 0 rgba(254, 146, 22, 0.19), 0 3px 6px 0 rgba(254, 146, 22, 0.22)' }}
          >
            <Plus className="w-6 h-6" />
            <span>Create Token</span>
          </Link>
        </motion.div>
      </div>

    </div>
  );
};