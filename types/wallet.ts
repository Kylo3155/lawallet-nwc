import { Card } from './card'

export interface WalletState {
  lightningAddress: string | null
  nwcUri: string | null
  balance: number
}

export type WalletTransactionType = 'incoming' | 'outgoing'

export interface WalletTransaction {
  id: string
  type: WalletTransactionType
  amountMsats: number
  createdAt: number
  description?: string
}

export interface WalletContextType extends WalletState {
  getWalletData: () => Promise<void>
  setLightningAddress: (username: string) => Promise<void>
  setNwcUri: (uri: string) => Promise<void>
  payInvoice: (invoice: string, amountSats?: number) => Promise<any>
  createInvoice: (amountSats: number, description?: string) => Promise<{ invoice: string; raw: any }>
  transactions: WalletTransaction[]
  logout: () => void
  isConnected: boolean
  isHydrated: boolean
}
