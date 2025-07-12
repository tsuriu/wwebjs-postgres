# wwebjs-postgres  
A PostgreSQL session store for whatsapp-web.js  

Persist your WhatsApp Web sessions in PostgreSQL for reliable multi-device authentication.  

## Features  

✅ **Reliable Session Storage** - Never lose your WhatsApp session  
✅ **Multi-Device Ready** - Works with WhatsApp's multi-device feature  
✅ **Automatic Backups** - Regular session backups to prevent data loss  
✅ **Easy Management** - Simple API for session operations  

## Installation  

```bash
npm install wwebjs-postgres pg whatsapp-web.js
```

## Quick Start  

```javascript
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { PostgresStore } = require('wwebjs-postgres');
const { Pool } = require('pg');

// Initialize PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/whatsapp_sessions'
});

// Create session store
const store = new PostgresStore({ pool });

// Initialize WhatsApp client
const client = new Client({
  authStrategy: new RemoteAuth({
    store: store,
    backupSyncIntervalMs: 300000 // Backup every 5 minutes
  }),
  puppeteer: {
    headless: false // Show browser window (set true for production)
  }
});

client.initialize();

client.on('qr', (qr) => {
  console.log('Scan this QR to authenticate:');
  // Display QR code in terminal
  require('qrcode-terminal').generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('Client is ready!');
});
```

## Advanced Usage  

### Session Management  

```javascript
// Check if session exists
const exists = await store.sessionExists({ session: 'my-session' });

// Force delete a session
await store.delete({ session: 'old-session' });

// List all stored sessions
const sessions = await store.listSessions();
```

### Custom Configuration  

```javascript
const store = new PostgresStore({
  pool: pool,
  tableName: 'custom_sessions_table', // Optional custom table name
  sessionIdPrefix: 'myapp-' // Optional session ID prefix
});
```

## Database Setup  

Your PostgreSQL database should have the following schema (automatically created if not exists):

```sql
CREATE TABLE whatsapp_sessions (
  session_id VARCHAR(255) PRIMARY KEY,
  session_data BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_whatsapp_sessions_updated_at ON whatsapp_sessions(updated_at);
```

## Troubleshooting  

**Connection Issues:**  
- Verify your PostgreSQL server is running  
- Check connection string format: `postgres://user:password@host:port/database`  

**Session Problems:**  
- Ensure the client has proper write permissions  
- Check storage space if sessions fail to save  

## Resources  

- [whatsapp-web.js Documentation](https://wwebjs.dev/)  
- [PostgreSQL Node.js Driver](https://node-postgres.com/)  
- [Report Issues](https://github.com/yourusername/wwebjs-postgres/issues)  

---

**Note:** Always keep your session data secure. Never expose your database credentials or session files publicly.  

---

✨ **Pro Tip:** For production deployments, set `headless: true` and consider using a process manager like PM2 to keep your WhatsApp client running 24/7.