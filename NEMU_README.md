# Nemu AI Agent Studio

> **Nemu AI Agent Studio** adalah fork dari [FlowiseAI/Flowise](https://github.com/FlowiseAI/Flowise) yang dikustomisasi untuk platform marketplace Nemu AI — marketplace AI pertama di Indonesia. Fork ini menyediakan backend agent AI untuk setiap seller di Nemu, memungkinkan mereka memiliki asisten AI yang menjawab pertanyaan pembeli dalam Bahasa Indonesia langsung dari katalog produk mereka.

---

## 📦 Apa yang Ada di Fork Ini

| Fitur | Deskripsi |
|---|---|
| **Branding Nemu** | Judul, warna, dan metadata UI telah disesuaikan ke Nemu AI Agent Studio |
| **Nemu Catalog Node** | Custom node Flowise untuk query produk seller dari Neon Postgres |
| **Seller Agent Template** | Chatflow JSON siap pakai untuk agent penjual |
| **render.yaml** | Konfigurasi deployment ke Render (Docker, Singapore region) |
| **.env.example** | Template variabel environment |

---

## 🚀 Deploy ke Render

### 1. Fork & Connect Repo

1. Fork repo ini ke akun GitHub kamu
2. Buka [render.com](https://render.com) → **New → Blueprint**
3. Connect repo `flowise-nemu` → Render akan membaca `render.yaml` otomatis

### 2. Set Environment Variables di Render Dashboard

Setelah service dibuat, set variabel berikut di **Environment**:

| Key | Value |
|---|---|
| `OPENAI_API_KEY` | MiniMax API key kamu |
| `NEON_DATABASE_URL` | Connection string Neon Postgres |

> `FLOWISE_PASSWORD` akan di-generate otomatis oleh Render. Lihat di dashboard.

### 3. Deploy

Render akan build dari `Dockerfile` dan deploy ke region Singapore. Proses build memakan ~5–10 menit pertama kali.

---

## 🤖 Konfigurasi MiniMax M2.5

Nemu menggunakan **MiniMax M2.5** (`MiniMax-Text-01`) sebagai LLM utama via endpoint OpenAI-compatible.

### Di Flowise (Chat Models → ChatOpenAI)

| Field | Value |
|---|---|
| Model Name | `MiniMax-Text-01` |
| OpenAI API Key | MiniMax API key kamu |
| Base URL | `https://api.minimax.io/v1` |
| Temperature | `0.7` |
| Max Tokens | `500` |

Atau set di environment:
```env
OPENAI_API_KEY=your_minimax_key
OPENAI_BASE_URL=https://api.minimax.io/v1
```

---

## 🛠 Nemu Catalog Node

Node custom `NemuCatalog` memungkinkan agent AI melakukan query langsung ke tabel `products` di Neon Postgres seller.

### Cara Pakai

1. Di Flowise canvas, cari node **"Nemu Catalog"** di kategori **Tools**
2. Isi:
   - **Neon Connection String**: `postgresql://user:pass@ep-calm-frog-aiu8zdev.us-east-1.aws.neon.tech/nemu?sslmode=require`
   - **Seller ID**: UUID seller (dari database Nemu)
3. Connect ke node Agent atau ConversationChain

### Query yang Dilakukan

```sql
SELECT name, price, stock, description, category 
FROM products 
WHERE seller_id = $1 
  AND status = 'active' 
  AND (name ILIKE $2 OR description ILIKE $2 OR category ILIKE $2)
LIMIT 5
```

### Contoh Output

```
- Kaos Polos Hitam: Rp 85.000 (stok: 50) - Kaos polos katun combed 30s, tersedia semua ukuran S-XXL
- Kaos Oversize: Rp 110.000 (stok: 30) - Kaos oversize fit, bahan tebal tidak transparan
```

---

## 💬 Embed Chat Widget di Seller Dashboard

Flowise menyediakan embed widget yang bisa langsung ditanam di dashboard seller (Next.js).

### Script Tag (HTML)

```html
<script type="module">
  import Chatbot from 'https://cdn.jsdelivr.net/npm/flowise-embed/dist/web.js'
  Chatbot.init({
    chatflowid: 'YOUR_CHATFLOW_ID',
    apiHost: 'https://nemu-flowise.onrender.com',
    chatflowConfig: {
      sessionId: 'seller-123'
    },
    theme: {
      button: {
        backgroundColor: '#E91E63',
        right: 20,
        bottom: 20,
        size: 48,
        iconColor: 'white',
      },
      chatWindow: {
        title: 'Asisten Toko Kamu',
        welcomeMessage: 'Halo kak! Ada yang bisa dibantu? 😊',
        backgroundColor: '#ffffff',
        height: 700,
        width: 400,
      }
    }
  })
</script>
```

### Di Next.js (React Component)

```tsx
'use client'
import { useEffect } from 'react'

export function NemuChatWidget({ chatflowId, sellerId }: { chatflowId: string; sellerId: string }) {
  useEffect(() => {
    import('flowise-embed').then(({ default: Chatbot }) => {
      Chatbot.init({
        chatflowid: chatflowId,
        apiHost: process.env.NEXT_PUBLIC_FLOWISE_URL || 'https://nemu-flowise.onrender.com',
        chatflowConfig: { sessionId: sellerId },
        theme: {
          button: { backgroundColor: '#E91E63' },
          chatWindow: {
            title: 'Asisten Toko',
            welcomeMessage: 'Halo kak! Ada yang bisa dibantu? 😊',
          }
        }
      })
    })
  }, [chatflowId, sellerId])

  return null
}
```

Install dependency:
```bash
pnpm add flowise-embed
```

---

## 📋 Setup Chatflow Default (Seller Agent)

1. Login ke Flowise (`https://nemu-flowise.onrender.com`)
2. Buat chatflow baru → **Import** → pilih file `nemu-templates/seller-agent-chatflow.json`
3. Update placeholder:
   - `{{MINIMAX_API_KEY}}` → API key MiniMax
   - `{{SELLER_ID}}` → UUID seller
   - `{{STORE_NAME}}` → Nama toko seller
   - `{{NEON_DATABASE_URL}}` → Connection string Neon
4. **Save** → **Deploy**
5. Copy **Chatflow ID** dari URL atau Share menu
6. Gunakan ID tersebut di embed widget dashboard

---

## 📁 Struktur File Kustomisasi

```
flowise-nemu/
├── packages/
│   ├── ui/
│   │   ├── index.html                          # ← Judul & meta Nemu
│   │   ├── public/index.html                   # ← Judul & meta Nemu
│   │   └── src/
│   │       ├── assets/scss/_themes-vars.module.scss  # ← Brand color #E91E63
│   │       └── ui-component/extended/Logo.jsx  # ← Alt text Nemu
│   └── components/
│       └── nodes/
│           └── NemuCatalog/
│               └── NemuCatalogTool.ts          # ← Custom catalog node
├── nemu-templates/
│   └── seller-agent-chatflow.json              # ← Template chatflow
├── render.yaml                                 # ← Render deployment config
├── .env.example                                # ← Environment template
└── NEMU_README.md                              # ← This file
```

---

## 🔗 Stack Nemu AI

| Komponen | Teknologi | Repo/URL |
|---|---|---|
| Dashboard Seller | Next.js + Vercel | [sabamen88/nemu-dashboard](https://github.com/sabamen88/nemu-dashboard) |
| AI Agent Backend | Flowise (fork ini) + Render | [sabamen88/flowise-nemu](https://github.com/sabamen88/flowise-nemu) |
| Database | Neon Postgres | `ep-calm-frog-aiu8zdev.us-east-1.aws.neon.tech` |
| LLM | MiniMax M2.5 | `https://api.minimax.io/v1` |

---

## 📄 License

Fork ini mengikuti lisensi asli Flowise: [Apache 2.0](LICENSE.md)

Kustomisasi Nemu AI © 2025 Nemu AI Team.
