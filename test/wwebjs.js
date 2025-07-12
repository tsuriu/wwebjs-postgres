const { Client, RemoteAuth } = require('whatsapp-web.js');
const { PostgresStore } = require('../index');
const { Pool } = require('pg');
const qrcode = require('qrcode-terminal');

// PostgreSQL connection configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://admin:admin@localhost:5432/appdb'
});

// Create PostgresStore instance with enhanced options
const store = new PostgresStore({ 
  pool,
  tableName: 'whatsapp_sessions', // Optional custom table name
  sessionTTL: 30 * 24 * 60 * 60 // Optional: 30 days TTL
});

// Session configuration
const SESSION_NAME = 'tsulabs';
const client = new Client({
  authStrategy: new RemoteAuth({
    store: store,
    backupSyncIntervalMs: 300000,
    clientId: SESSION_NAME
  }),
  puppeteer: { 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

// Initialize the client with enhanced session handling
async function initializeWhatsAppClient() {
  try {
    // Check if session exists in PostgreSQL
    const sessionExists = await store.sessionExists({ session: SESSION_NAME });
    
    if (sessionExists) {
      console.log('Existing session found in database. Restoring...');
      
      // Get session metadata
      const metadata = await store.getSessionMetadata({ session: SESSION_NAME });
      console.log('Session metadata:', metadata);
      
      // RemoteAuth will automatically restore from the store
    } else {
      console.log('No existing session found. Will create new session after authentication...');
    }

    // Initialize client regardless - RemoteAuth handles the session restoration
    client.initialize();

  } catch (error) {
    console.error('Initialization error:', error);
    process.exit(1);
  }
}

// Periodic cleanup of expired sessions
async function scheduleCleanup() {
  setInterval(async () => {
    try {
      const cleaned = await store.cleanupExpiredSessions();
      if (cleaned > 0) {
        console.log(`Cleaned up ${cleaned} expired sessions`);
      }
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }, 60 * 60 * 1000); // Run every hour
}

// Start the client
initializeWhatsAppClient();
scheduleCleanup();

// Event handlers
client.on('loading_screen', (percent, message) => {
  console.log('LOADING SCREEN', percent, message);
});

client.on('qr', async (qr) => {
  console.log('QR RECEIVED - Scan this to authenticate');
  qrcode.generate(qr, { small: true });
  
  // Optional: Pairing code request
  const pairingCodeEnabled = false;
  if (pairingCodeEnabled) {
    try {
      const pairingCode = await client.requestPairingCode('96170100100');
      console.log('Pairing code:', pairingCode);
    } catch (error) {
      console.error('Pairing code error:', error);
    }
  }
});

client.on('authenticated', async () => {
  console.log('AUTHENTICATED - Session will be saved to PostgreSQL');
  
  // Update session metadata with authentication info
  await store.updateSessionMetadata({ 
    session: SESSION_NAME, 
    metadata: { 
      authenticatedAt: Date.now(),
      status: 'authenticated' 
    }
  });
});

client.on('auth_failure', async (msg) => {
  console.error('AUTHENTICATION FAILURE', msg);
  
  // Update metadata before deleting
  await store.updateSessionMetadata({ 
    session: SESSION_NAME, 
    metadata: { 
      authFailureAt: Date.now(),
      status: 'failed',
      error: msg
    }
  });
  
  // Delete the invalid session
  const deleted = await store.delete({ session: SESSION_NAME });
  console.log(`Session deleted: ${deleted}`);
});

client.on('ready', async () => {
  console.log('READY - WhatsApp client is fully loaded');
  
  // Log version info
  const wwebVersion = await client.getWWebVersion();
  console.log(`WhatsApp Web Version: ${wwebVersion}`);

  // Update session metadata
  await store.updateSessionMetadata({ 
    session: SESSION_NAME, 
    metadata: { 
      readyAt: Date.now(),
      status: 'ready',
      wwebVersion: wwebVersion
    }
  });

  // Error handlers for the page
  client.pupPage.on('pageerror', err => {
    console.error('Page error:', err.toString());
  });
  
  client.pupPage.on('error', err => {
    console.error('Page error:', err.toString());
  });

  // Display session stats
  try {
    const stats = await store.getStats();
    console.log('Session store stats:', stats);
    
    const sessions = await store.listSessions();
    console.log('Available sessions:', sessions.length);
    sessions.forEach(session => {
      console.log(`- ${session.session}: ${session.metadata.status || 'unknown'}`);
    });
  } catch (error) {
    console.error('Stats error:', error);
  }
});

client.on('message', async msg => {
  console.log('MESSAGE RECEIVED', msg.body);
  
  // Update last activity metadata
  await store.updateSessionMetadata({ 
    session: SESSION_NAME, 
    metadata: { 
      lastMessageAt: Date.now(),
      messageCount: (await store.getSessionMetadata({ session: SESSION_NAME }))?.messageCount + 1 || 1
    }
  });
});

// Handle process termination gracefully
async function shutdown() {
  try {
    console.log('Shutting down gracefully...');
    
    // Update session metadata before shutdown
    await store.updateSessionMetadata({ 
      session: SESSION_NAME, 
      metadata: { 
        shutdownAt: Date.now(),
        status: 'shutdown'
      }
    });
    
    await client.destroy();
    await store.close();
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Shutdown error:', error);
    process.exit(1);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});