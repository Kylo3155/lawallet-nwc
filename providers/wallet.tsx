'use client'

import type React from 'react'
import { createContext, useContext, useEffect, useState } from 'react'
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

  const appendTransaction = (tx: WalletTransaction) => {
    setTransactions(prev => {
      const next = [tx, ...prev].slice(0, 200)
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

  const refreshBalance = async (notification?: any) => {
    console.log(notification)

    if (notification) {
      const n = (notification as any).notification ?? (notification as any)
      const typeRaw = n?.type as string | undefined
      const amountAny = n?.amount ?? n?.amount_msat ?? n?.amountMsat ?? n?.msats
      if (typeof amountAny === 'number' && (typeRaw === 'incoming' || typeRaw === 'outgoing')) {
        const tx: WalletTransaction = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: typeRaw === 'incoming' ? 'incoming' : 'outgoing',
          amountMsats: amountAny,
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

    try {
      const balance = await nwcObject?.getBalance()
      console.info('balance:', balance)
      setWalletState(prev => ({ ...prev, balance: balance?.balance ?? 0 }))
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
      refreshBalance()
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
