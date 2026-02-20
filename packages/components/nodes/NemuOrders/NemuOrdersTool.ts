import { INode, INodeData, INodeParams } from '../../src/Interface'
import { Tool } from '@langchain/core/tools'
import { Pool } from 'pg'

class NemuOrdersTool extends Tool {
    name = 'nemu_orders'
    description =
        'Lihat pesanan toko di Nemu AI. Gunakan untuk menjawab pertanyaan penjual tentang pesanan, status, dan pembeli. ' +
        'Input: query dalam Bahasa Indonesia, contoh: "pesanan hari ini", "pesanan pending", "pesanan selesai", "pesanan terbaru".'

    private pool: Pool
    private sellerId: string

    constructor(connectionString: string, sellerId: string) {
        super()
        this.pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } })
        this.sellerId = sellerId
    }

    private formatRupiah(amount: string | number): string {
        return `Rp ${Number(amount).toLocaleString('id-ID')}`
    }

    private formatDate(date: Date): string {
        return new Intl.DateTimeFormat('id-ID', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Jakarta'
        }).format(date)
    }

    private formatOrder(o: any, index: number): string {
        let items = ''
        try {
            const parsed = typeof o.items === 'string' ? JSON.parse(o.items) : o.items
            if (Array.isArray(parsed)) {
                items = parsed.map((i: any) => `${i.productName} x${i.quantity}`).join(', ')
            }
        } catch {
            items = '-'
        }

        const statusMap: Record<string, string> = {
            pending: 'Menunggu konfirmasi',
            confirmed: 'Dikonfirmasi',
            shipped: 'Dalam pengiriman',
            done: 'Selesai',
            cancelled: 'Dibatalkan'
        }

        return [
            `${index + 1}. Pembeli: ${o.buyer_name}`,
            `   Produk: ${items}`,
            `   Total: ${this.formatRupiah(o.total)}`,
            `   Status: ${statusMap[o.status] || o.status}`,
            `   Tanggal: ${this.formatDate(new Date(o.created_at))}`
        ].join('\n')
    }

    async _call(query: string): Promise<string> {
        const q = query.toLowerCase()

        try {
            let rows: any[]

            if (q.includes('hari ini') || q.includes('today')) {
                // Today's orders (WIB = UTC+7)
                const result = await this.pool.query(
                    `SELECT id, buyer_name, buyer_phone, items, total, status, created_at
                     FROM orders
                     WHERE seller_id = $1
                       AND created_at >= (NOW() AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')::date
                     ORDER BY created_at DESC
                     LIMIT 20`,
                    [this.sellerId]
                )
                rows = result.rows

                if (rows.length === 0) {
                    return 'Belum ada pesanan hari ini.'
                }
                const list = rows.map((o, i) => this.formatOrder(o, i)).join('\n\n')
                return `📦 Pesanan hari ini (${rows.length} pesanan):\n\n${list}`
            }

            if (q.includes('pending') || q.includes('menunggu')) {
                const result = await this.pool.query(
                    `SELECT id, buyer_name, buyer_phone, items, total, status, created_at
                     FROM orders
                     WHERE seller_id = $1 AND status = 'pending'
                     ORDER BY created_at DESC
                     LIMIT 15`,
                    [this.sellerId]
                )
                rows = result.rows

                if (rows.length === 0) {
                    return 'Tidak ada pesanan yang menunggu konfirmasi saat ini.'
                }
                const list = rows.map((o, i) => this.formatOrder(o, i)).join('\n\n')
                return `⏳ Pesanan pending (${rows.length} pesanan):\n\n${list}`
            }

            if (q.includes('selesai') || q.includes('done') || q.includes('completed')) {
                const result = await this.pool.query(
                    `SELECT id, buyer_name, buyer_phone, items, total, status, created_at
                     FROM orders
                     WHERE seller_id = $1 AND status = 'done'
                     ORDER BY created_at DESC
                     LIMIT 15`,
                    [this.sellerId]
                )
                rows = result.rows

                if (rows.length === 0) {
                    return 'Belum ada pesanan yang selesai.'
                }
                const list = rows.map((o, i) => this.formatOrder(o, i)).join('\n\n')
                return `✅ Pesanan selesai (${rows.length} pesanan):\n\n${list}`
            }

            if (q.includes('dikirim') || q.includes('shipped') || q.includes('pengiriman')) {
                const result = await this.pool.query(
                    `SELECT id, buyer_name, buyer_phone, items, total, status, created_at
                     FROM orders
                     WHERE seller_id = $1 AND status = 'shipped'
                     ORDER BY created_at DESC
                     LIMIT 15`,
                    [this.sellerId]
                )
                rows = result.rows

                if (rows.length === 0) {
                    return 'Tidak ada pesanan dalam pengiriman saat ini.'
                }
                const list = rows.map((o, i) => this.formatOrder(o, i)).join('\n\n')
                return `🚚 Pesanan dalam pengiriman (${rows.length} pesanan):\n\n${list}`
            }

            if (q.includes('dibatalkan') || q.includes('cancelled') || q.includes('batal')) {
                const result = await this.pool.query(
                    `SELECT id, buyer_name, buyer_phone, items, total, status, created_at
                     FROM orders
                     WHERE seller_id = $1 AND status = 'cancelled'
                     ORDER BY created_at DESC
                     LIMIT 15`,
                    [this.sellerId]
                )
                rows = result.rows

                if (rows.length === 0) {
                    return 'Tidak ada pesanan yang dibatalkan.'
                }
                const list = rows.map((o, i) => this.formatOrder(o, i)).join('\n\n')
                return `❌ Pesanan dibatalkan (${rows.length} pesanan):\n\n${list}`
            }

            // Default: last 10 orders
            const result = await this.pool.query(
                `SELECT id, buyer_name, buyer_phone, items, total, status, created_at
                 FROM orders
                 WHERE seller_id = $1
                 ORDER BY created_at DESC
                 LIMIT 10`,
                [this.sellerId]
            )
            rows = result.rows

            if (rows.length === 0) {
                return 'Belum ada pesanan di toko ini.'
            }

            const list = rows.map((o, i) => this.formatOrder(o, i)).join('\n\n')
            return `📋 10 Pesanan terbaru:\n\n${list}`
        } catch (e: any) {
            console.error('NemuOrdersTool error:', e)
            return 'Gagal mengambil data pesanan. Silakan coba lagi.'
        }
    }
}

class NemuOrdersNode implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    inputs: INodeParams[]

    constructor() {
        this.label = 'Nemu Orders'
        this.name = 'nemuOrders'
        this.version = 1.0
        this.type = 'NemuOrders'
        this.icon = 'nemu.svg'
        this.category = 'Tools'
        this.description = 'Lihat pesanan toko penjual dari Neon DB — mendukung filter hari ini, pending, selesai'
        this.baseClasses = ['Tool']
        this.inputs = [
            {
                label: 'Neon Connection String',
                name: 'connectionString',
                type: 'string',
                placeholder: 'postgresql://user:pass@host/db?sslmode=require'
            },
            {
                label: 'Seller ID',
                name: 'sellerId',
                type: 'string',
                placeholder: 'seller-uuid-here'
            }
        ]
    }

    async init(nodeData: INodeData): Promise<any> {
        const connectionString = nodeData.inputs?.connectionString as string
        const sellerId = nodeData.inputs?.sellerId as string
        return new NemuOrdersTool(connectionString, sellerId)
    }
}

module.exports = { nodeClass: NemuOrdersNode }
