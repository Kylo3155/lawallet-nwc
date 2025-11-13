"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppViewport, AppNavbar, AppContent } from '@/components/app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ArrowLeft, Loader2, Copy, QrCode } from 'lucide-react'
import { useWallet } from '@/hooks/use-wallet'
import { QRCodeSVG } from 'qrcode.react'

export default function ReceivePage() {
  const router = useRouter()
  const { createInvoice, isConnected } = useWallet()
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [invoice, setInvoice] = useState<string>('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showForm, setShowForm] = useState(true)

  const handleGenerate = async () => {
    if (!createInvoice) return
    setError(null)
    setIsGenerating(true)
    setInvoice('')
    try {
      const amt = Number(amount)
      if (!amt || amt <= 0) throw new Error('Enter a valid amount in sats')
      const { invoice: pr } = await createInvoice(amt, description.trim() || undefined)
      setInvoice(pr)
      setShowForm(false)
    } catch (e: any) {
      setError(e.message || 'Failed to create invoice')
    } finally {
      setIsGenerating(false)
    }
  }

  const copyInvoice = async () => {
    try {
      await navigator.clipboard.writeText(invoice)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
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
        <h2 className="font-semibold text-white">Receive (Generate Invoice)</h2>
        <div />
      </AppNavbar>
      <AppContent>
        <div className="container flex flex-col gap-6">
          {!isConnected && (
            <Alert>
              <AlertTitle>Wallet not connected</AlertTitle>
              <AlertDescription>Connect your wallet in settings to generate invoices.</AlertDescription>
            </Alert>
          )}

          {showForm && (
            <Card className="bg-gray-900/50 border-gray-800">
              <CardHeader>
                <CardTitle>Create Lightning Invoice</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid w-full gap-2">
                  <Label htmlFor="amount">Amount (sats)</Label>
                  <Input
                    id="amount"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    placeholder="Enter amount in sats"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={isGenerating}
                    className="text-sm"
                  />
                </div>
                <div className="grid w-full gap-2">
                  <Label htmlFor="description">Description (optional)</Label>
                  <Input
                    id="description"
                    type="text"
                    placeholder="Description to include"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={isGenerating}
                    className="text-sm"
                  />
                </div>
                <Button
                  size="lg"
                  onClick={handleGenerate}
                  disabled={!isConnected || isGenerating || !amount || Number(amount) <= 0}
                  className="w-full"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <QrCode className="mr-2 h-4 w-4" />
                      Generate Invoice
                    </>
                  )}
                </Button>
                {error && (
                  <Alert variant="destructive">
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}

          {invoice && !showForm && (
            <Card className="bg-gray-900/50 border-gray-800">
              <CardHeader>
                <CardTitle>Your Invoice</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-4">
                <div className="bg-white p-4 rounded-lg">
                  <QRCodeSVG value={invoice} size={220} />
                </div>
                <div className="w-full break-all font-mono text-xs bg-black/40 p-3 rounded-md text-white max-h-40 overflow-auto">
                  {invoice}
                </div>
                <Button
                  variant="secondary"
                  onClick={copyInvoice}
                  className="w-full bg-gray-800 hover:bg-gray-700 text-white"
                >
                  <Copy className="mr-2 h-4 w-4" />
                  {copied ? 'Copied!' : 'Copy Invoice'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    // Show form again for new invoice; keep last values cleared
                    setInvoice('')
                    setAmount('')
                    setDescription('')
                    setShowForm(true)
                    setCopied(false)
                  }}
                  className="w-full"
                >
                  Generate Another
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </AppContent>
    </AppViewport>
  )
}
