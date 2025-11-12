import { Card } from './card'

export interface WalletState {
  lightningAddress: string | null
  nwcUri: string | null
  balance: number
}

export interface WalletContextType extends WalletState {
  getWalletData: () => Promise<void>
  setLightningAddress: (username: string) => Promise<void>
  setNwcUri: (uri: string) => Promise<void>
  payInvoice: (invoice: string, amountSats?: number) => Promise<any>
  logout: () => void
  isConnected: boolean
  isHydrated: boolean
}
