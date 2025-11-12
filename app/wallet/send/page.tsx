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

// The 'Decoded' type from the library is more detailed, but we'll use a simplified version.
interface DecodedInvoice {
  amount: number
  paymentHash?: string
  recipient?: string
  description?: string
  sections: any[] // Keep the raw sections for amount calculation
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

  // This effect will try to decode the invoice whenever it changes
  useEffect(() => {
    if (invoice.trim() === '') {
      setDecodedInvoice(null)
      setError(null)
      setUserAmount('')
      return
    }

    try {
      const normalized = invoice.trim().toLowerCase()
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
      setError(null)
    } catch (e) {
      setDecodedInvoice(null)
      setError('Invalid Lightning invoice. Please check the code and try again.')
    }
  }, [invoice])

  const handleSend = async () => {
    if (!decodedInvoice || !payInvoice) return

    setIsSending(true)
    setError(null)

    try {
      const needsAmount = decodedInvoice.amount === 0
      const amountSats = needsAmount ? Number(userAmount) : undefined
      if (needsAmount && (!amountSats || amountSats <= 0)) {
        throw new Error('Please enter a valid amount in sats for this invoice.')
      }

      const result = await payInvoice(invoice, amountSats)
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
          <h2 className="text-2xl font-bold">Payment Sent!</h2>
          <p className="text-muted-foreground">The invoice has been successfully paid.</p>
          <Button
            size="lg"
            onClick={() => router.push('/wallet')}
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
        <h2 className="font-semibold">Send Payment</h2>
        <Button variant="ghost" size="icon" onClick={() => router.push('/wallet')}>
          Wallet
        </Button>
      </AppNavbar>
      <AppContent>
        <div className="container flex flex-col gap-6">
          <div className="grid w-full items-center gap-2">
            <Label htmlFor="invoice">Lightning Invoice</Label>
            <Input
              id="invoice"
              type="text"
              placeholder="lnbc..."
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

          {decodedInvoice?.amount === 0 && (
            <div className="grid w-full items-center gap-2">
              <Label htmlFor="amount">Amount (sats)</Label>
              <Input
                id="amount"
                type="number"
                inputMode="numeric"
                min={1}
                placeholder="Enter amount in sats"
                value={userAmount}
                onChange={(e) => setUserAmount(e.target.value)}
                disabled={isSending}
                className="text-sm"
              />
            </div>
          )}

          <Button
            size="lg"
            onClick={handleSend}
            disabled={
              !decodedInvoice ||
              isSending ||
              !payInvoice ||
              !isConnected ||
              (decodedInvoice.amount === 0 && (!userAmount || Number(userAmount) <= 0))
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
                Confirm & Send
              </>
            )}
          </Button>
        </div>
      </AppContent>
    </AppViewport>
  )
}
