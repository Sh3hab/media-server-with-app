const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
    }
});

const run = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
};

const get = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

const all = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

const initDatabase = () => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS series (
                id TEXT PRIMARY KEY,
                title TEXT,
                year INTEGER,
                poster TEXT,
                backdrop TEXT,
                rating REAL,
                order_num INTEGER,
                promoted INTEGER,
                description TEXT,
                videoUrl TEXT,
                subtitleUrl TEXT,
                tags TEXT,
                genres TEXT,
                countries TEXT,
                actors TEXT,
                actorRoles TEXT,
                isMovie INTEGER,
                duration TEXT,
                director TEXT,
                language TEXT,
                createdAt TEXT,
                updatedAt TEXT,
                views INTEGER DEFAULT 0,
                likes INTEGER DEFAULT 0,
                type TEXT,
                ageRating TEXT,
                titleAr TEXT,
                titleEn TEXT
            )`);

            db.run(`ALTER TABLE series ADD COLUMN titleAr TEXT`, (err) => { });
            db.run(`ALTER TABLE series ADD COLUMN titleEn TEXT`, (err) => { });

            db.run(`CREATE TABLE IF NOT EXISTS seasons (
                id TEXT PRIMARY KEY,
                seriesId TEXT,
                seriesTitle TEXT,
                seasonNumber INTEGER,
                title TEXT,
                poster TEXT,
                backdrop TEXT,
                description TEXT,
                year INTEGER,
                episodeCount INTEGER,
                createdAt TEXT,
                updatedAt TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS episodes (
                id TEXT PRIMARY KEY,
                seriesId TEXT,
                seasonId TEXT,
                episodeNumber INTEGER,
                title TEXT,
                description TEXT,
                videoUrl TEXT,
                duration TEXT,
                poster TEXT,
                thumbnail TEXT,
                isFree INTEGER DEFAULT 1,
                views INTEGER DEFAULT 0,
                likes INTEGER DEFAULT 0,
                createdAt TEXT,
                updatedAt TEXT,
                subtitleUrl TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS actors (
                id TEXT PRIMARY KEY,
                tmdbId TEXT,
                name TEXT,
                nameAr TEXT,
                nameEn TEXT,
                image TEXT,
                bio TEXT,
                nationality TEXT,
                birthDate TEXT,
                movies TEXT,
                series TEXT,
                createdAt TEXT,
                updatedAt TEXT
            )`);

            db.run(`ALTER TABLE actors ADD COLUMN tmdbId TEXT`, (err) => { });
            db.run(`ALTER TABLE actors ADD COLUMN nameAr TEXT`, (err) => { });
            db.run(`ALTER TABLE actors ADD COLUMN nameEn TEXT`, (err) => { });

            db.run(`CREATE TABLE IF NOT EXISTS admins (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE,
                password TEXT,
                name TEXT,
                role TEXT DEFAULT 'admin',
                createdAt TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS genres (
                id TEXT PRIMARY KEY,
                tmdbId INTEGER UNIQUE,
                name TEXT,
                color TEXT,
                icon TEXT,
                contentCount INTEGER DEFAULT 0
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS countries (
                id TEXT PRIMARY KEY,
                name TEXT,
                code TEXT,
                flag TEXT,
                continent TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS tags (
                id TEXT PRIMARY KEY,
                name TEXT,
                color TEXT,
                type TEXT,
                count INTEGER DEFAULT 0
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE,
                password TEXT,
                name TEXT,
                role TEXT DEFAULT 'user',
                age INTEGER DEFAULT 0,
                isGuest INTEGER DEFAULT 0,
                avatar TEXT,
                preferences TEXT,
                groupId TEXT,
                custom_restrictions TEXT DEFAULT '{"titles":[],"genres":[]}',
                download_expiry_days INTEGER DEFAULT 2,
                createdAt TEXT,
                lastActive TEXT
            )`);
            db.run(`ALTER TABLE users ADD COLUMN download_expiry_days INTEGER DEFAULT 2`, (err) => { });


            db.run(`CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                userId TEXT,
                name TEXT,
                age INTEGER DEFAULT 0,
                avatar TEXT,
                is_child INTEGER DEFAULT 0,
                ageLimit INTEGER DEFAULT 0,
                restrictions TEXT DEFAULT '[]',
                isDefault INTEGER DEFAULT 0,
                group_ids TEXT,
                blocked_genres TEXT,
                blocked_titles TEXT,
                pin TEXT,
                createdAt TEXT,
                FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
            )`);
            db.run(`ALTER TABLE profiles ADD COLUMN pin TEXT`, (err) => { });

            db.run(`CREATE TABLE IF NOT EXISTS age_groups (
                id TEXT PRIMARY KEY,
                name TEXT,
                min_age INTEGER,
                max_age INTEGER,
                allowed_genres TEXT,
                restricted_tags TEXT,
                blocked_genres TEXT DEFAULT '[]',
                blocked_titles TEXT DEFAULT '[]',
                createdAt TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS watch_history (
                id TEXT PRIMARY KEY,
                userId TEXT,
                contentId TEXT,
                contentType TEXT,
                episodeId TEXT,
                watchedAt TEXT,
                progress INTEGER DEFAULT 0,
                FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
            )`);
            db.run(`ALTER TABLE watch_history ADD COLUMN episodeId TEXT`, (err) => { });
            
            db.run(`DROP INDEX IF EXISTS idx_user_content`, (err) => {
                if (err) {
                    console.log('Note: idx_user_content could not be dropped or was already dropped:', err.message);
                } else {
                    console.log('Successfully dropped old index idx_user_content.');
                }
            });
            
            db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_content_ep ON watch_history(userId, contentId, episodeId)`);

            db.run(`CREATE TABLE IF NOT EXISTS watch_sessions (
                id TEXT PRIMARY KEY,
                userId TEXT,
                contentId TEXT,
                contentType TEXT,
                watchedAt TEXT,
                duration INTEGER DEFAULT 0,
                FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS watchlist (
                id TEXT PRIMARY KEY,
                userId TEXT,
                contentId TEXT,
                contentType TEXT,
                addedAt TEXT,
                FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS user_likes (
                id TEXT PRIMARY KEY,
                userId TEXT,
                contentId TEXT,
                contentType TEXT,
                likedAt TEXT,
                FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS parts (
                id TEXT PRIMARY KEY,
                parentId TEXT,
                parentTitle TEXT,
                parentType TEXT,
                partNumber INTEGER,
                title TEXT,
                year INTEGER,
                poster TEXT,
                description TEXT,
                duration TEXT,
                videoUrl TEXT,
                views INTEGER DEFAULT 0,
                likes INTEGER DEFAULT 0,
                createdAt TEXT,
                updatedAt TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS collections (
                id TEXT PRIMARY KEY,
                name TEXT,
                description TEXT,
                poster TEXT,
                backdrop TEXT,
                type TEXT DEFAULT 'collection',
                order_num INTEGER DEFAULT 0,
                createdAt TEXT,
                updatedAt TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS collection_items (
                id TEXT PRIMARY KEY,
                collectionId TEXT,
                mediaId TEXT,
                orderNum INTEGER,
                createdAt TEXT,
                FOREIGN KEY (collectionId) REFERENCES collections(id) ON DELETE CASCADE,
                FOREIGN KEY (mediaId) REFERENCES series(id) ON DELETE CASCADE
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                endpoint TEXT,
                method TEXT,
                ip TEXT,
                timestamp TEXT,
                admin TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS social_follows (
                id TEXT PRIMARY KEY,
                followerId TEXT,
                followingId TEXT,
                createdAt TEXT,
                status TEXT DEFAULT 'pending',
                FOREIGN KEY (followerId) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (followingId) REFERENCES users(id) ON DELETE CASCADE
            )`);

            db.run(`ALTER TABLE social_follows ADD COLUMN status TEXT DEFAULT 'pending'`, [], (err) => {

            });

            db.run(`UPDATE social_follows SET status = 'accepted' WHERE status IS NULL OR status = ''`);


            db.run(`CREATE TABLE IF NOT EXISTS social_conversations (
                id TEXT PRIMARY KEY,
                name TEXT,
                avatar TEXT,
                isGroup INTEGER DEFAULT 0,
                createdById TEXT,
                createdAt TEXT,
                FOREIGN KEY (createdById) REFERENCES users(id) ON DELETE SET NULL
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS social_conversation_members (
                id TEXT PRIMARY KEY,
                conversationId TEXT,
                userId TEXT,
                joinedAt TEXT,
                FOREIGN KEY (conversationId) REFERENCES social_conversations(id) ON DELETE CASCADE,
                FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS social_messages (
                id TEXT PRIMARY KEY,
                conversationId TEXT,
                senderId TEXT,
                messageType TEXT DEFAULT 'text',
                content TEXT,
                mediaId TEXT,
                mediaType TEXT,
                replyToId TEXT,
                createdAt TEXT,
                FOREIGN KEY (conversationId) REFERENCES social_conversations(id) ON DELETE CASCADE,
                FOREIGN KEY (senderId) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (replyToId) REFERENCES social_messages(id) ON DELETE SET NULL
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS social_message_reactions (
                id TEXT PRIMARY KEY,
                messageId TEXT,
                userId TEXT,
                emoji TEXT,
                createdAt TEXT,
                FOREIGN KEY (messageId) REFERENCES social_messages(id) ON DELETE CASCADE,
                FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(messageId, userId)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS social_message_seen (
                id TEXT PRIMARY KEY,
                messageId TEXT,
                userId TEXT,
                seenAt TEXT,
                FOREIGN KEY (messageId) REFERENCES social_messages(id) ON DELETE CASCADE,
                FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(messageId, userId)
            )`);

            resolve();
        });
    });
};

module.exports = {
    db,
    initDatabase,
    run,
    get,
    all
};