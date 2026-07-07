const fs = require('fs');
const path = require('path');
const { initDatabase, run } = require('./database');

async function migrate() {
    console.log('Starting migration...');
    await initDatabase();

    const dataDir = path.join(__dirname, 'data');
    const dbJsonPath = path.join(dataDir, 'db.json');
    const adminsJsonPath = path.join(dataDir, 'admins.json');
    const logsJsonPath = path.join(dataDir, 'logs.json');

    if (fs.existsSync(dbJsonPath)) {
        console.log('Migrating db.json...');
        const dbData = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));

        const insertData = async (table, items, mappingFn) => {
            if (!items || items.length === 0) return;
            console.log(`Inserting ${items.length} items into ${table}...`);
            for (const item of items) {
                const row = mappingFn(item);
                const keys = Object.keys(row);
                const values = Object.values(row);
                const placeholders = keys.map(() => '?').join(',');
                const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`;
                await run(sql, values);
            }
        };

        await insertData('series', dbData.series, item => ({
            id: item.id,
            title: item.title,
            year: item.year,
            poster: item.poster,
            rating: item.rating,
            order_num: item.order,
            promoted: item.promoted ? 1 : 0,
            description: item.description,
            videoUrl: item.videoUrl,
            subtitleUrl: item.subtitleUrl,
            tags: JSON.stringify(item.tags || []),
            genres: JSON.stringify(item.genres || []),
            countries: JSON.stringify(item.countries || []),
            actors: JSON.stringify(item.actors || []),
            actorRoles: JSON.stringify(item.actorRoles || []),
            isMovie: item.isMovie ? 1 : 0,
            duration: item.duration,
            director: item.director,
            language: item.language,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            views: item.views || 0,
            likes: item.likes || 0,
            type: item.type
        }));

        await insertData('seasons', dbData.seasons, item => ({
            id: item.id,
            seriesId: item.seriesId,
            seriesTitle: item.seriesTitle,
            seasonNumber: item.seasonNumber,
            title: item.title,
            poster: item.poster,
            description: item.description,
            year: item.year,
            episodeCount: item.episodeCount || 0,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt
        }));

        await insertData('episodes', dbData.episodes, item => ({
            id: item.id,
            seriesId: item.seriesId,
            seasonId: item.seasonId,
            episodeNumber: item.episodeNumber,
            title: item.title,
            description: item.description,
            videoUrl: item.videoUrl,
            duration: item.duration,
            poster: item.poster,
            thumbnail: item.thumbnail,
            isFree: item.isFree ? 1 : 0,
            views: item.views || 0,
            likes: item.likes || 0,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            subtitleUrl: item.subtitleUrl
        }));

        await insertData('actors', dbData.actors, item => ({
            id: item.id,
            name: item.name,
            image: item.image,
            bio: item.bio,
            nationality: item.nationality,
            birthDate: item.birthDate,
            movies: JSON.stringify(item.movies || []),
            series: JSON.stringify(item.series || []),
            createdAt: item.createdAt,
            updatedAt: item.updatedAt
        }));

        await insertData('genres', dbData.genres, item => ({
            id: item.id,
            name: item.name,
            color: item.color,
            icon: item.icon
        }));

        await insertData('countries', dbData.countries, item => ({
            id: item.id,
            name: item.name,
            code: item.code,
            flag: item.flag,
            continent: item.continent
        }));

        await insertData('tags', dbData.tags, item => ({
            id: item.id,
            name: item.name,
            color: item.color,
            type: item.type,
            count: item.count || 0
        }));

        await insertData('users', dbData.users, item => ({
            id: item.id,
            username: item.username,
            isGuest: item.isGuest ? 1 : 0,
            createdAt: item.createdAt,
            lastActive: item.lastActive,
            avatar: item.avatar,
            preferences: JSON.stringify(item.preferences || {})
        }));

        if (dbData.profiles) {
            await insertData('profiles', dbData.profiles, item => ({
                id: item.id,
                userId: item.userId,
                name: item.name,
                avatar: item.avatar,
                isDefault: item.isDefault ? 1 : 0,
                createdAt: item.createdAt
            }));
        }

        if (dbData.watchlist) {
            await insertData('watchlist', dbData.watchlist, item => ({
                id: item.id,
                userId: item.userId,
                contentId: item.contentId,
                contentType: item.contentType,
                addedAt: item.addedAt
            }));
        }
    }

    if (fs.existsSync(adminsJsonPath)) {
        console.log('Migrating admins.json...');
        const adminsData = JSON.parse(fs.readFileSync(adminsJsonPath, 'utf8'));
        if (adminsData.admins) {
            for (const admin of adminsData.admins) {
                await run(`INSERT OR REPLACE INTO admins (id, username, password, name, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)`, 
                    [admin.id, admin.username, admin.password, admin.name, admin.role, admin.createdAt]);
            }
        }
    }

    if (fs.existsSync(logsJsonPath)) {
        console.log('Migrating logs.json...');
        const logsData = JSON.parse(fs.readFileSync(logsJsonPath, 'utf8'));
        if (logsData.logs) {
            for (const log of logsData.logs) {
                await run(`INSERT INTO logs (endpoint, method, ip, timestamp, admin) VALUES (?, ?, ?, ?, ?)`, 
                    [log.endpoint, log.method, log.ip, log.timestamp, log.admin]);
            }
        }
    }

    console.log('Migration completed successfully!');
    process.exit(0);
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
