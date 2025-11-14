"use client"

import { useRouter } from 'next/navigation'
import { AppViewport, AppNavbar, AppContent } from '@/components/app'
import { Button } from '@/components/ui/button'
import { useWallet } from '@/hooks/use-wallet'
import { ArrowLeft, ArrowDownLeft, ArrowUpRight } from 'lucide-react'

export default function TransactionsPage() {
  const router = useRouter()
  const { transactions } = useWallet()

  return (
    <AppViewport>
      <AppNavbar>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.back()}
          className="bg-gray-800 hover:bg-gray-700 text-white"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="font-semibold text-white">Transactions</h2>
        <div />
      </AppNavbar>
      <AppContent>
        <div className="container flex flex-col gap-4">
          {(!transactions || transactions.length === 0) ? (
            <p className="text-muted-foreground">No transactions yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {transactions.map(tx => (
                <div key={tx.id} className="flex items-center justify-between border p-3 rounded-xl bg-black/40">
                  <div className="flex items-center gap-3">
                    {tx.type === 'incoming' ? (
                      <ArrowDownLeft className="w-5 h-5 text-green-500" />
                    ) : (
                      <ArrowUpRight className="w-5 h-5 text-red-500" />
                    )}
                    <div className="flex flex-col">
                      <span className="text-sm text-white font-medium">
                        {tx.type === 'incoming' ? 'Received' : 'Sent'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(tx.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="text-white font-bold">
                    {Math.round(tx.amountMsats / 1000)} sats
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </AppContent>
    </AppViewport>
  )
}
