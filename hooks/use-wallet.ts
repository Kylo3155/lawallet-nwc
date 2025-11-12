import { WalletContext } from '@/providers/wallet'
import { useContext } from 'react'

export function useWallet() {
  const context = useContext(WalletContext)
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { LaWalletKinds, LaWalletTags } from '@/types/wallet'
import { Nostr, NDKEvent, NDKKind, NDKFilter, NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk'
import { nip19 } from 'nostr-tools'
import { LaWalletConfig } from '@/lib/config'

interface WalletState {
  pubkey: string
  wallet: {
    [key: string]: string
  }
  setWallet: (wallet: { [key: string]: string }) => void
  setPubkey: (pubkey: string) => void
  payInvoice: (invoice: string, amount?: number) => Promise<any>
}

const parseContent = (content: string) => {
  try {
    return JSON.parse(content)
  } catch {
    return {}
  }
}

export const useWallet = create<WalletState>()(
  devtools(
    persist(
      (set, get) => ({
        pubkey: '',
        wallet: {},
        setWallet: (wallet: { [key: string]: string }) => set({ wallet }),
        setPubkey: (pubkey: string) => set({ pubkey }),
        payInvoice: async (invoice: string, amount?: number) => {
          const { pubkey, wallet } = get()

          const nostr = new Nostr(LaWalletConfig.nostr)
          await nostr.connect()

          const nostrWalletConnectURI = wallet[LaWalletTags.NWC_URI]
          if (!nostrWalletConnectURI) throw new Error('Nostr Wallet Connect URI not found')

          const {
            data: { pubkey: walletPubkey, secret, relay }
          } = nip19.decode(nostrWalletConnectURI)

          const paymentEvent = new NDKEvent(nostr, {
            pubkey: secret,
            kind: NDKKind.WalletConnectRequest,
            created_at: Math.round(Date.now() / 1000),
            content: JSON.stringify({
              method: 'pay_invoice',
              params: {
                invoice,
                amount
              }
            }),
            tags: [['p', walletPubkey]]
          })

          await paymentEvent.sign()

          const relays = [relay, ...LaWalletConfig.nostr.relays]

          const subscription = nostr.subscribe(
            {
              kinds: [NDKKind.WalletConnectResponse],
              authors: [walletPubkey],
              '#e': [paymentEvent.id]
            },
            {
              closeOnEose: false,
              cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY
            }
          )

          return new Promise(async (resolve, reject) => {
            await nostr.publish(paymentEvent, new Set(relays))

            subscription.on('event', (event: NDKEvent) => {
              const { result, error } = parseContent(event.content)

              if (error) return reject(error)
              if (result) return resolve(result)
            })

            subscription.on('eose', () => {
              reject('Eose')
            })
          })
        }
      }),
      {
        name: 'lawallet:wallet'
      }
    )
  )
)
