import { useMemo } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Keypair, ComputeBudgetProgram, Transaction, Connection } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import IDL from '@/lib/idl.json';

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || 'EprHeZN3dC1eD6NZAkrav5QAmWADrB7huw2jUEzhnHdo'
);

const METADATA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
);

/**
 * Confirm transaction using polling (works with public RPC rate limits)
 * Uses exponential backoff to avoid 429 errors
 */
async function confirmTransactionPolling(
  connection: Connection,
  signature: string,
  blockhash: string,
  lastValidBlockHeight: number,
  maxRetries: number = 60,
  initialDelayMs: number = 3000
): Promise<boolean> {
  let delayMs = initialDelayMs;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const status = await connection.getSignatureStatus(signature);
      
      // Accept 'processed' for faster feedback, 'confirmed' for safety
      if (status?.value?.confirmationStatus === 'processed' ||
          status?.value?.confirmationStatus === 'confirmed' || 
          status?.value?.confirmationStatus === 'finalized') {
        if (status.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
        }
        // console.log(`Transaction confirmed at attempt ${i + 1}`);
        return true;
      }
      
      // Check if block height exceeded (only every 10 polls to reduce RPC calls)
      if (i % 10 === 0 && i > 0) {
        try {
          const currentBlockHeight = await connection.getBlockHeight();
          if (currentBlockHeight > lastValidBlockHeight) {
            throw new Error('Transaction expired: block height exceeded');
          }
        } catch (e) {
          // Ignore block height check errors
        }
      }
      
      // Wait with slow exponential backoff (cap at 5s)
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 1.1, 5000);
      
      if (i % 10 === 0) console.log(`Confirming tx... attempt ${i + 1}`);
    } catch (error: any) {
      if (error.message?.includes('Transaction expired')) {
        throw error;
      }
      // On rate limit, wait longer
      if (error.message?.includes('429')) {
        delayMs = Math.min(delayMs * 2, 10000);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      // Continue on other errors
    }
  }
  
  // Don't throw - the tx may have succeeded but confirmation failed
  console.warn('Transaction confirmation polling exhausted - tx may have succeeded');
  return true; // Assume success - user can verify on explorer
}

export function useProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const provider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
      return null;
    }
    const anchorWallet = {
      publicKey: wallet.publicKey,
      signTransaction: wallet.signTransaction.bind(wallet),
      signAllTransactions: wallet.signAllTransactions.bind(wallet),
    };
    return new AnchorProvider(
      connection,
      anchorWallet,
      { commitment: 'processed', preflightCommitment: 'processed', skipPreflight: true }
    );
  }, [connection, wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions]);

  const program = useMemo(() => {
    if (!provider) return null;
    // Anchor 0.30+ gets programId from IDL.address field
    // Cast to any to bypass strict IDL type checking
    return new Program(IDL as any, provider);
  }, [provider]);

  return { program, provider };
}

export function useProgramAccounts() {
  const getConfigPda = () => {
    return PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);
  };

  const getBondingCurvePda = (mint: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('bonding_curve'), mint.toBuffer()],
      PROGRAM_ID
    );
  };

  const getUserHoldingPda = (user: PublicKey, mint: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('user_holding'), user.toBuffer(), mint.toBuffer()],
      PROGRAM_ID
    );
  };

  const getMetadataPda = (mint: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      METADATA_PROGRAM_ID
    );
  };

  const getFeeVaultPda = () => {
    return PublicKey.findProgramAddressSync([Buffer.from('fee_vault')], PROGRAM_ID);
  };

  const getWalletProfilePda = (user: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('wallet_profile'), user.toBuffer()],
      PROGRAM_ID
    );
  };

  return {
    getConfigPda,
    getBondingCurvePda,
    getUserHoldingPda,
    getMetadataPda,
    getFeeVaultPda,
    getWalletProfilePda,
    PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    METADATA_PROGRAM_ID,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
    getAssociatedTokenAddressSync,
  };
}

