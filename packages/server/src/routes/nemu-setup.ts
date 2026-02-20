/**
 * Nemu AI Bootstrap Route
 *
 * ONE-TIME SETUP: Creates admin account + API key if none exist.
 * Protected by NEMU_SETUP_TOKEN env var.
 *
 * Usage:
 *   GET /api/v1/nemu-setup          — diagnostic: list users/keys (requires x-nemu-setup-token header)
 *   POST /api/v1/nemu-setup         — create/reset admin account + API key
 *
 * Body (POST):
 *   { "adminEmail": "admin@nemu.ai", "adminPassword": "NemuAdmin2026!", "keyName": "Nemu Dashboard Key" }
 */

import { randomBytes, scryptSync } from 'crypto'
import express, { Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getRunningExpressApp } from '../utils/getRunningExpressApp'

const router = express.Router()

function generateAPIKey(): string {
    const buffer = randomBytes(32)
    return buffer.toString('base64url')
}

function generateSecretHash(apiKey: string): string {
    const salt = randomBytes(8).toString('hex')
    const buffer = scryptSync(apiKey, salt, 64) as Buffer
    return `${buffer.toString('hex')}.${salt}`
}

function checkSetupToken(req: Request, res: Response): boolean {
    const token = process.env.NEMU_SETUP_TOKEN
    if (!token) {
        res.status(403).json({ error: 'NEMU_SETUP_TOKEN not configured on this server' })
        return false
    }
    const supplied = req.headers['x-nemu-setup-token'] as string
    if (!supplied || supplied !== token) {
        res.status(403).json({ error: 'Invalid or missing x-nemu-setup-token header' })
        return false
    }
    return true
}

