'use client';

import { FC, useState, useMemo, useEffect, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Loader2 } from 'lucide-react';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, getAccount } from '@solana/spl-token';
import toast from 'react-hot-toast';
import { formatNumber, formatPrice } from '@/lib/utils';
import { useLaunchpadActions, useProgramAccounts } from '@/hooks/useProgram';
import { useMeteorSwap } from '@/hooks/useMeteorSwap';
import { AppLoader } from '../Apploader';

interface Token {
  mint: string;
  name: string;
  symbol: string;
  price: number;
  virtualSolReserves: number;
  virtualTokenReserves: number;
  graduated: boolean;
  meteoraPool?: string;
  createdAt?: string; // ISO string — used for 5-min anti-snipe window
}

interface TradePanelProps {
  token: Token;
  onTradeSuccess?: (update: { isBuy: boolean; solAmount: number; tokenAmount: number }) => void;
}

type TradeMode = 'buy' | 'sell';

export const TradePanel: FC<TradePanelProps> = ({ token, onTradeSuccess }) => {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const { buy, sell } = useLaunchpadActions();
  const accounts = useProgramAccounts();
  const { buyOnMeteora, sellOnMeteora, getQuote, getPoolInfo } = useMeteorSwap();
  
  const [mode, setMode] = useState<TradeMode>('buy');
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [slippage, setSlippage] = useState(1); // 1%
  const [userSolBalance, setUserSolBalance] = useState(0);
  const [userTokenBalance, setUserTokenBalance] = useState(0);
  const [meteoraQuote, setMeteoraQuote] = useState<{ outAmount: number; fee: number } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [poolLiquidity, setPoolLiquidity] = useState<{ totalSol: number; totalTokens: number } | null>(null);
  const [poolRefreshKey, setPoolRefreshKey] = useState(0);
  // Live on-chain reserves for accurate preview
  const [liveReserves, setLiveReserves] = useState<{ virtualSolReserves: number; virtualTokenReserves: number } | null>(null);
  const reserveFetchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check if trading on Meteora
  const isMeteoraTrading = token.graduated && !!token.meteoraPool;

  // Fetch pool liquidity info
  useEffect(() => {
    const fetchPoolInfo = async () => {
      if (!isMeteoraTrading || !token.meteoraPool) {
        setPoolLiquidity(null);
        return;
      }
      try {
        const info = await getPoolInfo(token.meteoraPool);
        setPoolLiquidity({ totalSol: info.totalSol, totalTokens: info.totalTokens });
      } catch (err) {
        console.error('Error fetching pool info:', err);
      }
    };
    fetchPoolInfo();
  }, [isMeteoraTrading, token.meteoraPool, getPoolInfo, poolRefreshKey]);

  // Fetch live on-chain bonding curve reserves for accurate "You Receive" preview
  useEffect(() => {
    if (isMeteoraTrading) return; // Meteora uses its own quote

    if (reserveFetchRef.current) clearTimeout(reserveFetchRef.current);
    reserveFetchRef.current = setTimeout(async () => {
      try {
        const mintPubkey = new PublicKey(token.mint);
        const [bondingCurvePda] = accounts.getBondingCurvePda(mintPubkey);
        const accountInfo = await connection.getAccountInfo(bondingCurvePda);
        if (!accountInfo) return;
        // BondingCurve layout: [8 discriminator][32 mint][32 creator][8 virtualSolReserves][8 virtualTokenReserves]...
        const data = accountInfo.data;
        const virtualSol = Number(data.readBigUInt64LE(72));  // 8 + 32 + 32
        const virtualToken = Number(data.readBigUInt64LE(80)); // 72 + 8
        if (virtualSol > 0 && virtualToken > 0) {
          setLiveReserves({ virtualSolReserves: virtualSol, virtualTokenReserves: virtualToken });
        }
      } catch {
        // fallback to cached token reserves silently
      }
    }, 300);
  }, [amount, token.mint, isMeteoraTrading, connection, accounts]);

  // Fetch real balances
  useEffect(() => {
    const fetchBalances = async () => {
      if (!publicKey || !connected) return;
      
      try {
        // Get SOL balance
        const solBalance = await connection.getBalance(publicKey);
        setUserSolBalance(solBalance / LAMPORTS_PER_SOL);
        
        // Get token balance
        try {
          const mintPubkey = new PublicKey(token.mint);
          const ata = getAssociatedTokenAddressSync(mintPubkey, publicKey);
          const tokenAccount = await getAccount(connection, ata);
          setUserTokenBalance(Number(tokenAccount.amount) / 1e6); // 6 decimals
        } catch {
          setUserTokenBalance(0);
        }
      } catch (err) {
        console.error('Error fetching balances:', err);
      }
    };

    fetchBalances();
    const interval = setInterval(fetchBalances, 5000);
    return () => clearInterval(interval);
  }, [publicKey, connected, connection, token.mint]);

  // Fetch Meteora quote when trading on graduated token
  useEffect(() => {
    const fetchMeteoraQuote = async () => {
      if (!isMeteoraTrading || !token.meteoraPool) {
        setMeteoraQuote(null);
        setQuoteError(null);
        return;
      }

      const inputAmount = parseFloat(amount) || 0;
      if (inputAmount <= 0) {
        setMeteoraQuote(null);
        setQuoteError(null);
        return;
      }

      try {
        const amountInSmallestUnit = mode === 'buy' 
          ? Math.floor(inputAmount * LAMPORTS_PER_SOL) // SOL to lamports
          : Math.floor(inputAmount * 1e6); // Token amount

        const quote = await getQuote(token.meteoraPool, amountInSmallestUnit, mode === 'buy');
        setMeteoraQuote({
          outAmount: quote.outAmount,
          fee: quote.fee,
        });
        setQuoteError(null);
      } catch (err: any) {
        console.error('Error fetching Meteora quote:', err);
        setMeteoraQuote(null);
        if (err.message?.includes('Insufficient liquidity')) {
          // Calculate max recommended based on pool liquidity (10% of pool for low impact)
          const maxRecommended = poolLiquidity 
            ? mode === 'buy' 
              ? Math.floor(poolLiquidity.totalSol * 0.1 * 100) / 100
              : Math.floor(poolLiquidity.totalTokens * 0.1)
            : null;
          const maxStr = maxRecommended 
            ? ` Max recommended: ${maxRecommended} ${mode === 'buy' ? 'SOL' : token.symbol}`
            : '';
          setQuoteError(`Insufficient liquidity. Try a smaller amount.${maxStr}`);
        } else {
          setQuoteError('Could not get quote. Try a smaller amount.');
        }
      }
    };

    const debounce = setTimeout(fetchMeteoraQuote, 300);
    return () => clearTimeout(debounce);
  }, [amount, mode, isMeteoraTrading, token.meteoraPool, token.symbol, getQuote, poolLiquidity]);

  // Platform fee (1% = 100 bps) - only for bonding curve
  const PLATFORM_FEE_BPS = 100;

  // Calculate output based on bonding curve OR Meteora
  const outputAmount = useMemo(() => {
    const inputAmount = parseFloat(amount) || 0;
    if (inputAmount <= 0) return 0;

    // Use Meteora quote if trading on graduated token
    if (isMeteoraTrading && meteoraQuote) {
      return mode === 'buy' 
        ? meteoraQuote.outAmount / 1e6  // Token decimals
        : meteoraQuote.outAmount / LAMPORTS_PER_SOL; // SOL
    }

    // Bonding curve calculation
    if (mode === 'buy') {
      // Calculate tokens out for SOL input (after fee deduction)
      // dy = y * dx / (x + dx)  — use live on-chain reserves if available
      const vSol = liveReserves?.virtualSolReserves ?? token.virtualSolReserves;
      const vToken = liveReserves?.virtualTokenReserves ?? token.virtualTokenReserves;
      const dx = inputAmount * 1e9; // Convert SOL to lamports
      const fee = (dx * PLATFORM_FEE_BPS) / 10000;
      const dxAfterFee = dx - fee;
      const tokens = (vToken * dxAfterFee) / 
        (vSol + dxAfterFee);
      return tokens / 1e6; // Convert to token decimals
    } else {
      // Calculate SOL out for token input (fee deducted from output)
      // dx = x * dy / (y + dy)  — use live on-chain reserves if available
      const vSol = liveReserves?.virtualSolReserves ?? token.virtualSolReserves;
      const vToken = liveReserves?.virtualTokenReserves ?? token.virtualTokenReserves;
      const dy = inputAmount * 1e6; // Convert to token decimals
      const solBeforeFee = (vSol * dy) / 
        (vToken + dy);
      const fee = (solBeforeFee * PLATFORM_FEE_BPS) / 10000;
      return (solBeforeFee - fee) / 1e9; // Convert lamports to SOL
    }
  }, [amount, mode, token, isMeteoraTrading, meteoraQuote, liveReserves]);

  // Price impact calculation
  const priceImpact = useMemo(() => {
    const inputAmount = parseFloat(amount) || 0;
    if (inputAmount <= 0 || outputAmount <= 0) return 0;

    const vSol = liveReserves?.virtualSolReserves ?? token.virtualSolReserves;
    const vToken = liveReserves?.virtualTokenReserves ?? token.virtualTokenReserves;
    const currentPrice = vSol / vToken;
    const newPrice = mode === 'buy'
      ? (vSol + inputAmount * 1e9) / 
        (vToken - outputAmount * 1e6)
      : (vSol - outputAmount * 1e9) / 
        (vToken + inputAmount * 1e6);
    
    return Math.abs((newPrice - currentPrice) / currentPrice) * 100;
  }, [amount, outputAmount, mode, token]);

  const handleTrade = async () => {
    // Prevent double-clicks
    if (isSubmitting) return;
    
    if (!connected || !publicKey) {
      toast.error('Please connect your wallet');
      return;
    }

    const inputAmount = parseFloat(amount);
    if (!inputAmount || inputAmount <= 0) {
      toast.error('Please enter an amount');
      return;
    }

    if (mode === 'buy' && inputAmount > userSolBalance) {
      toast.error('Insufficient SOL balance');
      return;
    }

    if (mode === 'sell' && inputAmount > userTokenBalance) {
      toast.error('Insufficient token balance');
      return;
    }

    // Pre-flight: enforce 2% max wallet limit BEFORE sending any transaction
    // on-chain: INITIAL_SUPPLY(1B * 1e6) * 200bps / 10000 = 20M tokens
    // Only active for the first 5 minutes after token creation (mirrors on-chain anti-snipe)
    const ANTI_SNIPE_MS = 5 * 60 * 1000; // 5 minutes
    const MAX_WALLET_TOKENS = 20_000_000;
    const tokenAgeMs = token.createdAt ? Date.now() - new Date(token.createdAt).getTime() : 0;
    const isAntiSnipeActive = token.createdAt ? tokenAgeMs < ANTI_SNIPE_MS : false;

    if (mode === 'buy' && !isMeteoraTrading && isAntiSnipeActive) {
      const projectedBalance = userTokenBalance + outputAmount;
      if (projectedBalance > MAX_WALLET_TOKENS) {
        const remaining = Math.max(0, MAX_WALLET_TOKENS - userTokenBalance);
        const minsLeft = Math.ceil((ANTI_SNIPE_MS - tokenAgeMs) / 60000);
        toast.error(
          `Max wallet limit exceeded. Each wallet can hold at most 2% (20M tokens) during the first 5 minutes. You can buy up to ${formatNumber(remaining)} more tokens, or wait ${minsLeft} min for the limit to lift.`,
          { id: 'trade', duration: 6000 }
        );
        return;
      }
    }

    setIsSubmitting(true);

    const maxRetries = 3;
    let attempt = 0;
    let lastError: any = null;

    while (attempt < maxRetries) {
      attempt++;
      
      try {
        const tradingVenue = isMeteoraTrading ? 'Meteora' : 'bonding curve';
        toast.loading(
          `${mode === 'buy' ? 'Buying' : 'Selling'} on ${tradingVenue}...${attempt > 1 ? ` (attempt ${attempt}/${maxRetries})` : ''}`, 
          { id: 'trade' }
        );

        const slippageBps = slippage * 100; // Convert percentage to basis points
        let signature: string | undefined;
        
        if (isMeteoraTrading && token.meteoraPool) {
          // Trade on Meteora
          if (mode === 'buy') {
            const solAmountLamports = Math.floor(inputAmount * LAMPORTS_PER_SOL);
            signature = await buyOnMeteora(token.meteoraPool, token.mint, solAmountLamports, slippageBps);
          } else {
            const tokenAmountWithDecimals = Math.floor(inputAmount * 1e6);
            signature = await sellOnMeteora(token.meteoraPool, token.mint, tokenAmountWithDecimals, slippageBps);
          }
          
          // Record Meteora trade to backend for chart/history (AWAIT to ensure real-time update)
          if (signature && publicKey) {
            const solAmountLamports = mode === 'buy' 
              ? Math.floor(inputAmount * LAMPORTS_PER_SOL)
              : Math.floor(outputAmount * LAMPORTS_PER_SOL);
            const tokenAmountRaw = mode === 'buy'
              ? Math.floor(outputAmount * 1e6)
              : Math.floor(inputAmount * 1e6);

            // Guard: skip if amounts are invalid (e.g. quote not loaded yet → prevents Infinity price)
            if (tokenAmountRaw > 0 && solAmountLamports > 0) {
              const price = mode === 'buy'
                ? (inputAmount * LAMPORTS_PER_SOL) / (outputAmount * 1e6)
                : (outputAmount * LAMPORTS_PER_SOL) / (inputAmount * 1e6);
              
              try {
                // Wait for backend to record trade and emit WebSocket event
                const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/trades/meteora`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    signature,
                    mint: token.mint,
                    userAddress: publicKey.toBase58(),
                    isBuy: mode === 'buy',
                    solAmount: solAmountLamports.toString(),
                    tokenAmount: tokenAmountRaw.toString(),
                    price,
                  }),
                });
                
                if (!res.ok) {
                  console.error('Failed to record trade:', await res.text());
                } else {
                  console.log('✅ Meteora trade recorded successfully');
                }
              } catch (err) {
                console.error('Failed to record Meteora trade:', err);
              }
            } // end guard tokenAmountRaw > 0
          } // end if (signature && publicKey)
        } else {
          // Trade on bonding curve
          let bondingSig: string | undefined;
          if (mode === 'buy') {
            const solAmountLamports = Math.floor(inputAmount * LAMPORTS_PER_SOL);
            bondingSig = await buy(token.mint, solAmountLamports, slippageBps);
          } else {
            const tokenAmountWithDecimals = Math.floor(inputAmount * 1e6);
            bondingSig = await sell(token.mint, tokenAmountWithDecimals, slippageBps);
          }

          // Report bonding curve trade to backend (indexer fallback)
          if (bondingSig && publicKey) {
            const solLamports = mode === 'buy'
              ? Math.floor(inputAmount * LAMPORTS_PER_SOL)
              : Math.floor(outputAmount * LAMPORTS_PER_SOL);
            const tokenRaw = mode === 'buy'
              ? Math.floor(outputAmount * 1e6)
              : Math.floor(inputAmount * 1e6);

            // Guard: skip if amounts are invalid (prevents Infinity/NaN price)
            if (tokenRaw > 0 && solLamports > 0) {
              const tradePrice = mode === 'buy'
                ? (Math.floor(inputAmount * LAMPORTS_PER_SOL)) / tokenRaw / 1e3
                : (Math.floor(outputAmount * LAMPORTS_PER_SOL)) / tokenRaw / 1e3;

              fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/trades/bonding`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  signature: bondingSig,
                  mint: token.mint,
                  userAddress: publicKey.toBase58(),
                  isBuy: mode === 'buy',
                  solAmount: solLamports.toString(),
                  tokenAmount: tokenRaw.toString(),
                  price: tradePrice,
                }),
              }).catch(err => console.error('Failed to report bonding trade:', err));
            }
          } // end if (bondingSig && publicKey)
        }

        toast.success(
          `${mode === 'buy' ? 'Bought' : 'Sold'} ${formatNumber(outputAmount)} ${
            mode === 'buy' ? token.symbol : 'SOL'
          }${isMeteoraTrading ? ' on Meteora' : ''}`,
          { id: 'trade' }
        );

        // Refresh pool liquidity after Meteora trade
        if (isMeteoraTrading) {
          setPoolRefreshKey(k => k + 1);
        }

        // Optimistic update for bonding curve trades
        if (!isMeteoraTrading && onTradeSuccess) {
          const solLamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);
          const tokenRaw = Math.floor(outputAmount * 1e6);
          onTradeSuccess({
            isBuy: mode === 'buy',
            solAmount: mode === 'buy' ? solLamports : Math.floor(outputAmount * LAMPORTS_PER_SOL),
            tokenAmount: mode === 'buy' ? tokenRaw : Math.floor(parseFloat(amount) * 1e6),
          });
        }

        setAmount('');
        setIsSubmitting(false);
        return; // Success - exit loop
        
      } catch (error: any) {
        lastError = error;
        console.error(`Trade error (attempt ${attempt}):`, error);
        console.error('Error message:', error?.message);
        
        // Handle "already processed" as success
        if (error?.message?.includes('already been processed') || 
            error?.message?.includes('AlreadyProcessed')) {
          toast.success(
            `${mode === 'buy' ? 'Bought' : 'Sold'} ${formatNumber(outputAmount)} ${
              mode === 'buy' ? token.symbol : 'SOL'
            }`,
            { id: 'trade' }
          );
          if (isMeteoraTrading) setPoolRefreshKey(k => k + 1);
          setAmount('');
          setIsSubmitting(false);
          return;
        }
        
        // Handle timeout errors - retry automatically
        if (error?.message?.includes('Transaction was not confirmed') || 
            error?.message?.includes('TransactionExpiredTimeoutError') ||
            error?.message?.includes('timeout') ||
            error?.message?.includes('blockhash')) {
          
          if (attempt < maxRetries) {
            toast.loading(`Transaction timed out. Retrying... (${attempt + 1}/${maxRetries})`, { id: 'trade' });
            await new Promise(r => setTimeout(r, 2000)); // Wait 2s before retry
            continue; // Retry
          }
        }
        
        // Non-retryable error or max retries reached
        break;
      }
    }
    
    // All retries failed
    const errorMsg = lastError?.message || 'Transaction failed';
    if (errorMsg.includes('timeout') || errorMsg.includes('not confirmed')) {
      toast.error(
        'Transaction timed out after multiple attempts. Please try again or use smaller amounts.',
        { id: 'trade', duration: 5000 }
      );
    } else {
      toast.error(errorMsg.substring(0, 100), { id: 'trade' });
    }
    setIsSubmitting(false);
  };

  const handleMaxClick = () => {
    if (mode === 'buy') {
      // Leave some SOL for fees
      setAmount(Math.max(0, userSolBalance - 0.01).toFixed(4));
    } else {
      setAmount(userTokenBalance.toString());
    }
  };

  const quickBuyAmounts = [0.1, 0.5, 1, 2];
  const quickSellPercents = [25, 50, 75, 100];

  return (
    <div className="rounded-2xl  bg-[#08172A] p-4">
      {/* Mode Toggle */}
      <div className="mb-4 flex rounded-xl bg-[#15263d] p-1">
        <button
          onClick={() => setMode('buy')}
          className={`flex-1 py-2 rounded-md font-medium transition-colors ${
            mode === 'buy'
              ? 'bg-[#45ef56] text-[#08172A]'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setMode('sell')}
          className={`flex-1 py-2 rounded-md font-medium transition-colors ${
            mode === 'sell'
              ? 'bg-[#ef4444] text-white'
              : 'text-[#90a6bd] hover:text-white'
          }`}
        >
          Sell
        </button>
      </div>

      {/* Input */}
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-[#90a6bd]">Quantity</label>
            <span className="text-sm text-[#8fa2b8]">
              Balance: {mode === 'buy' 
                ? userSolBalance.toFixed(0)
                : formatNumber(userTokenBalance)
              }
            </span>
          </div>
          <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => {
              const value = e.target.value;
              if (value.startsWith('-')) return;
              setAmount(value);
            }}
            onKeyDown={(e) => {
              if (e.key === '-' || e.key === 'e') {
                e.preventDefault();
              }
            }}
            placeholder="1"
            className="w-full rounded-xl border border-[#2d4867] bg-[#14263d] px-4 py-3 pr-28 text-xl font-semibold text-white placeholder:text-[#89a0b8] focus:outline-none"
            disabled={isSubmitting}
          />
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <div className="rounded-xl bg-[#061427] px-3 py-1.5 text-sm font-semibold text-white">
                {mode === 'buy' ? 'SOL' : token.symbol}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {mode === 'buy'
            ? quickBuyAmounts.map((value) => (
                <button
                  key={value}
                  onClick={() => setAmount(String(value))}
                  className="rounded-full bg-[#15263d] px-2 py-1 text-[13px] font-semibold text-[#d4e4f5]"
                >
                  {value} SOL
                </button>
              ))
            : quickSellPercents.map((value) => (
                <button
                  key={value}
                  onClick={() => setAmount(((userTokenBalance * value) / 100).toString())}
                  className="rounded-full bg-[#15263d] px-2 py-1 text-[14px] font-semibold text-[#d4e4f5]"
                >
                  {value}%
                </button>
              ))}
          <button
            onClick={handleMaxClick}
            className="rounded-full bg-[#15263d] px-2 py-1 text-[14px] font-semibold text-[#d4e4f5]"
          >
            Max
          </button>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-[#90a6bd]">Slippage Tolerance</span>
            <span className="text-xs text-[#90a6bd]">{slippage}%</span>
          </div>
          <div className="flex items-center space-x-2">
            {[1, 3, 5, 10].map((value) => (
              <button
                key={value}
                onClick={() => setSlippage(value)}
                className={`rounded-full px-2 py-1 text-[12px] font-semibold transition-colors ${
                  slippage === value
                    ? 'bg-white text-[#08172A]'
                    : 'bg-[#15263d] text-[#8ea3b8] hover:text-white'
                }`}
              >
                {value}%
              </button>
            ))}
            <button className="rounded-full bg-[#15263d] px-2 py-1 text-[12px] font-semibold text-[#8ea3b8]">Auto</button>
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs text-[#90a6bd]">You Receive</label>
          <div className="rounded-xl bg-[#14263d] px-4 py-3 text-sm">
            <span className="text-sm text-[#c7d9eb]">
              {outputAmount > 0 ? formatNumber(outputAmount) : '0.00'}
            </span>
            <span className="ml-1 text-sm text-[#9fb2c8]">
              {mode === 'buy' ? token.symbol : 'SOL'}
            </span>
          </div>
        </div>

        {quoteError && isMeteoraTrading && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
            {quoteError}
          </div>
        )}

        {/* Trade Button - Show for all tradeable tokens */}
        {(!token.graduated || (token.graduated && token.meteoraPool)) && (
         <button
          onClick={handleTrade}
          disabled={isSubmitting || !connected}
          className={`w-full rounded-xl py-3 text-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
            mode === 'buy'
              ? 'bg-[#45ef56] text-[#08172A] hover:bg-[#39da4c]'
              : 'bg-[#ef4444] text-white hover:bg-[#dc2626]'
          } flex items-center justify-center gap-2`} // 🔥 IMPORTANT
        >
                {isSubmitting ? (
          <>
            <AppLoader size={50}  />
            <span>Processing...</span>
          </>
        ) : !connected ? (
          <span>Connect Wallet</span>
        ) : (
          <span>{mode === 'buy' ? 'Buy' : 'Sell'}</span>
        )}
        </button>
        )}
      </div>
    </div>
  );
};
