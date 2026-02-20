import { INode, INodeData, INodeParams } from '../../src/Interface'
import { Tool } from '@langchain/core/tools'
import { Pool } from 'pg'

class NemuCatalogTool extends Tool {
    name = 'nemu_catalog'
    description =
        'Cari dan tampilkan produk dari katalog toko penjual di Nemu AI. ' +
        'Gunakan untuk menjawab pertanyaan tentang produk, harga, dan stok. ' +
        'Input: query pencarian dalam Bahasa Indonesia. ' +
        'Contoh: "semua produk", "stok habis", "produk mahal", "termahal", atau nama/kata kunci produk.'

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

    private formatProduct(p: any): string {
        const stockInfo = p.stock === 0 ? '⚠️ Stok habis' : `Stok: ${p.stock}`
        const desc = p.description ? ` — ${String(p.description).substring(0, 100)}` : ''
        return `- ${p.name}: ${this.formatRupiah(p.price)} (${stockInfo})${desc}`
    }

    async _call(query: string): Promise<string> {
        const q = query.toLowerCase().trim()

        try {
            // "semua produk" / "all" → return full catalog (max 20)
            if (
                q === 'semua produk' ||
                q === 'all' ||
                q === 'semua' ||
                q.includes('semua produk') ||
                q.includes('tampilkan semua') ||
                q.includes('list semua') ||
                q.includes('daftar semua')
            ) {
                const result = await this.pool.query(
                    `SELECT name, price, stock, description, category, status
                     FROM products
                     WHERE seller_id = $1
                       AND status = 'active'
                     ORDER BY name ASC
                     LIMIT 20`,
                    [this.sellerId]
                )

                if (result.rows.length === 0) {
                    return 'Belum ada produk aktif di katalog.'
                }

                const list = result.rows.map((p) => this.formatProduct(p)).join('\n')
                return `📦 Semua produk aktif (${result.rows.length} produk):\n${list}`
            }

            // "stok habis" → products with stock = 0
            if (
                q.includes('stok habis') ||
                q.includes('stock habis') ||
                q.includes('habis') ||
                q.includes('out of stock')
            ) {
                const result = await this.pool.query(
                    `SELECT name, price, stock, description, category
                     FROM products
                     WHERE seller_id = $1
                       AND status = 'active'
                       AND stock = 0
                     ORDER BY name ASC
                     LIMIT 20`,
                    [this.sellerId]
                )

                if (result.rows.length === 0) {
                    return '✅ Tidak ada produk yang stok habis. Semua produk masih tersedia.'
                }

                const list = result.rows.map((p) => this.formatProduct(p)).join('\n')
                return `⚠️ Produk stok habis (${result.rows.length} produk):\n${list}`
            }

            // "produk mahal" / "termahal" → sorted by price DESC
            if (
                q.includes('produk mahal') ||
                q.includes('termahal') ||
                q.includes('paling mahal') ||
                q.includes('harga tertinggi')
            ) {
                const result = await this.pool.query(
                    `SELECT name, price, stock, description, category
                     FROM products
                     WHERE seller_id = $1
                       AND status = 'active'
                     ORDER BY price::numeric DESC
                     LIMIT 10`,
                    [this.sellerId]
                )

                if (result.rows.length === 0) {
                    return 'Belum ada produk aktif di katalog.'
                }

                const list = result.rows.map((p) => this.formatProduct(p)).join('\n')
                return `💎 Produk termahal (${result.rows.length} produk):\n${list}`
            }

            // "produk murah" / "termurah" → sorted by price ASC
            if (
                q.includes('produk murah') ||
                q.includes('termurah') ||
                q.includes('paling murah') ||
                q.includes('harga terendah')
            ) {
                const result = await this.pool.query(
                    `SELECT name, price, stock, description, category
                     FROM products
                     WHERE seller_id = $1
                       AND status = 'active'
                       AND stock > 0
                     ORDER BY price::numeric ASC
                     LIMIT 10`,
                    [this.sellerId]
                )

                if (result.rows.length === 0) {
                    return 'Belum ada produk aktif di katalog.'
                }

                const list = result.rows.map((p) => this.formatProduct(p)).join('\n')
                return `💰 Produk termurah (${result.rows.length} produk):\n${list}`
            }

            // Default: keyword search
            const result = await this.pool.query(
                `SELECT name, price, stock, description, category
                 FROM products
                 WHERE seller_id = $1
                   AND status = 'active'
                   AND (name ILIKE $2 OR description ILIKE $2 OR category ILIKE $2)
                 ORDER BY
                   CASE WHEN name ILIKE $2 THEN 0 ELSE 1 END,
                   name ASC
                 LIMIT 5`,
                [this.sellerId, `%${query}%`]
            )

            if (result.rows.length === 0) {
                return `Tidak ada produk yang cocok dengan pencarian "${query}". Coba kata kunci lain atau ketik "semua produk" untuk melihat katalog lengkap.`
            }

            const list = result.rows.map((p) => this.formatProduct(p)).join('\n')
            return `🔍 Hasil pencarian "${query}" (${result.rows.length} produk):\n${list}`
        } catch (e: any) {
            console.error('NemuCatalogTool error:', e)
            return 'Gagal mengambil data katalog. Silakan coba lagi.'
        }
    }
}

class NemuCatalogNode implements INode {
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
        this.label = 'Nemu Catalog'
        this.name = 'nemuCatalog'
        this.version = 2.0
        this.type = 'NemuCatalog'
        this.icon = 'nemu.svg'
        this.category = 'Tools'
        this.description = 'Cari produk katalog toko penjual Nemu AI dari Neon DB — mendukung pencarian, semua produk, stok habis, dan filter harga'
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
        return new NemuCatalogTool(connectionString, sellerId)
    }
}

module.exports = { nodeClass: NemuCatalogNode }
