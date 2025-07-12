const fs = require('fs');
const { Pool } = require('pg');
const { promisify } = require('util');
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const access = promisify(fs.access);

class PostgresStore {
    constructor(options = {}) {
        if (!options.pool && !options.connectionConfig) {
            throw new Error('Either pool or connectionConfig must be provided');
        }

        this.pool = options.pool || new Pool(options.connectionConfig);
        this.initialized = false;
        this.tableName = options.tableName || 'whatsapp_sessions';
        this.sessionTTL = options.sessionTTL || null; // TTL in seconds
    }

    async #ensureInitialized() {
        if (this.initialized) return;
        
        try {
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS ${this.tableName} (
                    session_id VARCHAR(255) PRIMARY KEY,
                    session_data BYTEA NOT NULL,
                    metadata JSONB DEFAULT '{}',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    expires_at TIMESTAMP WITH TIME ZONE
                );
                
                CREATE INDEX IF NOT EXISTS idx_${this.tableName}_updated_at 
                ON ${this.tableName}(updated_at);
                
                CREATE INDEX IF NOT EXISTS idx_${this.tableName}_expires_at 
                ON ${this.tableName}(expires_at) WHERE expires_at IS NOT NULL;
            `);
            this.initialized = true;
        } catch (error) {
            throw new Error(`Failed to initialize database: ${error.message}`);
        }
    }

    async sessionExists({ session }) {
        await this.#ensureInitialized();
        const sessionId = this.#getSessionId(session);
        
        try {
            const result = await this.pool.query(
                `SELECT session_id, created_at, updated_at, expires_at FROM ${this.tableName} 
                 WHERE session_id = $1 
                 AND (expires_at IS NULL OR expires_at > NOW())`,
                [sessionId]
            );
            
            const exists = result.rowCount > 0;
            console.log(`Session check for '${sessionId}': ${exists ? 'EXISTS' : 'NOT FOUND'}`);
            
            if (exists) {
                console.log('Session details:', result.rows[0]);
            }
            
            return exists;
        } catch (error) {
            throw new Error(`Failed to check session existence: ${error.message}`);
        }
    }
    
    async save({ session }) {
        await this.#ensureInitialized();
        const sessionId = this.#getSessionId(session);
        const filePath = `${session}.zip`;
        
        try {
            // Check if file exists first
            await access(filePath, fs.constants.F_OK);
            
            // Read session file efficiently
            const sessionData = await readFile(filePath);
            const metadata = {
                originalFilename: `${session}.zip`,
                size: sessionData.length,
                lastModified: Date.now()
            };

            // Calculate expiration if TTL is set
            const expiresAt = this.sessionTTL ? 
                new Date(Date.now() + this.sessionTTL * 1000) : null;

            await this.pool.query(`
                INSERT INTO ${this.tableName} (session_id, session_data, metadata, expires_at)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (session_id)
                DO UPDATE SET 
                    session_data = $2,
                    metadata = $3,
                    updated_at = NOW(),
                    expires_at = $4
            `, [sessionId, sessionData, metadata, expiresAt]);
            
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new Error(`Session file not found: ${filePath}`);
            }
            throw new Error(`Failed to save session: ${error.message}`);
        }
    }

    async extract({ session, path }) {
        await this.#ensureInitialized();
        const sessionId = this.#getSessionId(session);
        
        try {
            const result = await this.pool.query(
                `SELECT session_data, metadata FROM ${this.tableName} 
                 WHERE session_id = $1 
                 AND (expires_at IS NULL OR expires_at > NOW())`,
                [sessionId]
            );
            
            if (result.rowCount === 0) {
                throw new Error(`Session ${session} not found or expired`);
            }
            
            await writeFile(path, result.rows[0].session_data);
            
            // Update last accessed time
            await this.pool.query(
                `UPDATE ${this.tableName} SET updated_at = NOW() WHERE session_id = $1`,
                [sessionId]
            );
            
            return result.rows[0].metadata;
        } catch (error) {
            throw new Error(`Failed to extract session: ${error.message}`);
        }
    }

    async delete({ session }) {
        await this.#ensureInitialized();
        const sessionId = this.#getSessionId(session);
        
        try {
            const result = await this.pool.query(
                `DELETE FROM ${this.tableName} WHERE session_id = $1`,
                [sessionId]
            );
            return result.rowCount > 0;
        } catch (error) {
            throw new Error(`Failed to delete session: ${error.message}`);
        }
    }

    async listSessions() {
        await this.#ensureInitialized();
        
        try {
            const result = await this.pool.query(
                `SELECT session_id, metadata, created_at, updated_at, expires_at 
                 FROM ${this.tableName} 
                 WHERE expires_at IS NULL OR expires_at > NOW()
                 ORDER BY updated_at DESC`
            );
            
            return result.rows.map(row => ({
                session: row.session_id.replace(/^whatsapp-/, ''),
                metadata: row.metadata,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                expiresAt: row.expires_at
            }));
        } catch (error) {
            throw new Error(`Failed to list sessions: ${error.message}`);
        }
    }

    // New utility methods
    async getSessionMetadata({ session }) {
        await this.#ensureInitialized();
        const sessionId = this.#getSessionId(session);
        
        try {
            const result = await this.pool.query(
                `SELECT metadata, created_at, updated_at, expires_at 
                 FROM ${this.tableName} 
                 WHERE session_id = $1 
                 AND (expires_at IS NULL OR expires_at > NOW())`,
                [sessionId]
            );
            
            return result.rowCount > 0 ? result.rows[0] : null;
        } catch (error) {
            throw new Error(`Failed to get session metadata: ${error.message}`);
        }
    }

    async updateSessionMetadata({ session, metadata }) {
        await this.#ensureInitialized();
        const sessionId = this.#getSessionId(session);
        
        try {
            const result = await this.pool.query(
                `UPDATE ${this.tableName} 
                 SET metadata = metadata || $2, updated_at = NOW() 
                 WHERE session_id = $1 
                 AND (expires_at IS NULL OR expires_at > NOW())`,
                [sessionId, metadata]
            );
            
            return result.rowCount > 0;
        } catch (error) {
            throw new Error(`Failed to update session metadata: ${error.message}`);
        }
    }

    async cleanupExpiredSessions() {
        await this.#ensureInitialized();
        
        try {
            const result = await this.pool.query(
                `DELETE FROM ${this.tableName} 
                 WHERE expires_at IS NOT NULL AND expires_at <= NOW()`
            );
            
            return result.rowCount;
        } catch (error) {
            throw new Error(`Failed to cleanup expired sessions: ${error.message}`);
        }
    }

    async getStats() {
        await this.#ensureInitialized();
        
        try {
            const result = await this.pool.query(`
                SELECT 
                    COUNT(*) as total_sessions,
                    COUNT(*) FILTER (WHERE expires_at IS NULL OR expires_at > NOW()) as active_sessions,
                    COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at <= NOW()) as expired_sessions,
                    AVG(LENGTH(session_data)) as avg_session_size,
                    MIN(created_at) as oldest_session,
                    MAX(updated_at) as latest_activity
                FROM ${this.tableName}
            `);
            
            return result.rows[0];
        } catch (error) {
            throw new Error(`Failed to get stats: ${error.message}`);
        }
    }

    #getSessionId(session) {
        return `whatsapp-${session}`;
    }

    async close() {
        if (this.pool && !this.pool.ended) {
            await this.pool.end();
        }
    }
}

module.exports = PostgresStore;