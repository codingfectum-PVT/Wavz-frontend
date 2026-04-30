export const dynamic = 'force-dynamic';

import { CreateTokenForm } from '@/components/create/CreateTokenForm';

export default function CreatePage() {
  return (
    <div className="mx-auto max-w-[1500px] rounded-2xl p-4 md:p-1">
      <div className="space-y-2 mb-8">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-[#FFAC4C] to-[#FE9216] bg-clip-text text-transparent">
          Create New Token
        </h1>
        <p className="text-gray-500">
          Launch your token with a fair bonding curve.        </p>
      </div>
      <CreateTokenForm />
    </div>
  );
}
