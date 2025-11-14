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
  const { userId, get, post, put, logout: logoutApi } = useAPI()
  const prevBalanceRef = useRef<number | undefined>(undefined)
  const hasBaselineRef = useRef(false)
  const postedIdsRef = useRef<Set<string>>(new Set())
  const manualOutgoRef = useRef<{ amountMsats: number; ts: number }[]>([])

  const appendTransaction = (tx: WalletTransaction) => {
    setTransactions(prev => {
      // De-duplicate only by identical id (safer; direction/amount can legitimately repeat)
      const exists = prev.some(p => p.id === tx.id)
      const txWithPersistFlag = exists ? tx : { ...tx, _persisted: postedIdsRef.current.has(tx.id) }
      const next = exists ? prev : [txWithPersistFlag, ...prev].slice(0, 200)
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
    // Best-effort server persistence (requires authenticated API)
    ;(async () => {
      try {
        if (userId && !postedIdsRef.current.has(tx.id)) {
          const res = await post('/api/transactions', {
            type: tx.type,
            amountMsats: tx.amountMsats,
            description: tx.description,
            createdAt: tx.createdAt,
            externalId: tx.id
          })
          if (!res.error) {
            postedIdsRef.current.add(tx.id)
            setTransactions(prev => prev.map(p => p.id === tx.id ? { ...p, _persisted: true } : p))
          }
        }
      } catch {}
    })()
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
    // 1) Try server-side history first (cross-device, deduped)
    try {
      if (userId) {
        const { data } = await get<{ transactions: any[] }>(
          `/api/transactions?limit=50`
        )
        const serverArr = Array.isArray((data as any)?.transactions)
          ? (data as any).transactions
          : []
        if (serverArr.length) {
          const normalized: WalletTransaction[] = serverArr
            .map((t: any) => ({
              id: String(t.id ?? t.externalId ?? `${t.createdAt}-${t.type}-${t.amountMsats}`),
              type: t.type,
              amountMsats: Number(t.amountMsats),
              description: t.description || undefined,
              createdAt: typeof t.createdAt === 'string' || t.createdAt instanceof Date
                ? new Date(t.createdAt).getTime()
                : Number(t.createdAt) || Date.now(),
              _persisted: true
            }))
            .filter(
              (t: WalletTransaction) =>
                t.amountMsats > 0 && (t.type === 'incoming' || t.type === 'outgoing')
            )
          if (normalized.length) {
            setTransactions(prev => {
              const map = new Map<string, WalletTransaction>()
              for (const tx of [...normalized, ...prev]) map.set(tx.id, tx)
              const merged = Array.from(map.values())
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 200)
              try {
                const existingData = localStorage.getItem('wallet')
                let walletData: any = existingData ? JSON.parse(existingData) : {}
                localStorage.setItem(
                  'wallet',
                  JSON.stringify({ ...walletData, transactions: merged })
                )
              } catch {}
              return merged
            })
            // Register server-persisted IDs
            for (const tx of normalized) postedIdsRef.current.add(tx.id)
          }
        }
      }
    } catch {}

    // 2) Then try wallet-side listing via NWC (if supported)
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
              // if we already marked persisted, keep that flag
              const existing = map.get(tx.id)
              map.set(tx.id, existing ? { ...existing, ...tx } : tx)
            }
            const merged = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt).slice(0, 200)
            try {
              const existingData = localStorage.getItem('wallet')
              let walletData: any = existingData ? JSON.parse(existingData) : {}
              localStorage.setItem('wallet', JSON.stringify({ ...walletData, transactions: merged }))
            } catch {}
            return merged
          })
          // Persist any wallet-listed transactions not yet posted (particularly incoming)
          ;(async () => {
            if (userId) {
              for (const tx of norm) {
                if (!postedIdsRef.current.has(tx.id)) {
                  try {
                    const res = await post('/api/transactions', {
                      type: tx.type,
                      amountMsats: tx.amountMsats,
                      description: tx.description,
                      createdAt: tx.createdAt,
                      externalId: tx.id
                    })
                    if (!res.error) {
                      postedIdsRef.current.add(tx.id)
                      setTransactions(prev => prev.map(p => p.id === tx.id ? { ...p, _persisted: true } : p))
                    }
                  } catch {}
                }
              }
            }
          })()
        }
      }
    } catch {
      // ignore if wallet doesn't support listing
    }
  }

  const classifyNotification = (notification: any): WalletTransaction | null => {
    if (!notification) return null
    const n = (notification as any).notification ?? (notification as any)
    if (!n || typeof n !== 'object') return null
    // Extract amounts
    const rawAmount = n.amount ?? n.amount_msat ?? n.amountMsat ?? n.msats ?? n.value_msat ?? n.valueMsat
    const credit = n.credit_msat ?? n.creditMsat
    const debit = n.debit_msat ?? n.debitMsat
    const balanceChange = n.balance_change_msat ?? n.balanceChangeMsat ?? n.balance_delta ?? n.delta ?? (typeof credit === 'number' ? credit : typeof debit === 'number' ? -debit : undefined)
    const paymentHash = n.payment_hash || n.hash || n.id
    const createdTs = n.timestamp || n.time || n.created_at || n.date
    let createdAt: number
    if (typeof createdTs === 'number') {
      createdAt = createdTs * (createdTs < 2_000_000_000 ? 1000 : 1)
    } else if (typeof createdTs === 'string') {
      createdAt = Date.parse(createdTs)
    } else {
      createdAt = Date.now()
    }
    if (!rawAmount && !balanceChange) return null
    // Determine msats
    let msatsSource = typeof balanceChange === 'number' ? balanceChange : rawAmount
    if (typeof msatsSource !== 'number') return null
    const msatsAbs = Math.abs(msatsSource)
    // Determine type priority:
    // 1. Explicit direction field
    // 2. Explicit type strings containing receive/sent
    // 3. Balance change sign
    // 4. Raw amount sign
    let type: 'incoming' | 'outgoing' | undefined
    // Strong explicit credit/debit overrides others
    if (typeof credit === 'number' && credit > 0 && (!debit || debit === 0)) type = 'incoming'
    else if (typeof debit === 'number' && debit > 0 && (!credit || credit === 0)) type = 'outgoing'
    if (!type && n.direction === 'in') type = 'incoming'
    else if (!type && n.direction === 'out') type = 'outgoing'
    if (!type && typeof n.type === 'string') {
      const tLower = n.type.toLowerCase()
      if (/(receive|received|incoming|deposit|funds added)/.test(tLower)) type = 'incoming'
      else if (/(send|sent|outgoing|withdraw|spent|payment)/.test(tLower)) type = 'outgoing'
    }
    if (!type && typeof balanceChange === 'number') type = balanceChange > 0 ? 'incoming' : 'outgoing'
    if (!type && typeof rawAmount === 'number') type = rawAmount > 0 ? 'incoming' : 'outgoing'
    if (!type) return null
    const description = n.description || n.memo || n.note || undefined
    // Include type in id to prevent outgoing/incoming collision on same payment hash
    return {
      id: paymentHash ? `${paymentHash}-${type}` : `${createdAt}-${type}-${msatsAbs}-${Math.random().toString(36).slice(2,8)}`,
      type,
      amountMsats: msatsAbs,
      createdAt,
      description
    }
  }

  const refreshBalance = async (notification?: any) => {
    // Step 1: Fetch current balance early to compute reliable delta.
    let newBalance: number | undefined
    try {
      const balance = await nwcObject?.getBalance()
      newBalance = balance?.balance ?? 0
    } catch (e) {
      console.warn('Failed to fetch balance before classification', e)
    }

    const prevBalance = prevBalanceRef.current
    const haveBaseline = hasBaselineRef.current && typeof prevBalance === 'number'
    const delta = haveBaseline && typeof newBalance === 'number' ? newBalance - prevBalance : 0

    // Step 2: Classify notification into a candidate transaction.
    const debug = typeof window !== 'undefined' && localStorage.getItem('walletDebug') === 'true'
    const parsedTxOriginal = classifyNotification(notification)
    if (debug && notification) {
      try {
        console.log('[CLASSIFY_INPUT]', JSON.stringify(notification, null, 2))
      } catch {
        console.log('[CLASSIFY_INPUT]', notification)
      }
      console.log('[CLASSIFY_RESULT_INITIAL]', parsedTxOriginal)
    }
    let parsedTx = parsedTxOriginal ? { ...parsedTxOriginal } : null

    // Step 3: Override direction using balance delta if it contradicts classification.
    if (parsedTx && haveBaseline && delta !== 0) {
      const deltaDirection = delta > 0 ? 'incoming' : 'outgoing'
      // If classification type differs from delta direction AND amounts are similar, trust delta.
      if (parsedTx.type !== deltaDirection) {
        const satsTx = Math.round(parsedTx.amountMsats / 1000)
        const satsDelta = Math.abs(Math.round(delta / 1000))
        if (Math.abs(satsTx - satsDelta) <= 2 || satsTx === satsDelta) { // tolerance or exact match
          parsedTx.type = deltaDirection
          // Ensure ID remains unique with new direction suffix.
          if (parsedTx.id.includes('-incoming') || parsedTx.id.includes('-outgoing')) {
            parsedTx.id = parsedTx.id.replace(/-(incoming|outgoing)$/i, `-${deltaDirection}`)
          }
        }
        // Additional fallback: if delta positive and we classified outgoing but tx amount equals delta, force incoming.
        if (delta > 0 && parsedTx.type === 'outgoing' && satsTx === satsDelta) {
          parsedTx.type = 'incoming'
          if (parsedTx.id.includes('-outgoing')) {
            parsedTx.id = parsedTx.id.replace(/-outgoing$/i, '-incoming')
          } else {
            parsedTx.id = `${parsedTx.id}-incoming-fix`
          }
        }
        if (debug) console.log('[DELTA_ADJUST]', { delta, finalType: parsedTx.type })
      }
    }

    // Step 4: If no notification recognized but delta positive, create inferred incoming.
    if (!parsedTx && haveBaseline && delta > 0) {
      parsedTx = {
        id: `${Date.now()}-delta-${Math.random().toString(36).slice(2,8)}`,
        type: 'incoming',
        amountMsats: delta,
        createdAt: Date.now()
      }
      if (debug) console.log('[DELTA_INFER_INCOMING]', parsedTx)
    }

    // Step 5: Append and toast if we have a parsed/inferred transaction.
    if (parsedTx) {
      // Ensure incoming/outgoing sign consistency: incoming always positive msats
      if (parsedTx.type === 'incoming' && parsedTx.amountMsats < 0) {
        parsedTx.amountMsats = Math.abs(parsedTx.amountMsats)
      }
      if (parsedTx.type === 'outgoing' && parsedTx.amountMsats < 0) {
        // Outgoing amounts we store as positive magnitude
        parsedTx.amountMsats = Math.abs(parsedTx.amountMsats)
      }
      appendTransaction(parsedTx)
      if (debug) console.log('[APPENDED_TX]', parsedTx)
      toast({
        title: parsedTx.type === 'incoming' ? 'Received' : 'Paid',
        variant: parsedTx.type === 'incoming' ? 'default' : 'destructive',
        description: (
          <span className="flex items-center gap-2">
            {parsedTx.type === 'incoming' ? (
              <ArrowDownLeft className="w-4 h-4 text-green-600" />
            ) : (
              <ArrowUpRight className="w-4 h-4 text-red-600" />
            )}
            {parsedTx.type === 'incoming' ? '+' : '-'}
            {Math.round(parsedTx.amountMsats / 1000)} sats
          </span>
        )
      })
    }

    // Step 6: Update balance state & baseline.
    if (typeof newBalance === 'number') {
      prevBalanceRef.current = newBalance
      hasBaselineRef.current = true
      setWalletState(prev => ({ ...prev, balance: newBalance }))
      setIsConnected(true)
    }
  }

  // Pure delta-based detection (ignores notification content). Logs for debugging.
  const checkBalanceDelta = async () => {
    let newBalance: number | undefined
    try {
      const balance = await nwcObject?.getBalance()
      newBalance = balance?.balance ?? 0
    } catch {
      return
    }
    const prev = prevBalanceRef.current
    const haveBaseline = hasBaselineRef.current && typeof prev === 'number'
    const delta = haveBaseline && typeof newBalance === 'number' ? newBalance - prev : 0
    const debug = typeof window !== 'undefined' && localStorage.getItem('walletDebug') === 'true'
    if (debug) console.log('[DELTA_POLL]', { prev, newBalance, delta })
    if (delta !== 0) {
      const type: 'incoming' | 'outgoing' = delta > 0 ? 'incoming' : 'outgoing'
      const amountMsats = Math.abs(delta)
      // Suppress duplicate outgoing if it matches a recent manual payment
      if (type === 'outgoing') {
        const now = Date.now()
        const toleranceSats = 5
        const satsDelta = Math.round(amountMsats / 1000)
        const recent = manualOutgoRef.current.find(
          r => now - r.ts < 15000 && Math.abs(Math.round(r.amountMsats / 1000) - satsDelta) <= toleranceSats
        )
        if (recent) {
          // Consume the marker and skip appending duplicate
          manualOutgoRef.current = manualOutgoRef.current.filter(r => r !== recent)
          if (debug) console.log('[DELTA_SUPPRESS_OUTGOING]', { satsDelta, recent })
        } else {
          appendTransaction({
            id: `${now}-delta-out-${Math.random().toString(36).slice(2,8)}`,
            type: 'outgoing',
            amountMsats,
            createdAt: now
          })
          if (debug) console.log('[DELTA_ADD_OUTGOING]', { amountMsats })
        }
      } else {
        appendTransaction({
          id: `${Date.now()}-delta-in-${Math.random().toString(36).slice(2,8)}`,
          type: 'incoming',
          amountMsats,
          createdAt: Date.now()
        })
        if (debug) console.log('[DELTA_ADD_INCOMING]', { amountMsats })
      }
    }
    if (typeof newBalance === 'number') {
      prevBalanceRef.current = newBalance
      hasBaselineRef.current = true
      setWalletState(prev => ({ ...prev, balance: newBalance }))
      setIsConnected(true)
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
      // Use notifications only as a trigger; ignore content and rely on balance delta
      nwcObject.subscribeNotifications(() => {
        checkBalanceDelta()
      })
      ;(async () => {
        await checkBalanceDelta()
        await fetchTransactions()
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nwcObject])

  // Poll balance periodically to detect deltas when notifications are missing
  useEffect(() => {
    if (!nwcObject) return
    const id = setInterval(() => {
      checkBalanceDelta()
    }, 4000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nwcObject])

  // Also fetch server-side transactions when API user is available (even before NWC connects)
  useEffect(() => {
    if (userId) {
      fetchTransactions()
      // Backfill any existing local transactions not yet persisted (e.g., incoming before login)
      ;(async () => {
        for (const tx of transactions) {
          if (!postedIdsRef.current.has(tx.id)) {
            try {
              const res = await post('/api/transactions', {
                type: tx.type,
                amountMsats: tx.amountMsats,
                description: tx.description,
                createdAt: tx.createdAt,
                externalId: tx.id
              })
              if (!res.error) {
                postedIdsRef.current.add(tx.id)
                setTransactions(prev => prev.map(p => p.id === tx.id ? { ...p, _persisted: true } : p))
              }
            } catch {}
          }
        }
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

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
      let paymentHash: string | undefined
      if (!msats || !paymentHash) {
        try {
          const dec: any = decodeBolt11(invoice)
          const amountSection = dec.sections?.find((s: any) => s.name === 'amount')
          const fromSection = amountSection ? Number(amountSection.value) : undefined
          msats = msats || fromSection || (dec?.millisatoshis ? Number(dec.millisatoshis) : dec?.satoshis ? Number(dec.satoshis) * 1000 : undefined)
          paymentHash = dec?.paymentHash || dec?.payment_hash || dec?.sections?.find((s: any) => s.name === 'payment_hash')?.value
        } catch {}
      }
      if (msats && msats > 0) {
        const now = Date.now()
        appendTransaction({
          id: paymentHash ? String(paymentHash) : `${now}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'outgoing',
          amountMsats: msats,
          createdAt: now
        })
        // Mark as recent manual outgoing to suppress delta duplicate
        manualOutgoRef.current.push({ amountMsats: msats, ts: now })
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
