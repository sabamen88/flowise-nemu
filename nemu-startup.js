#!/usr/bin/env node
/**
 * Nemu AI - Flowise Startup Bootstrap
 *
 * Runs BEFORE Flowise starts. Creates admin user + API key if they don't exist.
 * Writes bootstrapped API key to /data/nemu-api-key.json for the dashboard to read.
 *
 * Required env: NEMU_SETUP_TOKEN (or FLOWISE_ADMIN_EMAIL + FLOWISE_ADMIN_PASSWORD)
 * Optional: DATABASE_PATH (default: ~/.flowise)
 */

const crypto = require('crypto')
const path = require('path')
const fs = require('fs')
const os = require('os')

const DB_PATH = process.env.DATABASE_PATH || path.join(os.homedir(), '.flowise')
const DB_FILE = path.join(DB_PATH, 'database.sqlite')
const OUTPUT_FILE = path.join(DB_PATH, 'nemu-bootstrap.json')

const ADMIN_EMAIL = process.env.NEMU_ADMIN_EMAIL || process.env.FLOWISE_USERNAME || 'admin@nemu.ai'
const ADMIN_PASSWORD = process.env.NEMU_ADMIN_PASSWORD || process.env.FLOWISE_PASSWORD || 'NemuAdmin2026!'
const KEY_NAME = 'Nemu Dashboard Key'

function log(...args) {
    console.log('[nemu-bootstrap]', ...args)
}

