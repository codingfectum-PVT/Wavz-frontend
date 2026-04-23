'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import { useGateway, GatewayStatus } from '@civic/solana-gateway-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Shield, ShieldCheck, ShieldAlert, Loader2, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppLoader } from '../Apploader';

interface CivicVerificationProps {
  onVerificationChange?: (verified: boolean) => void;
  compact?: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export const CivicVerification: FC<CivicVerificationProps> = ({ 
  onVerificationChange,
  compact = false 
}) => {
  const wallet = useWallet();
  const gateway = useGateway();
  const [isVerifying, setIsVerifying] = useState(false);
  const [synced, setSynced] = useState(false);

  const isVerified = gateway?.gatewayStatus === GatewayStatus.ACTIVE;
  const isPending = gateway?.gatewayStatus === GatewayStatus.CHECKING || 
                    gateway?.gatewayStatus === GatewayStatus.IN_REVIEW;

  // Sync verification status to backend when verified
  useEffect(() => {
    if (isVerified && wallet.publicKey && !synced) {
      const syncToBackend = async () => {
        try {
          const response = await fetch(`${API_URL}/api/users/${wallet.publicKey!.toBase58()}/civic-verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              gatewayToken: gateway?.gatewayToken?.publicKey?.toBase58() || 'verified' 
            }),
          });
          
          if (response.ok) {
            const data = await response.json();
            toast.success(`Civic verified! Trust score: ${data.trustScore}`);
            setSynced(true);
          }
        } catch (error) {
          console.error('Failed to sync verification:', error);
        }
      };
      
      syncToBackend();
    }
  }, [isVerified, wallet.publicKey, synced, gateway?.gatewayToken]);

  useEffect(() => {
    onVerificationChange?.(isVerified);
  }, [isVerified, onVerificationChange]);

  const handleVerify = useCallback(async () => {
    if (!gateway?.requestGatewayToken) {
      console.error('Gateway not available');
      return;
    }

    setIsVerifying(true);
    try {
      await gateway.requestGatewayToken();
    } catch (error) {
      console.error('Verification failed:', error);
      toast.error('Verification failed. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  }, [gateway]);

  if (!wallet.connected) {
    return null;
  }

  // Compact version for inline display
  if (compact) {
    return (
      <div className="flex items-center space-x-2">
        {isVerified ? (
          <>
            <ShieldCheck className="w-4 h-4 text-green-500" />
            <span className="text-xs text-green-500">Civic Verified</span>
          </>
        ) : isPending ? (
          <>
           <AppLoader size={50}  />
            <span className="text-xs text-yellow-500">Pending</span>
          </>
        ) : (
          <button
            onClick={handleVerify}
            disabled={isVerifying}
            className="flex items-center space-x-1 text-xs text-primary-400 hover:text-primary-300"
          >
            <Shield className="w-4 h-4" />
            <span>Get Verified</span>
          </button>
        )}
      </div>
    );
  }

  // Full card version
  return (
    <div className="bg-surface rounded-xl p-6 border border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
          <Shield className="w-5 h-5 text-primary-500" />
          <span>Civic Identity Verification</span>
        </h3>
        {isVerified && (
          <span className="bg-green-500/20 text-green-400 text-xs px-2 py-1 rounded-full">
            Verified
          </span>
        )}
      </div>

      {isVerified ? (
        <div className="space-y-4">
          <div className="flex items-center space-x-3 text-green-400">
            <ShieldCheck className="w-8 h-8" />
            <div>
              <p className="font-medium">Identity Verified</p>
              <p className="text-sm text-gray-400">
                Your wallet has passed Civic identity verification
              </p>
            </div>
          </div>
          <div className="bg-green-500/10 rounded-lg p-4 text-sm text-gray-300">
            <p>Benefits of verification:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-gray-400">
              <li>Access to tokens requiring Civic verification</li>
              <li>Higher trust score on the platform</li>
              <li>Bypass anti-snipe restrictions on some launches</li>
            </ul>
          </div>
        </div>
      ) : isPending ? (
        <div className="space-y-4">
          <div className="flex items-center space-x-3 text-yellow-400">
              <AppLoader size={50}  />
            <div>
              <p className="font-medium">Verification Pending</p>
              <p className="text-sm text-gray-400">
                Your verification is being processed
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-gray-400 text-sm">
            Verify your identity with Civic to access exclusive token launches 
            and improve your trust score on the platform.
          </p>
          
          <div className="bg-gray-800/50 rounded-lg p-4 text-sm">
            <p className="text-gray-300 mb-2">What you&apos;ll need:</p>
            <ul className="list-disc list-inside space-y-1 text-gray-400">
              <li>A valid government ID or passport</li>
              <li>A device with a camera for liveness check</li>
              <li>About 2-3 minutes to complete</li>
            </ul>
          </div>

          <button
            onClick={handleVerify}
            disabled={isVerifying || !gateway}
            className="w-full btn-primary flex items-center justify-center space-x-2 disabled:opacity-50"
          >
            {isVerifying ? (
              <>
                <AppLoader size={50} />
                <span>Starting Verification...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-5 h-5" />
                <span>Verify with Civic</span>
              </>
            )}
          </button>

          <a
            href="https://civic.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center space-x-1 text-xs text-gray-500 hover:text-gray-400"
          >
            <span>Powered by Civic</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
};

// Hook to check civic verification status
export function useCivicVerification() {
  const gateway = useGateway();
  const wallet = useWallet();

  return {
    isVerified: gateway?.gatewayStatus === GatewayStatus.ACTIVE,
    isPending: gateway?.gatewayStatus === GatewayStatus.CHECKING || gateway?.gatewayStatus === GatewayStatus.IN_REVIEW,
    isConnected: wallet.connected,
    requestVerification: gateway?.requestGatewayToken,
    gatewayStatus: gateway?.gatewayStatus,
  };
}
