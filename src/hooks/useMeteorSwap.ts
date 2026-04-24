'use client';

import { useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, ComputeBudgetProgram, Connection } from '@solana/web3.js';
import { 
  getAssociatedTokenAddressSync, 
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import DLMM from '@meteora-ag/dlmm';
import BN from 'bn.js';

/**
 * Confirm transaction using polling (works with Alchemy free tier)
 */
async function confirmTransactionPolling(
  connection: Connection,
  signature: string,
  blockhash: string,
  lastValidBlockHeight: number,
  maxRetries: number = 60,
  delayMs: number = 500
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const status = await connection.getSignatureStatus(signature);
      
      // Accept 'processed' for faster feedback
      if (status?.value?.confirmationStatus === 'processed' ||
          status?.value?.confirmationStatus === 'confirmed' || 
          status?.value?.confirmationStatus === 'finalized') {
        if (status.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
        }
        return true;
      }
      
      // Only check block height every 10 polls to reduce RPC calls
      if (i % 10 === 0) {
        const currentBlockHeight = await connection.getBlockHeight();
        if (currentBlockHeight > lastValidBlockHeight) {
          throw new Error('Transaction expired: block height exceeded');
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, delayMs));
    } catch (error: any) {
      if (error.message?.includes('Transaction expired')) {
        throw error;
      }
      if (i % 5 === 0) console.log('Polling attempt', i + 1);
    }
  }
  
  throw new Error('Transaction confirmation timeout');
}

