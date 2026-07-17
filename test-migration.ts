import { initDB, disconnectDB } from './config/db.js';

async function testMigration() {
    try {
        await initDB();
        console.log("Migration successful!");
    } catch (e) {
        console.error("Migration failed:", e);
    } finally {
        await disconnectDB();
    }
}

testMigration();
