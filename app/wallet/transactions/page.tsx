"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppViewport, AppNavbar, AppContent } from '@/components/app'
import { Button } from '@/components/ui/button'
import { useWallet } from '@/hooks/use-wallet'
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, Trash2 } from 'lucide-react'

export default function TransactionsPage() {
  const router = useRouter()
  const { transactions, clearTransactions } = useWallet()
  const [showDelete, setShowDelete] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      setShowDelete(localStorage.getItem('walletDebug') === 'true')
    } catch {}
  }, [])

  const formatRelative = (ts: number) => {
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    const diffMs = Date.now() - ts
    const sec = Math.round(diffMs / 1000)
    if (Math.abs(sec) < 60) return rtf.format(-sec, 'second')
    const min = Math.round(sec / 60)
    if (Math.abs(min) < 60) return rtf.format(-min, 'minute')
    const hrs = Math.round(min / 60)
    if (Math.abs(hrs) < 24) return rtf.format(-hrs, 'hour')
    const days = Math.round(hrs / 24)
    if (Math.abs(days) < 30) return rtf.format(-days, 'day')
    const months = Math.round(days / 30)
    if (Math.abs(months) < 12) return rtf.format(-months, 'month')
    const years = Math.round(months / 12)
    return rtf.format(-years, 'year')
  }

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
        {showDelete ? (
          <Button
            variant="ghost"
            size="icon"
            className="bg-red-600/20 hover:bg-red-600/30 text-red-400"
            title="Clear transaction history"
            onClick={() => {
              if (confirm('Clear all local & server transactions? This cannot be undone.')) {
                clearTransactions()
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : (
          <div />
        )}
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
                      <span
                        className="text-xs text-muted-foreground"
                        title={new Date(tx.createdAt).toLocaleString()}
                      >
                        {formatRelative(tx.createdAt)}
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
