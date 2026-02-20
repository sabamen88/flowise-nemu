import { INode, INodeData, INodeParams } from '../../src/Interface'
import { Tool } from '@langchain/core/tools'
import { Pool } from 'pg'

class NemuCatalogTool extends Tool {
    name = 'nemu_catalog'
    description = 'Search the seller product catalog on Nemu AI. Use this to answer buyer questions about products, prices, and stock. Input: search query string.'

    private pool: Pool
    private sellerId: string

    constructor(connectionString: string, sellerId: string) {
        super()
        this.pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } })
        this.sellerId = sellerId
    }

    async _call(query: string): Promise<string> {
        try {
            const result = await this.pool.query(
                `SELECT name, price, stock, description, category 
                 FROM products 
                 WHERE seller_id = $1 
                 AND status = 'active' 
                 AND (name ILIKE $2 OR description ILIKE $2 OR category ILIKE $2)
                 LIMIT 5`,
                [this.sellerId, `%${query}%`]
            )

            if (result.rows.length === 0) {
                return 'Tidak ada produk yang cocok dengan pencarian tersebut.'
            }

            return result.rows
                .map(
                    (p) =>
                        `- ${p.name}: Rp ${Number(p.price).toLocaleString('id-ID')} (stok: ${p.stock})${p.description ? ' - ' + p.description.substring(0, 100) : ''}`
                )
                .join('\n')
        } catch (e) {
            return 'Gagal mengambil data katalog.'
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
        this.version = 1.0
        this.type = 'NemuCatalog'
        this.icon = 'nemu.svg'
        this.category = 'Tools'
        this.description = 'Search Nemu seller product catalog from Neon DB'
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
