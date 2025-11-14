'use client'

import type React from 'react'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { WalletContextType, WalletState, WalletTransaction } from '@/types/wallet'
import { nwc } from '@getalby/sdk'
import { toast } from '@/hooks/use-toast'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { useAPI } from '@/providers/api'
import { decode as decodeBolt11 } from 'light-bolt11-decoder'

export const WalletContext = createContext<WalletContextType | undefined>(
  undefined
)

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [walletState, setWalletState] = useState<WalletState>({
    lightningAddress: null,
    nwcUri: null,
    balance: 0
  })
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])

  const [nwcObject, setNwcObject] = useState<nwc.NWCClient | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)
  const { userId, get, put, logout: logoutApi } = useAPI()
  const prevBalanceRef = useRef<number | undefined>(undefined)
  const hasBaselineRef = useRef(false)

  const appendTransaction = (tx: WalletTransaction) => {
    setTransactions(prev => {
      // De-duplicate naive: skip if same type+amount within ~10s window
      const exists = prev.some(p => p.type === tx.type && p.amountMsats === tx.amountMsats && Math.abs(p.createdAt - tx.createdAt) < 10_000)
      const next = exists ? prev : [tx, ...prev].slice(0, 200)
      try {
        const existingData = localStorage.getItem('wallet')
        let walletData: any = {}
        if (existingData) {
          walletData = JSON.parse(existingData)
        }
        localStorage.setItem(
          'wallet',
          JSON.stringify({
            ...walletData,
            transactions: next
          })
        )
      } catch {}
      return next
    })
  }

  const normalizeTxArray = (arr: any[]): WalletTransaction[] => {
    const out: WalletTransaction[] = []
    for (const t of arr) {
      try {
        // amount detection (prefer msats fields)
        let msats: number | undefined = undefined
        if (typeof t.amount_msat === 'number') msats = t.amount_msat
        else if (typeof t.amountMsat === 'number') msats = t.amountMsat
        else if (typeof t.msats === 'number') msats = t.msats
        else if (typeof t.amount === 'number') {
          // Some wallets send signed msats in amount
          msats = Math.abs(t.amount)
        }
        if (msats === undefined) continue
        // type detection
        let type: 'incoming' | 'outgoing' | undefined
        if (t.type === 'incoming' || t.type === 'outgoing') type = t.type
        else if (t.direction === 'in') type = 'incoming'
        else if (t.direction === 'out') type = 'outgoing'
        else if (typeof t.amount === 'number') type = t.amount >= 0 ? 'incoming' : 'outgoing'
        if (!type) continue
        // timestamp detection
        let createdAt: number | undefined
        if (typeof t.timestamp === 'number') {
          createdAt = t.timestamp * (t.timestamp < 2_000_000_000 ? 1000 : 1)
        } else if (typeof t.created_at === 'number') {
          createdAt = t.created_at * (t.created_at < 2_000_000_000 ? 1000 : 1)
        } else if (typeof t.time === 'number') {
          createdAt = t.time * (t.time < 2_000_000_000 ? 1000 : 1)
        } else if (typeof t.date === 'number') {
          createdAt = t.date * (t.date < 2_000_000_000 ? 1000 : 1)
        } else if (typeof t.date === 'string') {
          createdAt = Date.parse(t.date)
        }
        if (!createdAt || Number.isNaN(createdAt)) createdAt = Date.now()
        const description: string | undefined = t.description || t.memo || t.note || undefined
        const id = t.id || t.payment_hash || t.preimage || t.hash || `${createdAt}-${type}-${msats}`
        out.push({ id: String(id), type, amountMsats: msats, createdAt, description })
      } catch {
        // ignore bad entries
      }
    }
    // sort desc by time
    out.sort((a, b) => b.createdAt - a.createdAt)
    return out
  }

  const fetchTransactions = async () => {
    if (!nwcObject) return
    const anyNwc = nwcObject as any
    let raw: any
    try {
      if (typeof anyNwc.getTransactions === 'function') {
        raw = await anyNwc.getTransactions({ limit: 50 })
      } else if (typeof anyNwc.request === 'function') {
        try {
          raw = await anyNwc.request('get_transactions', { limit: 50 })
        } catch (e1) {
          raw = await anyNwc.request('list_transactions', { limit: 50 })
        }
      }
      let arr: any[] | undefined
      if (Array.isArray(raw)) arr = raw
      else if (Array.isArray(raw?.transactions)) arr = raw.transactions
      else if (Array.isArray(raw?.result?.transactions)) arr = raw.result.transactions
      if (arr && arr.length) {
        const norm = normalizeTxArray(arr)
        if (norm.length) {
          setTransactions(prev => {
            // merge & dedupe by id
            const map = new Map<string, WalletTransaction>()
            for (const tx of [...norm, ...prev]) {
              map.set(tx.id, tx)
            }
            const merged = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt).slice(0, 200)
            try {
              const existingData = localStorage.getItem('wallet')
              let walletData: any = existingData ? JSON.parse(existingData) : {}
              localStorage.setItem('wallet', JSON.stringify({ ...walletData, transactions: merged }))
            } catch {}
            return merged
          })
        }
      }
    } catch {
      // ignore if wallet doesn't support listing
    }
  }

  const refreshBalance = async (notification?: any) => {
    console.log(notification)

    let recognizedByNotification = false
    if (notification) {
      const n = (notification as any).notification ?? (notification as any)
      const typeRaw = n?.type as string | undefined
      const amountAny = n?.amount ?? n?.amount_msat ?? n?.amountMsat ?? n?.msats
      if (typeof amountAny === 'number') {
        // Normalize type using multiple possible fields
        let normalizedType: 'incoming' | 'outgoing' | undefined
        if (typeRaw === 'incoming' || typeRaw === 'outgoing') {
          normalizedType = typeRaw
        } else if (n?.direction === 'in') {
          normalizedType = 'incoming'
        } else if (n?.direction === 'out') {
          normalizedType = 'outgoing'
        } else if (typeof n?.amount === 'number') {
          normalizedType = n.amount > 0 ? 'incoming' : 'outgoing'
        }

        if (normalizedType) {
          recognizedByNotification = true
          const msats = Math.abs(Number(amountAny))
          const tx: WalletTransaction = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: normalizedType,
            amountMsats: msats,
            createdAt: Date.now()
          }
          appendTransaction(tx)
          toast({
            title: tx.type === 'incoming' ? 'Received' : 'Paid',
            variant: tx.type === 'incoming' ? 'default' : 'destructive',
            description: (
              <span className="flex items-center gap-2">
                {tx.type === 'incoming' ? (
                  <ArrowDownLeft className="w-4 h-4 text-green-600" />
                ) : (
                  <ArrowUpRight className="w-4 h-4 text-red-600" />
                )}
                {tx.type === 'incoming' ? '+' : '-'}
                {Math.round(tx.amountMsats / 1000)} sats
              </span>
            )
          })
        }
      }
    }

    try {
      const balance = await nwcObject?.getBalance()
      console.info('balance:', balance)
      const newBalance = balance?.balance ?? 0
      // Infer incoming tx by positive delta if no recognizable notification
      if (hasBaselineRef.current && prevBalanceRef.current !== undefined && !recognizedByNotification) {
        const delta = newBalance - prevBalanceRef.current
        if (delta > 0) {
          appendTransaction({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: 'incoming',
            amountMsats: delta,
            createdAt: Date.now()
          })
        }
      }
      prevBalanceRef.current = newBalance
      hasBaselineRef.current = true
      setWalletState(prev => ({ ...prev, balance: newBalance }))
      setIsConnected(true)
    } catch {
      setIsConnected(false)
    }
  }

  useEffect(() => {
    if (!walletState.nwcUri) {
      setNwcObject(null)
      nwcObject?.close()
      return
    }

    console.log('New nwc object')
    const nwcClient = new nwc.NWCClient({
      nostrWalletConnectUrl: walletState.nwcUri
    })
    setNwcObject(nwcClient)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletState.nwcUri])

  useEffect(() => {
    if (nwcObject) {
      nwcObject.subscribeNotifications(refreshBalance)
      // Set baseline and fetch initial data
      ;(async () => {
        await refreshBalance()
        await fetchTransactions()
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nwcObject])

  // Load wallet data from localStorage on mount
  useEffect(() => {
    const savedWallet = localStorage.getItem('wallet')
    if (savedWallet) {
      try {
        const parsed = JSON.parse(savedWallet)
        setWalletState(prev => ({
          ...prev,
          lightningAddress: parsed.lightningAddress || null,
          nwcUri: parsed.nwcUri || null,
          balance: parsed.balance || 0
        }))
        if (Array.isArray(parsed.transactions)) {
          setTransactions(parsed.transactions)
        }
      } catch (error) {
        console.error('Failed to parse saved wallet data:', error)
      }
    }
    setIsHydrated(true)
  }, [])

  // Save wallet data to localStorage whenever it changes
  useEffect(() => {
    // Only save to localStorage after hydration is complete to avoid overwriting during initial load
    if (isHydrated) {
      const existingData = localStorage.getItem('wallet')
      let walletData = {}
      if (existingData) {
        try {
          walletData = JSON.parse(existingData)
        } catch (e) {
          console.error('Failed to parse existing wallet data:', e)
        }
      }
      localStorage.setItem(
        'wallet',
        JSON.stringify({
          ...walletData,
          lightningAddress: walletState.lightningAddress,
          nwcUri: walletState.nwcUri,
          balance: walletState.balance,
          transactions
        })
      )
    }
  }, [walletState, transactions, isHydrated])

  const setLightningAddress = async (username: string) => {
    if (!userId) {
      setWalletState(prev => ({
        ...prev,
        lightningAddress: username
      }))
      return
    }

    try {
      const { data, error } = await put(
        `/api/users/${userId}/lightning-address`,
        {
          username
        }
      )

      if (error) {
        throw new Error(error)
      }

      setWalletState(prev => ({
        ...prev,
        lightningAddress: data.lightningAddress
      }))

      return data
    } catch (error) {
      console.error('Error setting lightning address:', error)
      throw error
    }
  }

  const setNwcUri = async (nwcUri: string) => {
    if (!userId) {
      setWalletState(prev => ({ ...prev, nwcUri }))
      return
    }

    try {
      const { data, error } = await put(`/api/users/${userId}/nwc`, {
        nwcUri
      })

      if (error) {
        throw new Error(error)
      }

      setWalletState(prev => ({ ...prev, nwcUri: data.nwcUri }))

      return data
    } catch (error) {
      console.error('Error setting NWC URI:', error)
      throw error
    }
  }

  const getWalletData = async () => {
    const { data, error } = await get(`/api/users/wallet`)
    if (error) {
      throw new Error(error)
    }
    return data
  }

  const logout = () => {
    setWalletState({
      lightningAddress: null,
      nwcUri: null,
      balance: 0
    })
    localStorage.removeItem('wallet')
    logoutApi()
  }

  const payInvoice = async (invoice: string, amountSats?: number) => {
    if (!nwcObject) throw new Error('Wallet not connected')
    // amount is expected in millisats by most NWC wallets
    const params: any = { invoice }
    if (amountSats && amountSats > 0) {
      params.amount = amountSats * 1000
    }
    const anyNwc = nwcObject as any
    let raw: any
    // Try common SDK shapes for compatibility across versions
    try {
      raw = await anyNwc.payInvoice(params)
    } catch (e1) {
      try {
        raw = await anyNwc.payInvoice(invoice)
      } catch (e2) {
        if (typeof anyNwc.request === 'function') {
          raw = await anyNwc.request('pay_invoice', params)
        } else {
          throw e2
        }
      }
    }
    const preimage = raw?.preimage || raw?.result?.preimage || raw?.payment_preimage || raw?.payment?.preimage
    // Refresh balance immediately after a payment attempt (notification may arrive later)
    try {
      await refreshBalance()
    } catch {}
    // Append an outgoing transaction locally for immediate UI feedback
    try {
      let msats = typeof params.amount === 'number' ? params.amount : undefined
      if (!msats) {
        try {
          const dec: any = decodeBolt11(invoice)
          const amountSection = dec.sections?.find((s: any) => s.name === 'amount')
          const fromSection = amountSection ? Number(amountSection.value) : undefined
          msats = fromSection ?? (dec?.millisatoshis ? Number(dec.millisatoshis) : dec?.satoshis ? Number(dec.satoshis) * 1000 : undefined)
        } catch {}
      }
      if (msats && msats > 0) {
        appendTransaction({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'outgoing',
          amountMsats: msats,
          createdAt: Date.now()
        })
      }
    } catch {}
    return { preimage, raw }
  }

  const createInvoice = async (amountSats: number, description?: string) => {
    if (!nwcObject) throw new Error('Wallet not connected')
    if (!amountSats || amountSats <= 0) throw new Error('Amount must be greater than 0')
    const params: any = { amount: amountSats * 1000 }
    if (description) params.description = description
    const anyNwc = nwcObject as any
    let raw: any
    try {
      raw = await anyNwc.makeInvoice(params)
    } catch (e1) {
      try {
        raw = await anyNwc.request('make_invoice', params)
      } catch (e2) {
        throw e2
      }
    }
    const invoice = raw?.invoice || raw?.result?.invoice || raw?.paymentRequest || raw?.pr || raw?.bolt11
    if (!invoice) throw new Error('Failed to create invoice')
    return { invoice, raw }
  }

  const contextValue: WalletContextType = {
    ...walletState,
    getWalletData,
    setLightningAddress,
    setNwcUri,
    payInvoice,
    createInvoice,
    transactions,
    logout,
    isConnected,
    isHydrated
  }

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  )
}
