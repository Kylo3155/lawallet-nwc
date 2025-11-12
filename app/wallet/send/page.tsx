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
// A library to decode BOLT11 invoices will be needed.
// For now, we'll use a placeholder.
// import { decode } from 'light-bolt11-decoder'

// Placeholder for decoded invoice details
interface DecodedInvoice {
  amount: number
  payeeNodeKey: string
  description?: string
}

export default function SendPage() {
  const router = useRouter()
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
      // ** Placeholder Decoding Logic **
      // Replace this with a real invoice decoding library
      if (!invoice.startsWith('lnbc')) {
        throw new Error('Not a valid Lightning invoice.')
      }
      
      // Simulate decoding
      const amount = parseInt(invoice.substring(4, 10), 10) || 100000 // Example amount in millisats
      const payee = '03' + 'a'.repeat(64) // Example payee pubkey
      
      setDecodedInvoice({
        amount: amount / 1000, // Convert to sats
        payeeNodeKey: payee,
        description: 'Test Invoice Description'
      })
      setError(null)
    } catch (e) {
      setDecodedInvoice(null)
      setError('Invalid Lightning invoice. Please check the code and try again.')
    }
  }, [invoice])

  const handleSend = async () => {
    if (!decodedInvoice) return

    setIsSending(true)
    setError(null)

    try {
      // ** Placeholder Send Logic **
      // Here you would integrate with your wallet's NWC send function
      console.log('Sending payment for invoice:', invoice)
      await new Promise(resolve => setTimeout(resolve, 2000)) // Simulate network delay

      // On success:
      setIsSuccess(true)
      setTimeout(() => {
        router.push('/wallet')
      }, 3000)

    } catch (e) {
      setError('Failed to send payment. Please try again.')
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
        <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
          <CheckCircle className="h-16 w-16 text-green-500" />
          <h2 className="text-2xl font-bold">Payment Sent!</h2>
          <p className="text-muted-foreground">Redirecting you back to the wallet...</p>
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
        <div className="w-9 h-9" /> {/* Spacer */}
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
            disabled={!decodedInvoice || isSending}
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