// GET /api/v1/nemu-setup — diagnostic
router.get('/', async (req: Request, res: Response) => {
    if (!checkSetupToken(req, res)) return
    try {
        const ds = getRunningExpressApp().AppDataSource
        const users = await ds.query(`SELECT id, email, status, "createdDate" FROM "user" ORDER BY "createdDate" ASC LIMIT 20`)
        const apiKeys = await ds.query(`SELECT id, "keyName", "workspaceId", "updatedDate" FROM apikey ORDER BY "updatedDate" DESC LIMIT 20`)
        const orgs = await ds.query(`SELECT id, name FROM organization LIMIT 5`)
        const workspaces = await ds.query(`SELECT id, name, "organizationId" FROM workspace LIMIT 5`)
        res.json({ users, apiKeys, orgs, workspaces })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

// POST /api/v1/nemu-setup — bootstrap admin + API key
router.post('/', async (req: Request, res: Response) => {
    if (!checkSetupToken(req, res)) return

    const adminEmail: string = req.body.adminEmail || 'admin@nemu.ai'
    const adminPassword: string = req.body.adminPassword || 'NemuAdmin2026!'
    const keyName: string = req.body.keyName || 'Nemu Dashboard Key'

    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const bcrypt = require('bcryptjs')
        const hashedPassword: string = bcrypt.hashSync(adminPassword, 10)

        const ds = getRunningExpressApp().AppDataSource
        const isPostgres = ds.options.type === 'postgres'

        // Helper: upsert-friendly insert
        async function runSQL(sql: string, params: any[]) {
            return ds.query(sql, params)
        }

        // 1. Get or create organization
        const orgs = await runSQL('SELECT id FROM organization LIMIT 1', [])
        let orgId: string
        let workspaceId: string
        let userId: string

        if (orgs.length === 0) {
            // Fresh setup: create everything from scratch
            userId = uuidv4()
            orgId = uuidv4()
            workspaceId = uuidv4()
            const roleId = uuidv4()

            // Role
            if (isPostgres) {
                await runSQL(
                    `INSERT INTO role (id, name, description, "isDefault", "createdDate", "updatedDate", "createdBy", "updatedBy")
                     VALUES ($1, 'OWNER', 'Organization owner', true, NOW(), NOW(), $2, $2)
                     ON CONFLICT (id) DO NOTHING`,
                    [roleId, userId]
                )
            } else {
                await runSQL(
                    `INSERT OR IGNORE INTO role (id, name, description, "isDefault", "createdDate", "updatedDate", "createdBy", "updatedBy")
                     VALUES (?, 'OWNER', 'Organization owner', 1, datetime('now'), datetime('now'), ?, ?)`,
                    [roleId, userId, userId]
                )
            }

            // User
            if (isPostgres) {
                await runSQL(
                    `INSERT INTO "user" (id, name, email, credential, status, "createdDate", "updatedDate", "createdBy", "updatedBy")
                     VALUES ($1, 'Nemu Admin', $2, $3, 'active', NOW(), NOW(), $1, $1)
                     ON CONFLICT (email) DO UPDATE SET credential=$3, status='active', "updatedDate"=NOW()`,
                    [userId, adminEmail, hashedPassword]
                )
            } else {
                await runSQL(
                    `INSERT OR REPLACE INTO "user" (id, name, email, credential, status, "createdDate", "updatedDate", "createdBy", "updatedBy")
                     VALUES (?, 'Nemu Admin', ?, ?, 'active', datetime('now'), datetime('now'), ?, ?)`,
                    [userId, adminEmail, hashedPassword, userId, userId]
                )
            }

            // Organization
            if (isPostgres) {
                await runSQL(
                    `INSERT INTO organization (id, name, "createdDate", "updatedDate", "createdBy", "updatedBy")
                     VALUES ($1, 'Default Organization', NOW(), NOW(), $2, $2)
                     ON CONFLICT (id) DO NOTHING`,
                    [orgId, userId]
                )
            } else {
                await runSQL(
                    `INSERT OR IGNORE INTO organization (id, name, "createdDate", "updatedDate", "createdBy", "updatedBy")
                     VALUES (?, 'Default Organization', datetime('now'), datetime('now'), ?, ?)`,
                    [orgId, userId, userId]
                )
            }

            // Workspace
            if (isPostgres) {
                await runSQL(
                    `INSERT INTO workspace (id, name, "organizationId", "createdDate", "updatedDate", "createdBy", "updatedBy")
                     VALUES ($1, 'Default Workspace', $2, NOW(), NOW(), $3, $3)
                     ON CONFLICT (id) DO NOTHING`,
                    [workspaceId, orgId, userId]
                )
            } else {
                await runSQL(
                    `INSERT OR IGNORE INTO workspace (id, name, "organizationId", "createdDate", "updatedDate", "createdBy", "updatedBy")
                     VALUES (?, 'Default Workspace', ?, datetime('now'), datetime('now'), ?, ?)`,
                    [workspaceId, orgId, userId, userId]
                )
            }

            // Org user
            if (isPostgres) {
                await runSQL(
                    `INSERT INTO organization_user (id, "userId", "organizationId", "roleId", status, "createdDate", "updatedDate", "createdBy", "updatedBy")
                     VALUES ($1, $2, $3, $4, 'active', NOW(), NOW(), $2, $2) ON CONFLICT DO NOTHING`,
                    [uuidv4(), userId, orgId, roleId]
                )
                await runSQL(
                    `INSERT INTO workspace_user (id, "userId", "workspaceId", "roleId", status, "createdDate", "updatedDate", "createdBy", "updatedBy")
                     VALUES ($1, $2, $3, $4, 'active', NOW(), NOW(), $2, $2) ON CONFLICT DO NOTHING`,
                    [uuidv4(), userId, workspaceId, roleId]
                )
            } else {
                await runSQL(
                    `INSERT OR IGNORE INTO organization_user (id, "userId", "organizationId", "roleId", status, "createdDate", "updatedDate", "createdBy", "updatedBy")
                     VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'), ?, ?)`,
                    [uuidv4(), userId, orgId, roleId, userId, userId]
                )
                await runSQL(
                    `INSERT OR IGNORE INTO workspace_user (id, "userId", "workspaceId", "roleId", status, "createdDate", "updatedDate", "createdBy", "updatedBy")
                     VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'), ?, ?)`,
                    [uuidv4(), userId, workspaceId, roleId, userId, userId]
                )
            }
        } else {
            orgId = orgs[0].id

            // Get workspace
            const workspaces = await runSQL('SELECT id FROM workspace WHERE "organizationId" = $1 LIMIT 1', [orgId])
                .catch(() => runSQL('SELECT id FROM workspace WHERE "organizationId" = ? LIMIT 1', [orgId]))
            if (!workspaces || workspaces.length === 0) {
                res.status(500).json({ error: 'Organization found but no workspace. DB may be in bad state.' })
                return
            }
            workspaceId = workspaces[0].id

            // Check user
            const existingUsers = await runSQL('SELECT id FROM "user" WHERE email = $1 LIMIT 1', [adminEmail])
                .catch(() => runSQL('SELECT id FROM "user" WHERE email = ? LIMIT 1', [adminEmail]))

            if (!existingUsers || existingUsers.length === 0) {
                // Create user
                userId = uuidv4()
                let roles: any[] = []
                try {
                    roles = await runSQL('SELECT id FROM role WHERE name = $1 LIMIT 1', ['OWNER'])
                } catch {
                    roles = await runSQL('SELECT id FROM role WHERE name = ? LIMIT 1', ['OWNER'])
                }
                const roleId = roles.length > 0 ? roles[0].id : uuidv4()
                if (roles.length === 0) {
                    if (isPostgres) {
                        await runSQL(
                            `INSERT INTO role (id, name, description, "isDefault", "createdDate", "updatedDate", "createdBy", "updatedBy")
                             VALUES ($1, 'OWNER', 'Organization owner', true, NOW(), NOW(), $2, $2) ON CONFLICT DO NOTHING`,
                            [roleId, userId]
                        )
                    } else {
                        await runSQL(
                            `INSERT OR IGNORE INTO role (id, name, description, "isDefault", "createdDate", "updatedDate", "createdBy", "updatedBy")
                             VALUES (?, 'OWNER', 'Organization owner', 1, datetime('now'), datetime('now'), ?, ?)`,
                            [roleId, userId, userId]
                        )
                    }
                }

                if (isPostgres) {
                    await runSQL(
                        `INSERT INTO "user" (id, name, email, credential, status, "createdDate", "updatedDate", "createdBy", "updatedBy")
                         VALUES ($1, 'Nemu Admin', $2, $3, 'active', NOW(), NOW(), $1, $1)`,
                        [userId, adminEmail, hashedPassword]
                    )
                    await runSQL(
                        `INSERT INTO organization_user (id, "userId", "organizationId", "roleId", status, "createdDate", "updatedDate", "createdBy", "updatedBy")
                         VALUES ($1, $2, $3, $4, 'active', NOW(), NOW(), $2, $2) ON CONFLICT DO NOTHING`,
                        [uuidv4(), userId, orgId, roleId]
                    )
                    await runSQL(
                        `INSERT INTO workspace_user (id, "userId", "workspaceId", "roleId", status, "createdDate", "updatedDate", "createdBy", "updatedBy")
                         VALUES ($1, $2, $3, $4, 'active', NOW(), NOW(), $2, $2) ON CONFLICT DO NOTHING`,
                        [uuidv4(), userId, workspaceId, roleId]
                    )
                } else {
                    await runSQL(
                        `INSERT INTO "user" (id, name, email, credential, status, "createdDate", "updatedDate", "createdBy", "updatedBy")
                         VALUES (?, 'Nemu Admin', ?, ?, 'active', datetime('now'), datetime('now'), ?, ?)`,
                        [userId, adminEmail, hashedPassword, userId, userId]
                    )
                    await runSQL(
                        `INSERT OR IGNORE INTO organization_user (id, "userId", "organizationId", "roleId", status, "createdDate", "updatedDate", "createdBy", "updatedBy")
                         VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'), ?, ?)`,
                        [uuidv4(), userId, orgId, roleId, userId, userId]
                    )
                    await runSQL(
                        `INSERT OR IGNORE INTO workspace_user (id, "userId", "workspaceId", "roleId", status, "createdDate", "updatedDate", "createdBy", "updatedBy")
                         VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'), ?, ?)`,
                        [uuidv4(), userId, workspaceId, roleId, userId, userId]
                    )
                }
            } else {
                userId = existingUsers[0].id
                // Reset existing user's password
                if (isPostgres) {
                    await runSQL(`UPDATE "user" SET credential=$1, status='active', "updatedDate"=NOW() WHERE email=$2`, [
                        hashedPassword,
                        adminEmail
                    ])
                } else {
                    await runSQL(`UPDATE "user" SET credential=?, status='active', "updatedDate"=datetime('now') WHERE email=?`, [
                        hashedPassword,
                        adminEmail
                    ])
                }
            }
        }

        // 2. Delete existing API key with this name (clean slate)
        try {
            if (isPostgres) {
                await runSQL(`DELETE FROM apikey WHERE "workspaceId"=$1 AND "keyName"=$2`, [workspaceId, keyName])
            } else {
                await runSQL(`DELETE FROM apikey WHERE "workspaceId"=? AND "keyName"=?`, [workspaceId, keyName])
            }
        } catch {}

        // 3. Create API key
        const apiKey = generateAPIKey()
        const apiSecret = generateSecretHash(apiKey)
        const apiKeyId = uuidv4()

        if (isPostgres) {
            await runSQL(
                `INSERT INTO apikey (id, "apiKey", "apiSecret", "keyName", permissions, "updatedDate", "workspaceId")
                 VALUES ($1, $2, $3, $4, '[]', NOW(), $5)`,
                [apiKeyId, apiKey, apiSecret, keyName, workspaceId]
            )
        } else {
            await runSQL(
                `INSERT INTO apikey (id, "apiKey", "apiSecret", "keyName", permissions, "updatedDate", "workspaceId")
                 VALUES (?, ?, ?, ?, '[]', datetime('now'), ?)`,
                [apiKeyId, apiKey, apiSecret, keyName, workspaceId]
            )
        }

        res.json({
            success: true,
            adminEmail,
            apiKey,
            workspaceId,
            orgId,
            note: 'Save the apiKey — it will not be shown again.'
        })
    } catch (e: any) {
        res.status(500).json({ error: e.message, stack: e.stack?.substring(0, 1000) })
    }
})

export default router