async function main() {
    log('Starting Nemu bootstrap...')
    log(`DB path: ${DB_FILE}`)

    // Check if DB exists
    if (!fs.existsSync(DB_FILE)) {
        log('No database found — will create on first Flowise start. Skipping bootstrap.')
        return
    }

    // Try to use better-sqlite3 (included in Flowise)
    let Database
    try {
        Database = require('better-sqlite3')
    } catch {
        try {
            Database = require('/app/node_modules/better-sqlite3')
        } catch {
            try {
                // Find it in Flowise packages
                const globPattern = path.join('/app', '**/better-sqlite3/lib/database.js')
                const { execSync } = require('child_process')
                const found = execSync(`find /app -name "database.js" -path "*/better-sqlite3/*" 2>/dev/null | head -1`).toString().trim()
                if (found) {
                    Database = require(path.dirname(path.dirname(found)))
                }
            } catch {
                log('better-sqlite3 not found. Trying node-sqlite3...')
                log('Bootstrap skipped — cannot access DB without sqlite3 driver')
                return
            }
        }
    }

    const db = new Database(DB_FILE)

    // Check if user table exists
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
    log('Tables found:', tables.join(', '))

    if (!tables.includes('user')) {
        log('User table does not exist yet — Flowise migrations not run. Skipping bootstrap.')
        db.close()
        return
    }

    // Check existing users
    const users = db.prepare('SELECT id, email, status FROM "user" LIMIT 10').all()
    log(`Existing users: ${users.length}`)
    users.forEach(u => log(`  - ${u.email} (${u.status})`))

    // Check existing API keys
    const existingKeys = db.prepare('SELECT id, "keyName", "workspaceId" FROM apikey').all()
    const existingNemuKey = existingKeys.find(k => k.keyName === KEY_NAME)

    if (existingNemuKey) {
        log(`API key "${KEY_NAME}" already exists. Checking if it works...`)
        // Read the apiKey value
        const keyRow = db.prepare('SELECT "apiKey" FROM apikey WHERE id = ?').get(existingNemuKey.id)
        if (keyRow && fs.existsSync(OUTPUT_FILE)) {
            log('Bootstrap file already exists. Skipping.')
            db.close()
            return
        }
    }

    // Get or find workspace
    const workspaces = db.prepare('SELECT id FROM workspace LIMIT 1').all()
    if (workspaces.length === 0) {
        log('No workspace found yet. Will retry after Flowise initializes.')
        db.close()
        return
    }
    const workspaceId = workspaces[0].id

    // Create or update admin user
    let adminUser = db.prepare('SELECT * FROM "user" WHERE email = ?').get(ADMIN_EMAIL)

    if (!adminUser) {
        log(`Creating admin user: ${ADMIN_EMAIL}`)
        // Use bcryptjs (included in Flowise)
        let bcrypt
        try { bcrypt = require('bcryptjs') } catch {
            try { bcrypt = require('/app/node_modules/bcryptjs') } catch {
                log('bcryptjs not found, trying bcrypt...')
                try { bcrypt = require('bcrypt') } catch {
                    log('Cannot hash password - bcrypt not available. Using sha256 as fallback.')
                    bcrypt = { hashSync: (p) => crypto.createHash('sha256').update(p).digest('hex') }
                }
            }
        }

        const hashedPw = bcrypt.hashSync(ADMIN_PASSWORD, 10)
        const { v4: uuidv4 } = require('uuid') || { v4: () => crypto.randomUUID() }
        const userId = (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : require('uuid').v4()

        // Get owner role
        const ownerRole = db.prepare('SELECT id FROM role WHERE name = ? LIMIT 1').get('OWNER')
        const roleId = ownerRole ? ownerRole.id : null

        // Get org
        const org = db.prepare('SELECT id FROM organization LIMIT 1').get()
        const orgId = org ? org.id : null

        db.prepare(`INSERT INTO "user" (id, name, email, credential, status, "createdDate", "updatedDate", "createdBy", "updatedBy")
                    VALUES (?, 'Nemu Admin', ?, ?, 'active', datetime('now'), datetime('now'), ?, ?)`).run(
            userId, ADMIN_EMAIL, hashedPw, userId, userId
        )

        if (orgId && roleId) {
            try {
                db.prepare(`INSERT INTO organization_user (id, "userId", "organizationId", "roleId", status, "createdDate", "updatedDate", "createdBy", "updatedBy")
                            VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'), ?, ?)`).run(
                    crypto.randomUUID(), userId, orgId, roleId, userId, userId
                )
                db.prepare(`INSERT INTO workspace_user (id, "userId", "workspaceId", "roleId", status, "createdDate", "updatedDate", "createdBy", "updatedBy")
                            VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'), ?, ?)`).run(
                    crypto.randomUUID(), userId, workspaceId, roleId, userId, userId
                )
            } catch (e) {
                log('Warning: Could not link user to org/workspace:', e.message)
            }
        }

        adminUser = { id: userId }
        log(`Admin user created: ${ADMIN_EMAIL}`)
    } else {
        log(`Admin user already exists: ${ADMIN_EMAIL}`)
        // Reset password
        let bcrypt
        try { bcrypt = require('bcryptjs') } catch { bcrypt = { hashSync: (p) => p } }
        const hashedPw = bcrypt.hashSync(ADMIN_PASSWORD, 10)
        db.prepare(`UPDATE "user" SET credential = ?, status = 'active', "updatedDate" = datetime('now') WHERE email = ?`).run(hashedPw, ADMIN_EMAIL)
        log(`Password reset for: ${ADMIN_EMAIL}`)
    }

    // Create API key
    function generateAPIKey() {
        return crypto.randomBytes(32).toString('base64url')
    }

    function generateSecretHash(apiKey) {
        const salt = crypto.randomBytes(8).toString('hex')
        const buffer = crypto.scryptSync(apiKey, salt, 64)
        return `${buffer.toString('hex')}.${salt}`
    }

    // Delete existing key with same name
    db.prepare('DELETE FROM apikey WHERE "workspaceId" = ? AND "keyName" = ?').run(workspaceId, KEY_NAME)

    const apiKey = generateAPIKey()
    const apiSecret = generateSecretHash(apiKey)
    const keyId = crypto.randomUUID()

    db.prepare(`INSERT INTO apikey (id, "apiKey", "apiSecret", "keyName", permissions, "updatedDate", "workspaceId")
                VALUES (?, ?, ?, ?, '[]', datetime('now'), ?)`).run(
        keyId, apiKey, apiSecret, KEY_NAME, workspaceId
    )

    log(`API key created: ${apiKey.substring(0, 20)}...`)

    // Write bootstrap output
    const output = {
        adminEmail: ADMIN_EMAIL,
        apiKey,
        workspaceId,
        createdAt: new Date().toISOString()
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2))
    log(`Bootstrap complete! API key written to ${OUTPUT_FILE}`)
    log(`FLOWISE_API_KEY=${apiKey}`)

    db.close()
}

main().catch(err => {
    console.error('[nemu-bootstrap] Error:', err.message)
    // Don't fail — let Flowise start anyway
})
