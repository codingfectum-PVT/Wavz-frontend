'use client';

import { useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, ComputeBudgetProgram, SystemProgram, Transaction, Connection } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
} from '@solana/spl-token';
import { CpAmm, deriveTokenVaultAddress } from '@meteora-ag/cp-amm-sdk';
import BN from 'bn.js';

// Our pools use FeeTimeSchedulerLinear (mode=0). The SDK checks byte 8 of
// baseFeeInfo.data for RateLimiter (mode=2). Since byte 8 = 0 in a zero-filled
// buffer, no extra accounts are added to the swap instruction.
const SYNTHETIC_POOL_STATE = {
  poolFees: {
    baseFee: {
      baseFeeInfo: { data: Buffer.alloc(9) },
    },
  },
} as any;

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

      if (
        status?.value?.confirmationStatus === 'processed' ||
        status?.value?.confirmationStatus === 'confirmed' ||
        status?.value?.confirmationStatus === 'finalized'
      ) {
        if (status.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
        }
        return true;
      }

      if (i % 10 === 0) {
        const currentBlockHeight = await connection.getBlockHeight();
        if (currentBlockHeight > lastValidBlockHeight) {
          throw new Error('Transaction expired: block height exceeded');
        }
      }

      await new Promise(resolve => setTimeout(resolve, delayMs));
    } catch (error: any) {
      if (
        error.message?.includes('Transaction expired') ||
        error.message?.includes('Transaction failed')
      ) {
        throw error;
      }
    }
  }

  throw new Error('Transaction confirmation timeout');
}

