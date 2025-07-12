const { PostgresStore } = require('../src/PostgresStore');
const { Pool } = require('pg');
const fs = require('fs');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

describe('PostgresStore', () => {
    let store;
    const testSession = 'test-session';
    const testFilePath = `${testSession}.zip`;
    
    beforeAll(async () => {
        // Create a test pool
        const pool = new Pool({
            connectionString: process.env.TEST_DATABASE_URL || 'postgres://admin:admin@localhost:5432/appdb'
        });
        
        store = new PostgresStore({ pool });
        
        // Create a test session file
        await writeFile(testFilePath, Buffer.from('test session data'));
    });
    
    afterAll(async () => {
        // Cleanup
        try { await unlink(testFilePath); } catch {}
        await store.delete({ session: testSession });
        await store.close();
    });
    
    test('should initialize database', async () => {
        await expect(store.sessionExists({ session: testSession }))
            .resolves.toBe(false);
    });
    
    test('should save and retrieve session', async () => {
        await store.save({ session: testSession });
        
        const exists = await store.sessionExists({ session: testSession });
        expect(exists).toBe(true);
        
        const sessions = await store.listSessions();
        expect(sessions).toContain(testSession);
    });
    
    test('should extract session', async () => {
        const extractPath = 'extracted-session.zip';
        await store.extract({ session: testSession, path: extractPath });
        
        expect(fs.existsSync(extractPath)).toBe(true);
        await unlink(extractPath);
    });
    
    test('should delete session', async () => {
        await store.delete({ session: testSession });
        const exists = await store.sessionExists({ session: testSession });
        expect(exists).toBe(false);
    });
});