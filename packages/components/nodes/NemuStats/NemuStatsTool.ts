import { INode, INodeData, INodeParams } from '../../src/Interface'
import { Tool } from '@langchain/core/tools'
import { Pool } from 'pg'

class NemuStatsTool extends Tool {
    name = 'nemu_stats'
    description =
        'Tampilkan statistik dan analitik toko penjual di Nemu AI — jumlah produk aktif, pesanan hari ini, omzet minggu ini, dan ringkasan status pesanan. ' +
        'Input: diabaikan, selalu mengembalikan snapshot lengkap statistik toko.'

    private pool: Pool
    private sellerId: string

    constructor(connectionString: string, sellerId: string) {
        super()
        this.pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } })
        this.sellerId = sellerId
    }

    private formatRupiah(amount: string | number): string {
        const num = Number(amount) || 0
        if (num >= 1_000_000_000) {
            return `Rp ${(num / 1_000_000_000).toFixed(1).replace('.', ',')} miliar`
        }
        if (num >= 1_000_000) {
            return `Rp ${(num / 1_000_000).toFixed(1).replace('.', ',')} juta`
        }
        return `Rp ${num.toLocaleString('id-ID')}`
    }

    async _call(_query: string): Promise<string> {
        try {
            const [
                productStats,
                orderToday,
                orderWeek,
                orderMonth,
                orderStatusBreakdown,
                topProducts
            ] = await Promise.all([
                // Product counts
                this.pool.query(
                    `SELECT 
                        COUNT(*) FILTER (WHERE status = 'active') as active_count,
                        COUNT(*) FILTER (WHERE status = 'draft') as draft_count,
                        COUNT(*) FILTER (WHERE status = 'archived') as archived_count,
                        COUNT(*) FILTER (WHERE status = 'active' AND stock = 0) as out_of_stock
                     FROM products WHERE seller_id = $1`,
                    [this.sellerId]
                ),
                // Today's orders (WIB)
                this.pool.query(
                    `SELECT COUNT(*) as count, COALESCE(SUM(total::numeric), 0) as revenue
                     FROM orders
                     WHERE seller_id = $1
                       AND created_at >= (NOW() AT TIME ZONE 'Asia/Jakarta')::date
                       AND status != 'cancelled'`,
                    [this.sellerId]
                ),
                // This week's orders
                this.pool.query(
                    `SELECT COUNT(*) as count, COALESCE(SUM(total::numeric), 0) as revenue
                     FROM orders
                     WHERE seller_id = $1
                       AND created_at >= date_trunc('week', NOW() AT TIME ZONE 'Asia/Jakarta')
                       AND status != 'cancelled'`,
                    [this.sellerId]
                ),
                // This month's orders
                this.pool.query(
                    `SELECT COUNT(*) as count, COALESCE(SUM(total::numeric), 0) as revenue
                     FROM orders
                     WHERE seller_id = $1
                       AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Jakarta')
                       AND status != 'cancelled'`,
                    [this.sellerId]
                ),
                // Order status breakdown (last 30 days)
                this.pool.query(
                    `SELECT status, COUNT(*) as count
                     FROM orders
                     WHERE seller_id = $1
                       AND created_at >= NOW() - INTERVAL '30 days'
                     GROUP BY status`,
                    [this.sellerId]
                ),
                // Top 3 best-selling products this month
                this.pool.query(
                    `SELECT 
                        p.name,
                        SUM((item->>'quantity')::int) as total_sold
                     FROM orders o,
                          jsonb_array_elements(o.items::jsonb) AS item
                     JOIN products p ON p.id = (item->>'productId')::uuid
                     WHERE o.seller_id = $1
                       AND o.status != 'cancelled'
                       AND o.created_at >= date_trunc('month', NOW())
                     GROUP BY p.id, p.name
                     ORDER BY total_sold DESC
                     LIMIT 3`,
                    [this.sellerId]
                )
            ])

            const prod = productStats.rows[0]
            const today = orderToday.rows[0]
            const week = orderWeek.rows[0]
            const month = orderMonth.rows[0]

            // Status breakdown map
            const statusMap: Record<string, string> = {
                pending: 'Menunggu',
                confirmed: 'Dikonfirmasi',
                shipped: 'Dikirim',
                done: 'Selesai',
                cancelled: 'Dibatalkan'
            }
            const statusBreakdown = orderStatusBreakdown.rows
                .map((r: any) => `${statusMap[r.status] || r.status}: ${r.count}`)
                .join(', ')

            // Top products
            const topProductsText =
                topProducts.rows.length > 0
                    ? '\n\n🏆 Produk terlaris bulan ini:\n' +
                      topProducts.rows
                          .map((r: any, i: number) => `${i + 1}. ${r.name} (${r.total_sold} terjual)`)
                          .join('\n')
                    : ''

            const lines = [
                `📊 Statistik Toko kamu:`,
                ``,
                `📦 Produk:`,
                `- Aktif: ${prod.active_count} produk`,
                `- Draft: ${prod.draft_count} produk`,
                `- Stok habis: ${prod.out_of_stock} produk`,
                ``,
                `🛒 Pesanan hari ini: ${today.count} pesanan | Omzet: ${this.formatRupiah(today.revenue)}`,
                `📅 Pesanan minggu ini: ${week.count} pesanan | Omzet: ${this.formatRupiah(week.revenue)}`,
                `📆 Pesanan bulan ini: ${month.count} pesanan | Omzet: ${this.formatRupiah(month.revenue)}`,
                ``,
                `📋 Status pesanan (30 hari): ${statusBreakdown || 'Belum ada data'}`,
                topProductsText
            ]

            return lines.join('\n').trim()
        } catch (e: any) {
            console.error('NemuStatsTool error:', e)
            return 'Gagal mengambil statistik toko. Silakan coba lagi.'
        }
    }
}

class NemuStatsNode implements INode {
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
        this.label = 'Nemu Stats'
        this.name = 'nemuStats'
        this.version = 1.0
        this.type = 'NemuStats'
        this.icon = 'nemu.svg'
        this.category = 'Tools'
        this.description = 'Statistik dan analitik toko penjual Nemu AI — produk aktif, omzet, pesanan'
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
        return new NemuStatsTool(connectionString, sellerId)
    }
}

module.exports = { nodeClass: NemuStatsNode }
