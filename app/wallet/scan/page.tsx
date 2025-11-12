'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppContent, AppNavbar, AppViewport } from '@/components/app'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { QRScanner } from '@/components/ui/qr-scanner'
import { ArrowLeft, QrCode } from 'lucide-react'

export default function ScanPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  const extractInvoice = (text: string): string | null => {
    if (!text) return null
    const cleaned = text.trim()
    const withoutScheme = cleaned.replace(/^lightning:/i, '')
    // Basic BOLT11 pattern detection (bech32-like), accept upper/lower case
    const candidate = withoutScheme
    if (/^ln(bc|tb|sb)/i.test(candidate)) {
      return candidate
    }
    return null
  }

  const handleScan = (result: string) => {
    const invoice = extractInvoice(result)
    if (invoice) {
      router.push(`/wallet/send?invoice=${encodeURIComponent(invoice)}`)
    } else {
      setError('Scanned code is not a valid Lightning invoice.')
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
        <h2 className="font-semibold text-white">Scan QR</h2>
        <div />
      </AppNavbar>
      <AppContent>
        <div className="container flex flex-col gap-6 items-center">
          {error && (
            <Alert variant="destructive" className="w-full max-w-md">
              <AlertTitle>Invalid code</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <QRScanner autoOpen hideTrigger onScan={handleScan} onError={setError} />

          <p className="text-sm text-muted-foreground">
            The camera opens automatically. Position the Lightning invoice QR within the frame.
          </p>
        </div>
      </AppContent>
    </AppViewport>
  )
}
