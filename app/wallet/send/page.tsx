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
  payeeNodeKey: string
  description?: string
  sections: any[] // Keep the raw sections for amount calculation
}

export default function SendPage() {
  const router = useRouter()
  const { payInvoice } = useWallet() // Assuming your hook exposes a `payInvoice` function
  const [invoice, setInvoice] = useState('')
  const [decodedInvoice, setDecodedInvoice] = useState<DecodedInvoice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  // This effect will try to decode the invoice whenever it changes
  useEffect(() => {
    if (invoice.trim() === '') {
      setDecodedInvoice(null)
      setError(null)
      return
    }

    try {
      const decoded = decode(invoice)
      const amountSection = decoded.sections.find(s => s.name === 'amount')
      const amountMsats = amountSection ? Number(amountSection.value) : 0

      setDecodedInvoice({
        amount: amountMsats / 1000, // Convert msats to sats
        payeeNodeKey: decoded.payeeNodeKey,
        description: decoded.sections.find(s => s.name === 'description')?.value,
        sections: decoded.sections
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
      const result = await payInvoice(invoice)
      if (result && result.preimage) {
        setIsSuccess(true)
      } else {
        throw new Error('Payment failed. The node returned an error.')
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
            className="mt-4 w-full max-w-xs"
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
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
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
                  <span className="font-bold text-lg">{formatSats(decodedInvoice.amount)} sats</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Recipient</span>
                  <span className="font-mono text-xs truncate">
                    {decodedInvoice.payeeNodeKey.substring(0, 20)}...
                  </span>
                </div>
                {decodedInvoice.description && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Description</span>
                    <span className="text-sm">{decodedInvoice.description}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Button
            size="lg"
            onClick={handleSend}
            disabled={!decodedInvoice || isSending || !payInvoice}
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
