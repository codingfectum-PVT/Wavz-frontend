'use client';

import { FC, useState, useCallback, useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useRouter } from 'next/navigation';
import { Upload, Loader2, AlertCircle, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import Image from 'next/image';
import { useLaunchpadActions } from '@/hooks/useProgram';
import { AppLoader } from '../Apploader';

interface FormData {
  name: string;
  symbol: string;
  description: string;
  image: File | null;
  imagePreview: string;
  banner: File | null;
  bannerPreview: string;
  twitter: string;
  telegram: string;
  website: string;
}

interface AntiSnipeSettings {
  enabled: boolean;
  maxWalletBps: number;
  lockDuration: number;
  batchDuration: number;
  minTrustScore: number;
  requireCivic: boolean;
}

export const CreateTokenForm: FC = () => {
  const { publicKey, connected } = useWallet();
  const router = useRouter();
  const { createToken, buy } = useLaunchpadActions();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nameStatus, setNameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const nameCheckTimeout = useRef<NodeJS.Timeout | null>(null);

  const [formData, setFormData] = useState<FormData>({
    name: '',
    symbol: '',
    description: '',
    image: null,
    imagePreview: '',
    banner: null,
    bannerPreview: '',
    twitter: '',
    telegram: '',
    website: '',
  });

  const [antiSnipe, setAntiSnipe] = useState<AntiSnipeSettings>({
    enabled: true,
    maxWalletBps: 200,
    lockDuration: 300,
    batchDuration: 30,
    minTrustScore: 20,
    requireCivic: false,
  });

  const [initialBuyAmount, setInitialBuyAmount] = useState<string>('');

  const handleImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be less than 5MB');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setFormData((prev) => ({
        ...prev,
        image: file,
        imagePreview: reader.result as string,
      }));
    };
    reader.readAsDataURL(file);
  }, []);

  const handleBannerChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Banner must be less than 5MB');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setFormData((prev) => ({
        ...prev,
        banner: file,
        bannerPreview: reader.result as string,
      }));
    };
    reader.readAsDataURL(file);
  }, []);

  const checkNameAvailability = useCallback(async (name: string) => {
    if (!name || name.trim().length < 2) {
      setNameStatus('idle');
      return;
    }

    setNameStatus('checking');
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

    try {
      const response = await fetch(`${API_URL}/api/tokens/check-name/${encodeURIComponent(name.trim())}`);
      const data = await response.json();
      setNameStatus(data.available ? 'available' : 'taken');
    } catch (error) {
      console.error('Error checking name:', error);
      setNameStatus('idle');
    }
  }, []);

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newName = e.target.value;
      setFormData((prev) => ({ ...prev, name: newName }));

      if (nameCheckTimeout.current) {
        clearTimeout(nameCheckTimeout.current);
      }

      nameCheckTimeout.current = setTimeout(() => {
        checkNameAvailability(newName);
      }, 500);
    },
    [checkNameAvailability]
  );

  useEffect(() => {
    return () => {
      if (nameCheckTimeout.current) {
        clearTimeout(nameCheckTimeout.current);
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!connected || !publicKey) {
      toast.error('Please connect your wallet');
      return;
    }

    if (!formData.name || !formData.symbol) {
      toast.error('Name and symbol are required');
      return;
    }

    if (nameStatus === 'taken') {
      toast.error('Token name is already taken. Please choose a unique name.');
      return;
    }

    if (nameStatus === 'checking') {
      toast.error('Please wait for name validation to complete');
      return;
    }

    if (!formData.image) {
      toast.error('Please upload a token image');
      return;
    }

    setIsSubmitting(true);

    try {
      toast.loading('Uploading metadata...', { id: 'create' });

      const formDataUpload = new FormData();
      formDataUpload.append('image', formData.image);
      if (formData.banner) formDataUpload.append('banner', formData.banner);
      formDataUpload.append('name', formData.name);
      formDataUpload.append('symbol', formData.symbol);
      formDataUpload.append('description', formData.description);
      if (formData.twitter) formDataUpload.append('twitter', formData.twitter);
      if (formData.telegram) formDataUpload.append('telegram', formData.telegram);
      if (formData.website) formDataUpload.append('website', formData.website);

      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const uploadRes = await fetch(`${API_URL}/api/metadata/upload`, {
        method: 'POST',
        body: formDataUpload,
      });

      if (!uploadRes.ok) {
        throw new Error('Failed to upload metadata');
      }

      const { metadataUri, imageUrl, bannerUrl } = await uploadRes.json();

      toast.loading('Creating token on Solana...', { id: 'create' });

      const effectiveAntiSnipe = antiSnipe.enabled
        ? {
            ...antiSnipe,
            batchDuration: initialBuyAmount && parseFloat(initialBuyAmount) > 0 ? 0 : antiSnipe.batchDuration,
          }
        : undefined;

      const result = await createToken(
        formData.name,
        formData.symbol,
        metadataUri,
        30_000_000_000,
        1_000_000_000_000_000,
        effectiveAntiSnipe
      );

      try {
        await fetch(`${API_URL}/api/tokens`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mint: result.mint,
            name: formData.name,
            symbol: formData.symbol,
            uri: metadataUri,
            image: imageUrl,
            banner: bannerUrl || undefined,
            creatorAddress: publicKey?.toBase58(),
            description: formData.description,
            twitter: formData.twitter || undefined,
            telegram: formData.telegram || undefined,
            website: formData.website || undefined,
          }),
        });
      } catch (dbError) {
        console.error('Failed to save to DB:', dbError);
      }

      toast.success('Token created successfully!', { id: 'create' });

      if (initialBuyAmount && parseFloat(initialBuyAmount) > 0 && result?.mint) {
        try {
          toast.loading('Buying initial tokens...', { id: 'initial-buy' });
          const buyAmountLamports = parseFloat(initialBuyAmount) * 1e9;
          await buy(result.mint, buyAmountLamports, 500);
          toast.success('Initial tokens purchased!', { id: 'initial-buy' });
        } catch (buyError) {
          console.error('Initial buy failed:', buyError);
          toast.error('Token created but initial buy failed', { id: 'initial-buy' });
        }
      }

      router.push(`/token/${result.mint}`);
    } catch (error: unknown) {
      console.error('Error creating token:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to create token';

      if (errorMessage.includes('already been processed') || errorMessage.includes('AlreadyProcessed')) {
        toast.success('Token created successfully!', { id: 'create' });
        return;
      }

      toast.error(errorMessage, { id: 'create' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const sectionClass = 'rounded-2xl border border-[#1d324d] bg-[#08172A] p-5 md:p-6';
  const inputClass =
    'w-full rounded-xl border border-[#223a56] bg-[#081a30] px-4 py-3 text-white placeholder:text-[#7f93aa] focus:outline-none focus:border-[#2d4f76]';

  return (
    <form onSubmit={handleSubmit} className="space-y-6 text-white">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className={sectionClass}>
          <div className="flex flex-col gap-4 sm:flex-row">
            <label className="relative block cursor-pointer">
              <div
                className={`relative flex h-44 w-44 items-center justify-center rounded-2xl border-2 border-dashed bg-[#182536] transition-colors ${
                  formData.imagePreview ? 'border-[#FE9216]' : 'border-[#2a3e58] hover:border-[#39577a]'
                }`}
              >
                {formData.imagePreview ? (
                  <Image src={formData.imagePreview} alt="Token preview" fill className="rounded-2xl object-cover" />
                ) : (
                  <div className="text-center">
                    <Upload className="mx-auto mb-2 h-8 w-8 text-[#9fb0c2]" />
                    <p className="text-sm text-[#9fb0c2]">Click to Upload</p>
                  </div>
                )}
              </div>
              <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
            </label>
            <div>
              <h3 className="text-[21px] font-semibold leading-none">
                Token Image <span className="text-[#ff8a65]">*</span>
              </h3>
              <ul className="mt-3 space-y-1 text-sm text-[#94a9bf]">
                <li>1:1 aspect ratio (square)</li>
                <li>Min width: 100px</li>
                <li>Formats: png, jpg, webp, gif</li>
                <li>Max size: 5MB</li>
              </ul>
            </div>
          </div>
        </div>

        <div className={sectionClass}>
          <div className="flex flex-col gap-4 sm:flex-row">
            <label className="relative block w-full cursor-pointer">
              <div
                className={`relative flex h-44 w-full items-center justify-center rounded-2xl border-2 border-dashed bg-[#182536] transition-colors ${
                  formData.bannerPreview ? 'border-[#FE9216]' : 'border-[#2a3e58] hover:border-[#39577a]'
                }`}
              >
                {formData.bannerPreview ? (
                  <Image src={formData.bannerPreview} alt="Banner preview" fill className="rounded-2xl object-cover" />
                ) : (
                  <div className="text-center">
                    <Upload className="mx-auto mb-2 h-8 w-8 text-[#9fb0c2]" />
                    <p className="text-sm text-[#9fb0c2]">Click to Upload</p>
                  </div>
                )}
              </div>
              <input type="file" accept="image/*" onChange={handleBannerChange} className="hidden" />
            </label>
            <div className="min-w-[220px]">
              <h3 className="text-[21px] font-semibold leading-none">
                Token Banner <span className="text-[15px] text-[#9fb0c2]">(Optional)</span>
              </h3>
              <ul className="mt-3 space-y-1 text-sm text-[#94a9bf]">
                <li>3:1 aspect ratio (rectangle)</li>
                <li>Min width: 600px</li>
                <li>Formats: png, jpg, webp, gif</li>
                <li>Max size: 5MB</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className={sectionClass}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-[21px] font-semibold">
              Token Name <span className="text-[#ff8a65]">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={formData.name}
                onChange={handleNameChange}
                placeholder="Name your token"
                maxLength={32}
                className={`${inputClass} pr-10 ${
                  nameStatus === 'taken'
                    ? 'border-red-500 focus:border-red-500'
                    : nameStatus === 'available'
                      ? 'border-green-500 focus:border-green-500'
                      : ''
                }`}
                required
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {nameStatus === 'checking' && <AppLoader size={50}  />}
                {nameStatus === 'available' && <Check className="h-5 w-5 text-green-500" />}
                {nameStatus === 'taken' && <X className="h-5 w-5 text-red-500" />}
              </div>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <p className="text-xs text-[#7f93aa]">{formData.name.length}/32</p>
              {nameStatus === 'taken' && <p className="text-xs text-red-500">This name is already taken</p>}
              {nameStatus === 'available' && <p className="text-xs text-green-500">Name is available</p>}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-[21px] font-semibold">
              Token Ticker <span className="text-[#ff8a65]">*</span>
            </label>
            <input
              type="text"
              value={formData.symbol}
              onChange={(e) => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
              placeholder="Add a token ticker (e.g. PEPE)"
              maxLength={10}
              className={inputClass}
              required
            />
            <p className="mt-1 text-xs text-[#7f93aa]">{formData.symbol.length}/10</p>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-2 block text-[21px] font-semibold">
            Description <span className="text-[15px] text-[#9fb0c2]">(Optional)</span>
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Write a short description of your token"
            rows={5}
            maxLength={500}
            className={`${inputClass} resize-none`}
          />
          <p className="mt-1 text-xs text-[#7f93aa]">{formData.description.length}/500</p>
        </div>
      </div>

      <div className={sectionClass}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-[21px] font-semibold">
              Website <span className="text-[15px] text-[#9fb0c2]">(Optional)</span>
            </label>
            <input
              type="url"
              value={formData.website}
              onChange={(e) => setFormData({ ...formData, website: e.target.value })}
              placeholder="https://your.site"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-2 block text-[21px] font-semibold">
              X <span className="text-[15px] text-[#9fb0c2]">(Optional)</span>
            </label>
            <input
              type="url"
              value={formData.twitter}
              onChange={(e) => setFormData({ ...formData, twitter: e.target.value })}
              placeholder="https://x.com/username"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-2 block text-[21px] font-semibold">
              Telegram <span className="text-[15px] text-[#9fb0c2]">(Optional)</span>
            </label>
            <input
              type="url"
              value={formData.telegram}
              onChange={(e) => setFormData({ ...formData, telegram: e.target.value })}
              placeholder="https://t.me/username"
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div className={sectionClass}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Fair Launch Protection</h3>
            <p className="text-xs text-[#8ca2b9]">Prevent bots and snipers</p>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={antiSnipe.enabled}
              onChange={(e) => setAntiSnipe({ ...antiSnipe, enabled: e.target.checked })}
              className="peer sr-only"
            />
            <div className="peer h-6 w-11 rounded-full bg-[#27405c] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#FE9216] peer-checked:after:translate-x-full peer-checked:after:border-white" />
          </label>
        </div>

        {antiSnipe.enabled && (
          <div className="space-y-4 border-t border-[#27405c] pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">30s Batch Auction</p>
                <p className="text-xs text-[#8ca2b9]">Eliminates MEV/front-running</p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={antiSnipe.batchDuration > 0}
                  onChange={(e) => setAntiSnipe({ ...antiSnipe, batchDuration: e.target.checked ? 30 : 0 })}
                  className="peer sr-only"
                />
                <div className="peer h-5 w-9 rounded-full bg-[#27405c] after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#FE9216] peer-checked:after:translate-x-full" />
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">2% Wallet Cap</p>
                <p className="text-xs text-[#8ca2b9]">Max holdings per wallet</p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={antiSnipe.maxWalletBps > 0}
                  onChange={(e) => setAntiSnipe({ ...antiSnipe, maxWalletBps: e.target.checked ? 200 : 0 })}
                  className="peer sr-only"
                />
                <div className="peer h-5 w-9 rounded-full bg-[#27405c] after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#FE9216] peer-checked:after:translate-x-full" />
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">5min Time Lock</p>
                <p className="text-xs text-[#8ca2b9]">Tokens locked after purchase</p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={antiSnipe.lockDuration > 0}
                  onChange={(e) => setAntiSnipe({ ...antiSnipe, lockDuration: e.target.checked ? 300 : 0 })}
                  className="peer sr-only"
                />
                <div className="peer h-5 w-9 rounded-full bg-[#27405c] after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#FE9216] peer-checked:after:translate-x-full" />
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">Min Trust Score: {antiSnipe.minTrustScore}</p>
                <p className="text-xs text-[#8ca2b9]">Require wallet reputation</p>
              </div>
              <input
                type="range"
                min="0"
                max="50"
                value={antiSnipe.minTrustScore}
                onChange={(e) => setAntiSnipe({ ...antiSnipe, minTrustScore: parseInt(e.target.value, 10) })}
                className="h-2 w-20 cursor-pointer appearance-none rounded-lg bg-[#27405c] accent-[#FE9216]"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">Civic Verification</p>
                <p className="text-xs text-[#8ca2b9]">Require proof of human</p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={antiSnipe.requireCivic}
                  onChange={(e) => setAntiSnipe({ ...antiSnipe, requireCivic: e.target.checked })}
                  className="peer sr-only"
                />
                <div className="peer h-5 w-9 rounded-full bg-[#27405c] after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#FE9216] peer-checked:after:translate-x-full" />
              </label>
            </div>
          </div>
        )}
      </div>

      <div className={sectionClass}>
        <div className="mb-4">
          <h3 className="text-sm font-medium">Initial Purchase (Optional)</h3>
          <p className="text-xs text-[#8ca2b9]">Buy tokens at creation to protect from snipers</p>
        </div>

        <div className="relative">
          <input
            type="number"
            step="0.01"
            min="0"
            value={initialBuyAmount}
            onChange={(e) => setInitialBuyAmount(e.target.value)}
            placeholder="0"
            className={`${inputClass} pr-16`}
          />
          <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center space-x-2">
            <span className="text-sm text-[#9fb0c2]">SOL</span>
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-r from-[#FE9216] to-[#ffb14d]">
              <span className="text-xs font-bold text-white">S</span>
            </div>
          </div>
        </div>

        {initialBuyAmount && parseFloat(initialBuyAmount) > 0 && (
          <div className="mt-3 rounded-lg bg-[#FE9216]/10 p-3">
            <p className="text-xs text-[#ffbf69]">
              You will buy tokens worth {initialBuyAmount} SOL immediately after creation. As the creator, you are exempt from
              the 2% wallet cap during the first 5 minutes.
            </p>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[#2c4058] bg-[#08172A] p-4">
        <div className="flex items-start space-x-3 text-sm">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#FE9216]" />
          <div>
            <p className="mb-1 font-medium text-[#FE9216]">How it works</p>
            <ul className="space-y-1 text-[#a0b2c5]">
              <li className="flex items-center space-x-2">
                <Check className="h-4 w-4 text-[#FE9216]" />
                <span>1 billion tokens created with fair bonding curve</span>
              </li>
              <li className="flex items-center space-x-2">
                <Check className="h-4 w-4 text-[#FE9216]" />
                <span>No presale, no team allocation</span>
              </li>
              <li className="flex items-center space-x-2">
                <Check className="h-4 w-4 text-[#FE9216]" />
                <span>Graduates to Meteora at ~$69K market cap</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={isSubmitting || !connected}
        className="flex w-full items-center justify-center space-x-2 rounded-2xl  py-3 text-lg font-semibold text-white transition-colors hover:bg-[#e68312] disabled:cursor-not-allowed disabled:opacity-50"
                          style={{ backgroundColor: '#FE9216', borderRadius: '14px',textAlign:'left',fontSize:'18px',boxShadow: "rgba(255, 255, 255, 0.5) 0px 6px 4px 0px inset,rgba(254, 146, 22, 0.15) 0px 0px 12px 0px"  }}
      >
        {isSubmitting ? (
          <>
            <AppLoader size={50}/>
            <span>Creating Token...</span>
          </>
        ) : (
          <span>{connected ? 'Create Token' : 'Connect Wallet to Create'}</span>
        )}
      </button>
    </form>
  );
};