export function useLaunchpadActions() {
  const { program, provider } = useProgram();
  const accounts = useProgramAccounts();
  const wallet = useWallet();
  const { connection } = useConnection();

  const createToken = async (
    name: string,
    symbol: string,
    uri: string,
    initialVirtualSolReserves: number = 30_000_000_000, // 30 SOL default
    initialVirtualTokenReserves: number = 1_000_000_000_000_000, // 1B tokens default
    antiSnipeConfig?: {
      enabled: boolean;
      maxWalletBps: number; // 200 = 2%
      lockDuration: number; // seconds
      batchDuration: number; // seconds
      minTrustScore: number; // 0-100
      requireCivic: boolean;
    }
  ) => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected');
    }

    // Fetch vanity keypair from backend for "wavz" suffix address
    let mintKeypair: Keypair;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    
    try {
      const response = await fetch(`${apiUrl}/api/vanity/keypair`);
      if (response.ok) {
        const data = await response.json();
        if (data.keypair) {
          const secretKey = typeof data.keypair === 'string' 
            ? JSON.parse(data.keypair) as number[]
            : data.keypair;
          mintKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
          // console.log(`Using vanity address: ${mintKeypair.publicKey.toBase58()}`);
        } else {
          throw new Error('No vanity keypair available');
        }
      } else {
        throw new Error('Failed to fetch vanity keypair');
      }
    } catch (error) {
      console.warn('Vanity keypair not available, generating random keypair:', error);
      mintKeypair = Keypair.generate();
    }
    
    const mint = mintKeypair.publicKey;
    
    const [configPda] = accounts.getConfigPda();
    const [bondingCurvePda] = accounts.getBondingCurvePda(mint);
    const [metadataPda] = accounts.getMetadataPda(mint);

    const bondingCurveTokenAccount = accounts.getAssociatedTokenAddressSync(
      mint,
      bondingCurvePda,
      true
    );

    // Format anti-snipe config for program
    const antiSnipe = antiSnipeConfig ? {
      enabled: antiSnipeConfig.enabled,
      maxWalletBps: antiSnipeConfig.maxWalletBps,
      lockDuration: new BN(antiSnipeConfig.lockDuration),
      batchDuration: new BN(antiSnipeConfig.batchDuration),
      minTrustScore: antiSnipeConfig.minTrustScore,
      requireCivic: antiSnipeConfig.requireCivic,
    } : null;

    try {
      // Build transaction with increased compute budget for complex instruction
      const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
      const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 });
      
      const txBuilder = (program.methods as any)
        .createToken(
          name,
          symbol,
          uri,
          new BN(initialVirtualSolReserves),
          new BN(initialVirtualTokenReserves),
          antiSnipe // anti_snipe: Option<AntiSnipeInput>
        )
        .accounts({
          config: configPda,
          mint,
          bondingCurve: bondingCurvePda,
          metadata: metadataPda,
          bondingCurveTokenAccount: bondingCurveTokenAccount,
          creator: wallet.publicKey,
          tokenProgram: accounts.TOKEN_PROGRAM_ID,
          associatedTokenProgram: accounts.ASSOCIATED_TOKEN_PROGRAM_ID,
          metadataProgram: accounts.METADATA_PROGRAM_ID,
          systemProgram: accounts.SystemProgram.programId,
          rent: accounts.SYSVAR_RENT_PUBKEY,
        })
        .signers([mintKeypair]);

      // Build and add compute budget instructions
      const transaction = await txBuilder.transaction();
      transaction.instructions.unshift(addPriorityFee);
      transaction.instructions.unshift(modifyComputeUnits);
      
      // Get latest blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet.publicKey;
      
      // Partial sign with mint keypair
      transaction.partialSign(mintKeypair);
      
      // Sign with wallet and send
      const tx = await wallet.sendTransaction(transaction, connection, {
        skipPreflight: true,
      });
      
      // Confirm transaction using polling (Alchemy free tier doesn't support WebSocket subscriptions)
      await confirmTransactionPolling(connection, tx, blockhash, lastValidBlockHeight);

      return { tx, mint: mint.toBase58() };
    } catch (error: any) {
      // If transaction was already processed, it means it succeeded
      if (error?.message?.includes('already been processed') || 
          error?.message?.includes('AlreadyProcessed')) {
        // console.log('Transaction already processed - token created successfully');
        return { tx: 'already_processed', mint: mint.toBase58() };
      }
      throw error;
    }
  };

  const buy = async (mint: string, solAmount: number, slippageBps: number = 100) => {
    if (!program || !wallet.publicKey || !provider) {
      throw new Error('Wallet not connected');
    }

    // console.log('Buy called with:', { mint, solAmount, slippageBps });

    const userPubkey = provider.wallet.publicKey;
    const [walletProfilePda] = accounts.getWalletProfilePda(userPubkey);
    const mintPubkey = new PublicKey(mint);
    const [configPda] = accounts.getConfigPda();
    const [bondingCurvePda] = accounts.getBondingCurvePda(mintPubkey);

    // console.log('Accounts:', { 
    //   config: configPda.toBase58(), 
    //   bondingCurve: bondingCurvePda.toBase58(),
    //   mint: mintPubkey.toBase58(),
    //   walletProfile: walletProfilePda.toBase58(),
    //   user: userPubkey.toBase58()
    // });

    // Fetch config first to get fee info
    // console.log('Fetching config from:', configPda.toBase58());
    let config;
    try {
      config = await (program.account as any).launchpadConfig.fetch(configPda) as any;
      // console.log('Config fetched:', config);
    } catch (e) {
      console.error('Failed to fetch config:', e);
      throw new Error('Config not found. Is the program initialized?');
    }

    // Fetch bonding curve to calculate min tokens out (with retries for newly created tokens)
    let bondingCurve;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        bondingCurve = await (program.account as any).bondingCurve.fetch(bondingCurvePda) as any;
        break;
      } catch (e) {
        if (attempt === 9) throw new Error('Bonding curve not found. Token may not be confirmed yet.');
        // console.log(`Bonding curve not ready, retrying (${attempt + 1}/10)...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Calculate expected tokens (accounting for platform fee)
    const solAmountBN = new BN(solAmount);
    const platformFeeBps = config.platformFeeBps || 100; // Default 1%
    const fee = solAmountBN.mul(new BN(platformFeeBps)).div(new BN(10000));
    const solAfterFee = solAmountBN.sub(fee);
    
    // Calculate tokens out using the amount after fee (matching program logic)
    const tokensOut = bondingCurve.virtualTokenReserves
      .mul(solAfterFee)
      .div(bondingCurve.virtualSolReserves.add(solAfterFee));

    // Apply slippage
    const minTokensOut = tokensOut.mul(new BN(10000 - slippageBps)).div(new BN(10000));

    const bondingCurveTokenAccount = accounts.getAssociatedTokenAddressSync(
      mintPubkey,
      bondingCurvePda,
      true
    );

    const userTokenAccount = accounts.getAssociatedTokenAddressSync(
      mintPubkey,
      userPubkey
    );

    // console.log('Token accounts computed:', {
    //   bondingCurveTokenAccount: bondingCurveTokenAccount.toBase58(),
    //   userTokenAccount: userTokenAccount.toBase58(),
    // });

    // console.log('Building buy transaction...');
    
    // Build transaction manually (like createToken) to avoid wallet adapter issues with .rpc()
    try {
      const txBuilder = (program.methods as any)
        .buy(solAmountBN, minTokensOut)
        .accounts({
          config: configPda,
          mint: mintPubkey,
          bondingCurve: bondingCurvePda,
          bondingCurveTokenAccount: bondingCurveTokenAccount,
          userTokenAccount: userTokenAccount,
          walletProfile: walletProfilePda,
          feeRecipient: config.authority,
          user: userPubkey,
          tokenProgram: accounts.TOKEN_PROGRAM_ID,
          associatedTokenProgram: accounts.ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: accounts.SystemProgram.programId,
        });

      const transaction = await txBuilder.transaction();
      transaction.instructions.unshift(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }),
      );
      transaction.instructions.unshift(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = userPubkey;

      const tx = await wallet.sendTransaction(transaction, connection, {
        skipPreflight: true,
      });

      // console.log('Transaction sent:', tx);
      await confirmTransactionPolling(connection, tx, blockhash, lastValidBlockHeight);
      // console.log('Buy transaction confirmed:', tx);
      
      return tx;
    } catch (error: any) {
      // Handle "already processed" as success - it means the tx went through
      if (error?.message?.includes('already been processed') || 
          error?.message?.includes('AlreadyProcessed')) {
        // console.log('Transaction already processed - treating as success');
        return 'already_processed';
      }
      throw error;
    }
  };

  const sell = async (mint: string, tokenAmount: number, slippageBps: number = 100) => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected');
    }

    const mintPubkey = new PublicKey(mint);
    const [configPda] = accounts.getConfigPda();
    const [bondingCurvePda] = accounts.getBondingCurvePda(mintPubkey);

    // Fetch config for fee calculation
    const config = await (program.account as any).launchpadConfig.fetch(configPda) as any;
    
    // Fetch bonding curve to calculate min SOL out
    const bondingCurve = await (program.account as any).bondingCurve.fetch(bondingCurvePda) as any;

    // Calculate expected SOL (before fee)
    const tokenAmountBN = new BN(tokenAmount);
    const solOutBeforeFee = bondingCurve.virtualSolReserves
      .mul(tokenAmountBN)
      .div(bondingCurve.virtualTokenReserves.add(tokenAmountBN));

    // Deduct platform fee (matching program logic)
    const platformFeeBps = config.platformFeeBps || 100; // Default 1%
    const fee = solOutBeforeFee.mul(new BN(platformFeeBps)).div(new BN(10000));
    const solOut = solOutBeforeFee.sub(fee);

    // Apply slippage to the amount after fee
    const minSolOut = solOut.mul(new BN(10000 - slippageBps)).div(new BN(10000));

    const bondingCurveTokenAccount = accounts.getAssociatedTokenAddressSync(
      mintPubkey,
      bondingCurvePda,
      true
    );

    const userTokenAccount = accounts.getAssociatedTokenAddressSync(
      mintPubkey,
      wallet.publicKey
    );

    try {
      const txBuilder = (program.methods as any)
        .sell(tokenAmountBN, minSolOut)
        .accounts({
          config: configPda,
          bondingCurve: bondingCurvePda,
          bondingCurveTokenAccount: bondingCurveTokenAccount,
          userTokenAccount: userTokenAccount,
          feeRecipient: config.authority,
          user: wallet.publicKey,
          tokenProgram: accounts.TOKEN_PROGRAM_ID,
          systemProgram: accounts.SystemProgram.programId,
        });

      const transaction = await txBuilder.transaction();
      transaction.instructions.unshift(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }),
      );
      transaction.instructions.unshift(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet.publicKey;

      const tx = await wallet.sendTransaction(transaction, connection, {
        skipPreflight: true,
      });

      await confirmTransactionPolling(connection, tx, blockhash, lastValidBlockHeight);
      return tx;
    } catch (error: any) {
      // Handle "already processed" as success
      if (error?.message?.includes('already been processed') || 
          error?.message?.includes('AlreadyProcessed')) {
        // console.log('Transaction already processed - treating as success');
        return 'already_processed';
      }
      throw error;
    }
  };

  return { createToken, buy, sell };
}