export function useMeteorSwap() {
  const { connection } = useConnection();
  const wallet = useWallet();

  /**
   * Buy tokens on Meteora DAMM v2 (SOL -> Token)
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

    const poolPubkey = new PublicKey(poolAddress);
    const mintPubkey = new PublicKey(tokenMint);
    const cpAmm = new CpAmm(connection);

    const tokenAVault = deriveTokenVaultAddress(mintPubkey, poolPubkey);
    const tokenBVault = deriveTokenVaultAddress(NATIVE_MINT, poolPubkey);

    // Fetch vault balances to compute minimum output with slippage
    const [tokenAInfo, tokenBInfo] = await Promise.all([
      connection.getTokenAccountBalance(tokenAVault),
      connection.getTokenAccountBalance(tokenBVault),
    ]);
    const reserveA = BigInt(tokenAInfo.value.amount); // token units
    const reserveB = BigInt(tokenBInfo.value.amount); // lamports

    // Constant product formula with 1% pool fee
    const amountInBig = BigInt(Math.floor(solAmount));
    const amountInAfterFee = (amountInBig * BigInt(99)) / BigInt(100);
    const expectedOut = (amountInAfterFee * reserveA) / (reserveB + amountInAfterFee);
    const minOutAmount = (expectedOut * BigInt(10000 - slippageBps)) / BigInt(10000);

    const tx = new Transaction();
    const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, wallet.publicKey, false, TOKEN_PROGRAM_ID);
    const tokenAta = getAssociatedTokenAddressSync(mintPubkey, wallet.publicKey, false, TOKEN_PROGRAM_ID);

    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 450_000 }));

    // Create ATAs (no-op if they already exist)
    tx.add(createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey, wsolAta, wallet.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID,
    ));
    tx.add(createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey, tokenAta, wallet.publicKey, mintPubkey, TOKEN_PROGRAM_ID,
    ));

    // Wrap SOL → WSOL
    tx.add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wsolAta, lamports: solAmount }));
    tx.add(createSyncNativeInstruction(wsolAta));

    // Build DAMM v2 swap instruction (WSOL → Token)
    const swapTx = await cpAmm.swap({
      payer:               wallet.publicKey,
      pool:                poolPubkey,
      inputTokenMint:      NATIVE_MINT,
      outputTokenMint:     mintPubkey,
      amountIn:            new BN(solAmount),
      minimumAmountOut:    new BN(minOutAmount.toString()),
      tokenAVault,
      tokenBVault,
      tokenAMint:          mintPubkey,
      tokenBMint:          NATIVE_MINT,
      tokenAProgram:       TOKEN_PROGRAM_ID,
      tokenBProgram:       TOKEN_PROGRAM_ID,
      referralTokenAccount: null,
      poolState:           SYNTHETIC_POOL_STATE,
    });

    for (const ix of swapTx.instructions) {
      if (!ix.programId.equals(ComputeBudgetProgram.programId)) tx.add(ix);
    }

    // Recover WSOL rent
    tx.add(createCloseAccountInstruction(wsolAta, wallet.publicKey, wallet.publicKey));

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;

    const signedTx = await wallet.signTransaction(tx);
    const signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: true,
      preflightCommitment: 'processed',
    });

    await confirmTransactionPolling(connection, signature, blockhash, lastValidBlockHeight);
    return signature;
  }, [connection, wallet]);

  /**
   * Sell tokens on Meteora DAMM v2 (Token -> SOL)
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

    const poolPubkey = new PublicKey(poolAddress);
    const mintPubkey = new PublicKey(tokenMint);
    const cpAmm = new CpAmm(connection);

    const tokenAVault = deriveTokenVaultAddress(mintPubkey, poolPubkey);
    const tokenBVault = deriveTokenVaultAddress(NATIVE_MINT, poolPubkey);

    // Fetch vault balances to compute minimum output with slippage
    const [tokenAInfo, tokenBInfo] = await Promise.all([
      connection.getTokenAccountBalance(tokenAVault),
      connection.getTokenAccountBalance(tokenBVault),
    ]);
    const reserveA = BigInt(tokenAInfo.value.amount); // token units
    const reserveB = BigInt(tokenBInfo.value.amount); // lamports

    // Constant product formula with 1% pool fee (Token → SOL)
    const amountInBig = BigInt(Math.floor(tokenAmount));
    const amountInAfterFee = (amountInBig * BigInt(99)) / BigInt(100);
    const expectedOut = (amountInAfterFee * reserveB) / (reserveA + amountInAfterFee); // lamports out
    const minOutAmount = (expectedOut * BigInt(10000 - slippageBps)) / BigInt(10000);

    const tx = new Transaction();
    const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, wallet.publicKey, false, TOKEN_PROGRAM_ID);

    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 450_000 }));

    // Create WSOL ATA to receive output
    tx.add(createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey, wsolAta, wallet.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID,
    ));

    // Build DAMM v2 swap instruction (Token → WSOL)
    const swapTx = await cpAmm.swap({
      payer:               wallet.publicKey,
      pool:                poolPubkey,
      inputTokenMint:      mintPubkey,
      outputTokenMint:     NATIVE_MINT,
      amountIn:            new BN(tokenAmount),
      minimumAmountOut:    new BN(minOutAmount.toString()),
      tokenAVault,
      tokenBVault,
      tokenAMint:          mintPubkey,
      tokenBMint:          NATIVE_MINT,
      tokenAProgram:       TOKEN_PROGRAM_ID,
      tokenBProgram:       TOKEN_PROGRAM_ID,
      referralTokenAccount: null,
      poolState:           SYNTHETIC_POOL_STATE,
    });

    for (const ix of swapTx.instructions) {
      if (!ix.programId.equals(ComputeBudgetProgram.programId)) tx.add(ix);
    }

    // Unwrap WSOL → SOL
    tx.add(createCloseAccountInstruction(wsolAta, wallet.publicKey, wallet.publicKey));

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;

    const signedTx = await wallet.signTransaction(tx);
    const signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: true,
      preflightCommitment: 'processed',
    });

    await confirmTransactionPolling(connection, signature, blockhash, lastValidBlockHeight);
    return signature;
  }, [connection, wallet]);

  /**
   * Get swap quote from DAMM v2 pool using constant product formula
   */
  const getQuote = useCallback(async (
    poolAddress: string,
    amount: number, // in smallest units
    isBuy: boolean,
    tokenMint: string
  ): Promise<{ outAmount: number; fee: number; priceImpact: number }> => {
    const poolPubkey = new PublicKey(poolAddress);
    const mintPubkey = new PublicKey(tokenMint);

    const tokenAVault = deriveTokenVaultAddress(mintPubkey, poolPubkey);
    const tokenBVault = deriveTokenVaultAddress(NATIVE_MINT, poolPubkey);

    const [tokenAInfo, tokenBInfo] = await Promise.all([
      connection.getTokenAccountBalance(tokenAVault),
      connection.getTokenAccountBalance(tokenBVault),
    ]);
    const reserveA = BigInt(tokenAInfo.value.amount); // token units
    const reserveB = BigInt(tokenBInfo.value.amount); // lamports

    if (reserveA === BigInt(0) || reserveB === BigInt(0)) {
      throw new Error('Insufficient liquidity for this swap amount');
    }

    const amountInBig = BigInt(Math.floor(amount));
    const feeAmount = (amountInBig * BigInt(1)) / BigInt(100); // 1% fee
    const amountInAfterFee = amountInBig - feeAmount;

    let outAmount: bigint;
    if (isBuy) {
      // SOL → Token
      outAmount = (amountInAfterFee * reserveA) / (reserveB + amountInAfterFee);
    } else {
      // Token → SOL
      outAmount = (amountInAfterFee * reserveB) / (reserveA + amountInAfterFee);
    }

    // Price impact: compare effective rate vs spot rate
    const spotRate = isBuy
      ? Number(reserveA) / Number(reserveB)
      : Number(reserveB) / Number(reserveA);
    const effectiveRate = Number(outAmount) / Number(amountInBig);
    const priceImpact = spotRate > 0
      ? Math.abs((spotRate - effectiveRate) / spotRate) * 100
      : 0;

    return {
      outAmount: Number(outAmount),
      fee: Number(feeAmount),
      priceImpact,
    };
  }, [connection]);

  /**
   * Get pool liquidity info from DAMM v2 vault balances
   */
  const getPoolInfo = useCallback(async (
    poolAddress: string,
    tokenMint: string
  ): Promise<{ totalSol: number; totalTokens: number }> => {
    const poolPubkey = new PublicKey(poolAddress);
    const mintPubkey = new PublicKey(tokenMint);

    const tokenAVault = deriveTokenVaultAddress(mintPubkey, poolPubkey);
    const tokenBVault = deriveTokenVaultAddress(NATIVE_MINT, poolPubkey);

    const [tokenAInfo, tokenBInfo] = await Promise.all([
      connection.getTokenAccountBalance(tokenAVault),
      connection.getTokenAccountBalance(tokenBVault),
    ]);

    return {
      totalTokens: Number(tokenAInfo.value.amount) / 1e6,
      totalSol: Number(tokenBInfo.value.amount) / 1e9,
    };
  }, [connection]);

  return {
    buyOnMeteora,
    sellOnMeteora,
    getQuote,
    getPoolInfo,
  };
}

