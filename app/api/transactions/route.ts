import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateNip98 } from '@/lib/nip98'

export async function GET(request: Request) {
  try {
    const { pubkey } = await validateNip98(request)
    const user = await prisma.user.findUnique({ where: { pubkey } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200)

    const txs = await (prisma as any).walletTransaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: limit
    })

    return NextResponse.json({ transactions: txs })
  } catch (e) {
    console.error('GET /api/transactions', e)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function POST(request: Request) {
  try {
    const { pubkey } = await validateNip98(request)
    const user = await prisma.user.findUnique({ where: { pubkey } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const body = await request.json()
    const {
      type,
      amountMsats,
      description,
      createdAt,
      externalId
    }: {
      type: 'incoming' | 'outgoing'
      amountMsats: number
      description?: string
      createdAt?: number
      externalId?: string
    } = body

    if (!type || !amountMsats || amountMsats <= 0) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const when = createdAt ? new Date(createdAt) : new Date()

    // Upsert by externalId when provided to avoid duplicates
    let tx
    if (externalId) {
      tx = await (prisma as any).walletTransaction.upsert({
        where: { externalId },
        update: {
          type,
          amountMsats,
          description: description || null,
          createdAt: when
        },
        create: {
          userId: user.id,
          type,
          amountMsats,
          description: description || null,
          createdAt: when,
          externalId
        }
      })
    } else {
      tx = await (prisma as any).walletTransaction.create({
        data: {
          userId: user.id,
          type,
          amountMsats,
          description: description || null,
          createdAt: when
        }
      })
    }

    return NextResponse.json({ transaction: tx })
  } catch (e) {
    console.error('POST /api/transactions', e)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
