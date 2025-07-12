import { Pool, PoolConfig } from 'pg';

interface SessionMetadata {
    originalFilename?: string;
    size?: number;
    lastModified?: number;
    [key: string]: any;
}

interface SessionInfo {
    session: string;
    metadata: SessionMetadata;
    createdAt: Date;
    updatedAt: Date;
    expiresAt?: Date;
}

interface SessionStats {
    total_sessions: number;
    active_sessions: number;
    expired_sessions: number;
    avg_session_size: number;
    oldest_session: Date;
    latest_activity: Date;
}

interface PostgresStoreOptions {
    pool?: Pool;
    connectionConfig?: PoolConfig;
    tableName?: string;
    sessionTTL?: number; // Time to live in seconds
}

declare class PostgresStore {
    constructor(options: PostgresStoreOptions);
    
    sessionExists(options: { session: string }): Promise<boolean>;
    save(options: { session: string }): Promise<void>;
    extract(options: { session: string; path: string }): Promise<SessionMetadata>;
    delete(options: { session: string }): Promise<boolean>;
    listSessions(): Promise<SessionInfo[]>;
    
    // New utility methods
    getSessionMetadata(options: { session: string }): Promise<SessionMetadata | null>;
    updateSessionMetadata(options: { session: string; metadata: SessionMetadata }): Promise<boolean>;
    cleanupExpiredSessions(): Promise<number>;
    getStats(): Promise<SessionStats>;
    
    close(): Promise<void>;
}

export = PostgresStore;