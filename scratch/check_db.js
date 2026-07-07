const db = require('../database');
async function check() {
    try {
        const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
        console.log('Tables:', tables.map(t => t.name).join(', '));
        const episodesCount = await db.get("SELECT COUNT(*) as count FROM episodes");
        console.log('Episodes count:', episodesCount.count);
    } catch (e) {
        console.error('Error:', e.message);
    }
}
check();