export function useMeteorSwap() {
  const { connection } = useConnection();
  const wallet = useWallet();

  /**
   * Buy tokens on Meteora (SOL -> Token)
   */
  const buyOnMeteora = useCallback(async (
    poolAddress: string,
    tokenMint: string,
    solAmount: number, // in lamports
    slippageBps: number = 100
  ): Promise<string> => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      throw new Error('Wallet not connected');
    }

    // console.log('Meteora Buy:', { poolAddress, tokenMint, solAmount, slippageBps });

    const poolPubkey = new PublicKey(poolAddress);
    const mintPubkey = new PublicKey(tokenMint);

    // Create DLMM instance with devnet cluster
    const dlmm = await DLMM.create(connection, poolPubkey, { cluster: 'devnet' });

    // IMPORTANT: Refetch states to ensure bin arrays are populated
    await dlmm.refetchStates();
    
    // Fetch all bin arrays - try multiple methods
    let binArrays: any[] = (dlmm as any).binArrays || [];
    if (binArrays.length === 0) {
      try {
        // Try getBinArrays() method
        binArrays = await (dlmm as any).getBinArrays() || [];
      } catch (e) {
        // console.log('getBinArrays failed, trying alternative');
      }
    }
    
    // If still no bin arrays, try getBinArrayForSwap with a range around active bin
    if (binArrays.length === 0) {
      try {
        const activeBin = dlmm.lbPair.activeId;
        // Fetch bin arrays for a wide range around active bin
        const binArrayAccounts = await (dlmm as any).getBinArrayForSwap(true, 50);
        if (binArrayAccounts && binArrayAccounts.length > 0) {
          binArrays = binArrayAccounts;
          // console.log(`Got ${binArrays.length} bin arrays via getBinArrayForSwap`);
        }
      } catch (e) {
        // console.log('getBinArrayForSwap failed:', e);
      }
    }
    
    // console.log(`Bin arrays loaded: ${binArrays.length}`);

    // Get user's token account
    const userTokenAccount = getAssociatedTokenAddressSync(mintPubkey, wallet.publicKey);

    // Check if token account exists, create ATA instruction if not
    const tokenAccountInfo = await connection.getAccountInfo(userTokenAccount);
    
    // Determine which token is SOL and which is the token
    // In Meteora DLMM, tokenX is usually SOL (WSOL) and tokenY is the token
    const isTokenXSol = dlmm.tokenX.publicKey.toBase58() === 'So11111111111111111111111111111111111111112';
    const swapForY = isTokenXSol; // If SOL is tokenX, we swap for Y (the token)
    
    // console.log(`Token X: ${dlmm.tokenX.publicKey.toBase58()}, Token Y: ${dlmm.tokenY.publicKey.toBase58()}`);
    // console.log(`Swapping SOL for token, swapForY: ${swapForY}`);

    // Get swap quote (SOL -> Token)
    const swapAmount = new BN(solAmount);
    const quote = dlmm.swapQuote(
      swapAmount,
      swapForY,
      new BN(slippageBps),
      binArrays
    );

    // console.log('Swap quote:', {
    //   consumedInAmount: quote.consumedInAmount.toString(),
    //   outAmount: quote.outAmount.toString(),
    //   fee: quote.fee.toString(),
    // });

    // Build swap transaction using SDK
    const swapTx = await dlmm.swap({
      inAmount: swapAmount,
      minOutAmount: quote.minOutAmount,
      inToken: isTokenXSol ? dlmm.tokenX.publicKey : dlmm.tokenY.publicKey,
      outToken: isTokenXSol ? dlmm.tokenY.publicKey : dlmm.tokenX.publicKey,
      lbPair: poolPubkey,
      user: wallet.publicKey,
      binArraysPubkey: quote.binArraysPubkey,
    });

    // Add create ATA instruction if needed (before swap)
    if (!tokenAccountInfo) {
      const createAtaIx = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        userTokenAccount,
        wallet.publicKey,
        mintPubkey
      );
      swapTx.instructions.unshift(createAtaIx);
    }

    // Add priority fee for faster processing (only once!)
    swapTx.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 })
    );

    // Set recent blockhash and fee payer
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    swapTx.recentBlockhash = blockhash;
    swapTx.feePayer = wallet.publicKey;

    // Sign and send
    const signedTx = await wallet.signTransaction(swapTx);
    const signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: true,
      preflightCommitment: 'processed',
    });

    // Confirm using fast polling
    await confirmTransactionPolling(connection, signature, blockhash, lastValidBlockHeight);

    // console.log('Meteora buy completed:', signature);
    return signature;
  }, [connection, wallet]);

  /**
   * Sell tokens on Meteora (Token -> SOL)
   */
  const sellOnMeteora = useCallback(async (
    poolAddress: string,
    tokenMint: string,
    tokenAmount: number, // with decimals (e.g., 1e6 for 1 token)
    slippageBps: number = 100
  ): Promise<string> => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      throw new Error('Wallet not connected');
    }

    // console.log('Meteora Sell:', { poolAddress, tokenMint, tokenAmount, slippageBps });

    const poolPubkey = new PublicKey(poolAddress);

    // Create DLMM instance with devnet cluster
    const dlmm = await DLMM.create(connection, poolPubkey, { cluster: 'devnet' });

    // IMPORTANT: Refetch states to ensure bin arrays are populated
    await dlmm.refetchStates();
    
    // Fetch all bin arrays - try multiple methods
    let binArrays: any[] = (dlmm as any).binArrays || [];
    if (binArrays.length === 0) {
      try {
        binArrays = await (dlmm as any).getBinArrays() || [];
      } catch (e) {
        // console.log('getBinArrays failed, trying alternative');
      }
    }
    
    // If still no bin arrays, try getBinArrayForSwap
    if (binArrays.length === 0) {
      try {
        const binArrayAccounts = await (dlmm as any).getBinArrayForSwap(false, 50); // false = selling tokens
        if (binArrayAccounts && binArrayAccounts.length > 0) {
          binArrays = binArrayAccounts;
          // console.log(`Got ${binArrays.length} bin arrays via getBinArrayForSwap`);
        }
      } catch (e) {
        // console.log('getBinArrayForSwap failed:', e);
      }
    }
    
    // console.log(`Bin arrays loaded: ${binArrays.length}`);

    // Determine which token is SOL and which is the token
    const isTokenXSol = dlmm.tokenX.publicKey.toBase58() === 'So11111111111111111111111111111111111111112';
    const swapForY = !isTokenXSol; // If SOL is tokenX, we swap for X (SOL), so swapForY is false
    
    // console.log(`Token X: ${dlmm.tokenX.publicKey.toBase58()}, Token Y: ${dlmm.tokenY.publicKey.toBase58()}`);
    // console.log(`Swapping token for SOL, swapForY: ${swapForY}`);

    // Get swap quote (Token -> SOL)
    const swapAmount = new BN(tokenAmount);
    const quote = dlmm.swapQuote(
      swapAmount,
      swapForY,
      new BN(slippageBps),
      binArrays
    );

    // console.log('Swap quote:', {
    //   consumedInAmount: quote.consumedInAmount.toString(),
    //   outAmount: quote.outAmount.toString(),
    //   fee: quote.fee.toString(),
    // });

    // Build swap transaction using SDK
    const swapTx = await dlmm.swap({
      inAmount: swapAmount,
      minOutAmount: quote.minOutAmount,
      inToken: isTokenXSol ? dlmm.tokenY.publicKey : dlmm.tokenX.publicKey, // token
      outToken: isTokenXSol ? dlmm.tokenX.publicKey : dlmm.tokenY.publicKey, // SOL
      lbPair: poolPubkey,
      user: wallet.publicKey,
      binArraysPubkey: quote.binArraysPubkey,
    });

    // Add compute budget at the beginning
    swapTx.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 })
    );

    // Set recent blockhash and fee payer
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    swapTx.recentBlockhash = blockhash;
    swapTx.feePayer = wallet.publicKey;

    // Sign and send
    const signedTx = await wallet.signTransaction(swapTx);
    const signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: true,
      preflightCommitment: 'processed',
    });

    // Confirm using fast polling
    await confirmTransactionPolling(connection, signature, blockhash, lastValidBlockHeight);

    // console.log('Meteora sell completed:', signature);
    return signature;
  }, [connection, wallet]);

  /**
   * Get swap quote from Meteora
   */
  const getQuote = useCallback(async (
    poolAddress: string,
    amount: number, // in smallest units
    isBuy: boolean
  ): Promise<{ outAmount: number; fee: number; priceImpact: number }> => {
    try {
      // console.log('getQuote called:', { poolAddress, amount, isBuy });
      
      const poolPubkey = new PublicKey(poolAddress);
      const dlmm = await DLMM.create(connection, poolPubkey, { cluster: 'devnet' });
      
      // IMPORTANT: Refetch states to ensure bin arrays are populated
      await dlmm.refetchStates();
      
      // Fetch all bin arrays - try multiple methods
      let binArrays: any[] = (dlmm as any).binArrays || [];
      if (binArrays.length === 0) {
        try {
          binArrays = await (dlmm as any).getBinArrays() || [];
        } catch (e) {
          // console.log('getBinArrays failed, trying alternative');
        }
      }
      
      // If still no bin arrays, try getBinArrayForSwap
      if (binArrays.length === 0) {
        try {
          const binArrayAccounts = await (dlmm as any).getBinArrayForSwap(isBuy, 50);
          if (binArrayAccounts && binArrayAccounts.length > 0) {
            binArrays = binArrayAccounts;
            // console.log(`Got ${binArrays.length} bin arrays via getBinArrayForSwap`);
          }
        } catch (e) {
          // console.log('getBinArrayForSwap failed:', e);
        }
      }
      
      if (!binArrays || binArrays.length === 0) {
        throw new Error('No liquidity bins available in pool');
      }
      
      // Determine swap direction based on token positions
      // Token X = TTT, Token Y = SOL in our pool
      const isTokenXSol = dlmm.tokenX.publicKey.toBase58() === 'So11111111111111111111111111111111111111112';
      
      // For isBuy (SOL -> Token): we want tokens (X), so swapForY = false if SOL is Y
      // For sell (Token -> SOL): we want SOL (Y), so swapForY = true if SOL is Y
      const swapForY = isBuy ? isTokenXSol : !isTokenXSol;
      
      // console.log('Swap params:', { 
      //   isTokenXSol, 
      //   swapForY,
      //   tokenX: dlmm.tokenX.publicKey.toBase58().slice(0, 8),
      //   tokenY: dlmm.tokenY.publicKey.toBase58().slice(0, 8),
      //   amountStr: amount.toString()
      // });
      
      // Create BN from string to avoid precision issues with large numbers
      const swapAmount = new BN(amount.toString());
      
      // Wrap in try-catch to handle SDK assertion errors
      let quote;
      try {
        quote = dlmm.swapQuote(
          swapAmount,
          swapForY,
          new BN(100), // 1% slippage for quote
          binArrays
        );
      } catch (quoteError: any) {
        console.error('swapQuote error:', quoteError);
        if (quoteError.message?.includes('Assertion failed') || 
            quoteError.message?.includes('Insufficient')) {
          throw new Error('Insufficient liquidity for this swap amount');
        }
        throw quoteError;
      }

      // console.log('Quote result:', {
      //   outAmount: quote.outAmount.toString(),
      //   fee: quote.fee.toString(),
      // });

      // Handle large BN values that exceed Number.MAX_SAFE_INTEGER
const outAmount = quote.outAmount.toString();
const fee = quote.fee.toString();

      return {
  outAmount: Number(outAmount) || 0, // only for display (safe fallback)
  fee: Number(fee) || 0,
  priceImpact: quote.priceImpact ? Number(quote.priceImpact.toString()) : 0,
};
    } catch (error: any) {
      console.error('Error getting Meteora quote:', error);
      throw error;
    }
  }, [connection]);

  /**
   * Get pool liquidity info
   */
  const getPoolInfo = useCallback(async (
    poolAddress: string
  ): Promise<{ totalSol: number; totalTokens: number }> => {
    try {
      const poolPubkey = new PublicKey(poolAddress);
      const dlmm = await DLMM.create(connection, poolPubkey, { cluster: 'devnet' });
      
      const bins = await dlmm.getBinsAroundActiveBin(100, 100);
      let totalX = new BN(0);
      let totalY = new BN(0);
      
      for (const bin of bins.bins || []) {
        const x = bin.xAmount ? new BN(bin.xAmount) : new BN(0);
        const y = bin.yAmount ? new BN(bin.yAmount) : new BN(0);
        totalX = totalX.add(x);
        totalY = totalY.add(y);
      }
      
      // Determine which is SOL
      const isTokenXSol = dlmm.tokenX.publicKey.toBase58() === 'So11111111111111111111111111111111111111112';
      
      return {
        totalSol: isTokenXSol ? totalX.toNumber() / 1e9 : totalY.toNumber() / 1e9,
        totalTokens: isTokenXSol ? totalY.toNumber() / 1e6 : totalX.toNumber() / 1e6,
      };
    } catch (error) {
      console.error('Error getting pool info:', error);
      throw error;
    }
  }, [connection]);

  return {
    buyOnMeteora,
    sellOnMeteora,
    getQuote,
    getPoolInfo,
  };
}
