'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Send, Loader2, AlertTriangle, CheckCircle } from 'lucide-react'
import { AppContent, AppNavbar, AppViewport } from '@/components/app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useWallet } from '@/hooks/use-wallet'
import { decode } from 'light-bolt11-decoder'
import type { LUD06Response, LUD06CallbackSuccess } from '@/types/lnurl'

// The 'Decoded' type from the library is more detailed, but we'll use a simplified version.
interface DecodedInvoice {
  amount: number
  paymentHash?: string
  recipient?: string
  description?: string
  sections: any[] // Keep the raw sections for amount calculation
}

// Minimal helpers to support LNURL strings and Lightning Addresses
const BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
function bech32Polymod(values: number[]) {
  const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const v of values) {
    const b = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) {
      if (((b >> i) & 1) !== 0) chk ^= GENERATORS[i]
    }
  }
  return chk
}
function bech32HrpExpand(hrp: string) {
  const ret: number[] = []
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5)
  ret.push(0)
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31)
  return ret
}
function bech32Decode(s: string): { hrp: string; words: number[] } | null {
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) return null
  s = s.toLowerCase()
  const pos = s.lastIndexOf('1')
  if (pos < 1 || pos + 7 > s.length) return null
  const hrp = s.substring(0, pos)
  const data = s.substring(pos + 1)
  const words: number[] = []
  for (let i = 0; i < data.length; i++) {
    const c = data[i]
    const v = BECH32_ALPHABET.indexOf(c)
    if (v === -1) return null
    words.push(v)
  }
  if (bech32Polymod([...bech32HrpExpand(hrp), ...words]) !== 1) return null
  return { hrp, words: words.slice(0, -6) }
}
function convertBits(data: number[], from: number, to: number, pad = true) {
  let acc = 0
  let bits = 0
  const ret: number[] = []
  const maxv = (1 << to) - 1
  for (const value of data) {
    if (value < 0 || value >> from !== 0) return null
    acc = (acc << from) | value
    bits += from
    while (bits >= to) {
      bits -= to
      ret.push((acc >> bits) & maxv)
    }
  }
  if (pad) {
    if (bits > 0) ret.push((acc << (to - bits)) & maxv)
  } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
    return null
  }
  return ret
}
function decodeLnurlString(input: string): string | null {
  const cleaned = input.trim().replace(/^lightning:/i, '')
  if (!/^lnurl[0-9a-z]+$/i.test(cleaned)) return null
  const dec = bech32Decode(cleaned)
  if (!dec) return null
  const bytes = convertBits(dec.words, 5, 8, false)
  if (!bytes) return null
  try {
    const url = new TextDecoder().decode(new Uint8Array(bytes))
    return url
  } catch {
    return null
  }
}
function isLightningAddress(input: string) {
  const s = input.trim()
  return /.+@.+\..+/.test(s)
}
async function resolveLightningAddress(addr: string): Promise<LUD06Response> {
  const [name, host] = addr.trim().split('@')
  const url = `https://${host}/.well-known/lnurlp/${encodeURIComponent(name)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to resolve lightning address: ${res.status}`)
  return (await res.json()) as LUD06Response
}
async function resolveLnurl(input: string): Promise<{ info: LUD06Response; domain: string }> {
  let url = decodeLnurlString(input)
  let domain = ''
  if (!url) {
    if (/^https?:\/\//i.test(input)) url = input.trim()
  }
  if (url) {
    const u = new URL(url)
    domain = u.hostname
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch LNURL: ${res.status}`)
    const info = (await res.json()) as LUD06Response
    if (info.tag !== 'payRequest') throw new Error('LNURL is not a payRequest')
    return { info, domain }
  }
  if (isLightningAddress(input)) {
    const info = await resolveLightningAddress(input)
    const host = input.split('@')[1]
    return { info, domain: host }
  }
  throw new Error('Invalid LNURL')
}

export default function SendPage() {
  const router = useRouter()
  const { payInvoice, isConnected } = useWallet()
  const [invoice, setInvoice] = useState('')
  const [decodedInvoice, setDecodedInvoice] = useState<DecodedInvoice | null>(null)
  const [userAmount, setUserAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [lnurlInfo, setLnurlInfo] = useState<LUD06Response | null>(null)
  const [lnurlDomain, setLnurlDomain] = useState<string>('')
  const [lnurlComment, setLnurlComment] = useState<string>('')
  const [isResolvingLnurl, setIsResolvingLnurl] = useState(false)

  // Prefill invoice from query string without useSearchParams (avoids Suspense requirement)
  useEffect(() => {
    try {
      const qs = typeof window !== 'undefined' ? window.location.search : ''
      if (!qs) return
      const params = new URLSearchParams(qs)
      const qp = params.get('invoice')
      if (qp && !invoice) {
        const cleaned = qp.trim().replace(/^lightning:/i, '')
        setInvoice(cleaned)
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // This effect will try to decode the invoice whenever it changes
  useEffect(() => {
    if (invoice.trim() === '') {
      setDecodedInvoice(null)
      setLnurlInfo(null)
      setLnurlDomain('')
      setLnurlComment('')
      setError(null)
      setUserAmount('')
      return
    }

    try {
      const normalized = invoice.trim().replace(/^lightning:/i, '').toLowerCase()
      const decodedAny: any = decode(normalized)
      const amountSection = decodedAny.sections?.find((s: any) => s.name === 'amount')
      const amountMsatsFromSection = amountSection ? Number(amountSection.value) : undefined
      const amountMsats =
        amountMsatsFromSection ??
        (decodedAny?.millisatoshis ? Number(decodedAny.millisatoshis) : undefined) ??
        (decodedAny?.satoshis ? Number(decodedAny.satoshis) * 1000 : 0)

  const paymentHashSection = decodedAny.sections?.find((s: any) => s.name === 'payment_hash') as any
  const paymentHash = paymentHashSection?.value as string | undefined
  const description = decodedAny.sections?.find((s: any) => s.name === 'description')?.value as string | undefined
  const payeeSection = decodedAny.sections?.find((s: any) => s.name === 'payee_node_key') as any
  const recipient = (payeeSection?.value as string | undefined) || (decodedAny.payeeNodeKey as string | undefined)

      setDecodedInvoice({
        amount: (amountMsats || 0) / 1000, // Convert msats to sats
        paymentHash,
        recipient,
        description,
        sections: decodedAny.sections ?? []
      })
      setLnurlInfo(null)
      setLnurlDomain('')
      setLnurlComment('')
      setError(null)
    } catch (e) {
      // Not a BOLT11. Try LNURL/LN Address.
      setDecodedInvoice(null)
      ;(async () => {
        try {
          setIsResolvingLnurl(true)
          const { info, domain } = await resolveLnurl(invoice)
          if (info.tag !== 'payRequest') throw new Error('LNURL is not a payRequest')
          setLnurlInfo(info)
          setLnurlDomain(domain)
          setError(null)
          if (!userAmount && info.minSendable) {
            setUserAmount(String(Math.ceil(info.minSendable / 1000)))
          }
        } catch (lnerr) {
          setLnurlInfo(null)
          setLnurlDomain('')
          setError('Invalid Lightning invoice or LNURL. Please check the code and try again.')
        } finally {
          setIsResolvingLnurl(false)
        }
      })()
    }
  }, [invoice])

  const handleSend = async () => {
    if ((!decodedInvoice && !lnurlInfo) || !payInvoice) return

    setIsSending(true)
    setError(null)

    try {
      if (lnurlInfo) {
        const amountSats = Number(userAmount)
        if (!amountSats || amountSats <= 0) {
          throw new Error('Please enter a valid amount in sats for this LNURL.')
        }
        const msats = amountSats * 1000
        if (msats < lnurlInfo.minSendable || msats > lnurlInfo.maxSendable) {
          const min = Math.ceil(lnurlInfo.minSendable / 1000)
          const max = Math.floor(lnurlInfo.maxSendable / 1000)
          throw new Error(`Amount must be between ${min} and ${max} sats.`)
        }
        const u = new URL(lnurlInfo.callback)
        u.searchParams.set('amount', String(msats))
        if (lnurlInfo.commentAllowed && lnurlInfo.commentAllowed > 0 && lnurlComment) {
          const trimmed = lnurlComment.slice(0, lnurlInfo.commentAllowed)
          u.searchParams.set('comment', trimmed)
        }
        const res = await fetch(u.toString())
        if (!res.ok) throw new Error(`LNURL callback failed: ${res.status}`)
        const cb = (await res.json()) as LUD06CallbackSuccess | { status: 'ERROR'; reason: string }
        if ((cb as any).status === 'ERROR') {
          throw new Error((cb as any).reason || 'LNURL callback error')
        }
        const pr = (cb as LUD06CallbackSuccess).pr
        const payRes = await payInvoice(pr)
        if (payRes) {
          setIsSuccess(true)
          return
        }
        setIsSuccess(true)
        return
      }

      const inv = decodedInvoice as DecodedInvoice
      const needsAmount = inv.amount === 0
      const amountSats = needsAmount ? Number(userAmount) : undefined
      if (needsAmount && (!amountSats || amountSats <= 0)) {
        throw new Error('Please enter a valid amount in sats for this invoice.')
      }

  const normalizedToPay = invoice.trim().replace(/^lightning:/i, '').toLowerCase()
  const result = await payInvoice(normalizedToPay, amountSats)
      // Treat absence of an explicit preimage as success if no exception was thrown.
      if (result && (result.preimage || result.raw)) {
        setIsSuccess(true)
      } else {
        // If wallet returns nothing but no error was thrown, consider it success.
        setIsSuccess(true)
      }
    } catch (e: any) {
      setError(e.message || 'Failed to send payment. Please try again.')
    } finally {
      setIsSending(false)
    }
  }

  const formatSats = (sats: number) => {
    return new Intl.NumberFormat().format(sats)
  }

  if (isSuccess) {
    return (
      <AppViewport>
        <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-4">
          <CheckCircle className="h-16 w-16 text-green-500" />
          <h2 className="text-2xl font-bold text-white">Payment Sent!</h2>
          <p className="text-muted-foreground">The payment has been successfully sent.</p>
          <Button
            size="lg"
            onClick={() => {
              const sats = lnurlInfo
                ? Number(userAmount) || 0
                : decodedInvoice?.amount && decodedInvoice.amount > 0
                ? decodedInvoice.amount
                : Number(userAmount) || 0
              const url = sats > 0 ? `/wallet?animateFromSats=${sats}` : '/wallet'
              router.push(url)
            }}
            className="mt-4 w-full max-w-xs bg-gray-800 hover:bg-gray-700 text-white"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Wallet
          </Button>
        </div>
      </AppViewport>
    )
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
        <h2 className="font-semibold text-white">Send Payment</h2>
      </AppNavbar>
      <AppContent>
        <div className="container flex flex-col gap-6">
          <div className="grid w-full items-center gap-2">
            <Label htmlFor="invoice">Lightning Invoice or LNURL</Label>
            <Input
              id="invoice"
              type="text"
              placeholder="lnbc... or LNURL... or name@domain"
              value={invoice}
              onChange={(e) => setInvoice(e.target.value)}
              disabled={isSending}
              className="text-sm"
            />
          </div>

          {!isConnected && (
            <Alert>
              <AlertTitle>Wallet not connected</AlertTitle>
              <AlertDescription>
                Connect your Nostr Wallet (NWC) in Wallet settings to send payments.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {decodedInvoice && (
            <Card className="bg-gray-900/50 border-gray-800">
              <CardHeader>
                <CardTitle>Payment Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-bold text-lg text-white">{formatSats(decodedInvoice.amount || Number(userAmount) || 0)} sats</span>
                </div>
                {decodedInvoice.recipient && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Recipient</span>
                    <span className="font-mono text-xs truncate text-white">
                      {`${decodedInvoice.recipient.substring(0, 20)}...`}
                    </span>
                  </div>
                )}
                {decodedInvoice.description && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Description</span>
                    <span className="text-sm text-white">{decodedInvoice.description}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {lnurlInfo && (
            <Card className="bg-gray-900/50 border-gray-800">
              <CardHeader>
                <CardTitle>LNURL Payment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Domain</span>
                  <span className="font-mono text-xs text-white">{lnurlDomain}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Allowed range</span>
                  <span className="text-sm text-white">{Math.ceil(lnurlInfo.minSendable / 1000)} - {Math.floor(lnurlInfo.maxSendable / 1000)} sats</span>
                </div>
              </CardContent>
            </Card>
          )}

          {(decodedInvoice?.amount === 0 || lnurlInfo) && (
            <div className="grid w-full items-center gap-2">
              <Label htmlFor="amount">Amount (sats)</Label>
              <Input
                id="amount"
                type="number"
                inputMode="numeric"
                min={lnurlInfo ? Math.ceil(lnurlInfo.minSendable / 1000) : 1}
                max={lnurlInfo ? Math.floor(lnurlInfo.maxSendable / 1000) : undefined}
                placeholder={lnurlInfo ? `Between ${Math.ceil(lnurlInfo.minSendable / 1000)} and ${Math.floor(lnurlInfo.maxSendable / 1000)} sats` : 'Enter amount in sats'}
                value={userAmount}
                onChange={(e) => setUserAmount(e.target.value)}
                disabled={isSending}
                className="text-sm"
              />
            </div>
          )}

          {lnurlInfo && lnurlInfo.commentAllowed && lnurlInfo.commentAllowed > 0 && (
            <div className="grid w-full items-center gap-2">
              <Label htmlFor="lnurl-comment">Description (optional)</Label>
              <Input
                id="lnurl-comment"
                type="text"
                placeholder={`Up to ${lnurlInfo.commentAllowed} characters`}
                value={lnurlComment}
                onChange={(e) => setLnurlComment(e.target.value)}
                disabled={isSending}
                className="text-sm"
              />
            </div>
          )}

          <Button
            size="lg"
            onClick={handleSend}
            disabled={
              (!decodedInvoice && !lnurlInfo) ||
              isSending ||
              !payInvoice ||
              !isConnected ||
              (((decodedInvoice?.amount === 0) || !!lnurlInfo) && (!userAmount || Number(userAmount) <= 0))
            }
            className="w-full"
          >
            {isSending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                {lnurlInfo ? 'Confirm & Send via LNURL' : 'Confirm & Send'}
              </>
            )}
          </Button>
        </div>
      </AppContent>
    </AppViewport>
  )
}
