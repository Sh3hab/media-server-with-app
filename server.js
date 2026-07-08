require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const db = require('./database');
const { v4: uuidv4 } = require('uuid');

const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
    maxHttpBufferSize: 50 * 1024 * 1024,
    cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(__dirname));


app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
    next();
});

const folders = [
    'data',
    'uploads/posters',
    'uploads/posters/backdrops',
    'uploads/actors',
    'uploads/episodes',
    'uploads/movies',
    'uploads/flags',
    'uploads/others'
];

folders.forEach(folder => {
    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
    }
});

db.initDatabase().then(() => console.log('Database initialized')).catch(err => console.error('Database init error:', err));

async function resolveGenreNames(items) {
    if (!items || !Array.isArray(items)) return items;
    const genres = await db.all('SELECT id, name FROM genres');
    const genreMap = {};
    genres.forEach(g => genreMap[g.id] = g.name);

    return items.map(item => {
        let genreIds = [];
        try {
            genreIds = typeof item.genres === 'string' ? JSON.parse(item.genres) : (item.genres || []);
        } catch (e) { genreIds = []; }

        const resolvedGenres = genreIds.map(g => {
            if (typeof g === 'object' && g.name) return g.name;
            return genreMap[g] || g;
        });

        return { ...item, genres: resolvedGenres };
    });
}
const authenticateAdmin = (req, res, next) => {
    const token = req.headers['x-admin-token'];
    if (token === ADMIN_TOKEN) {
        next();
    } else {
        res.status(401).json({ error: 'الوصول مرفوض. يلزم تسجيل الدخول.' });
    }
};
function formatDuration(minutes) {
    if (!minutes) return "00:00:00";
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const secs = 0;
    return [hrs, mins, secs].map(v => v < 10 ? "0" + v : v).join(":");
}
async function downloadImage(url, folder) {
    if (!url || !url.startsWith('http')) return url;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        // Ensure folder exists
        if (!fs.existsSync(folder)) {
            fs.mkdirSync(folder, { recursive: true });
        }
        const extension = path.extname(url.split('?')[0]) || '.jpg';
        const filename = `${uuidv4()}${extension}`;
        const filePath = path.join(folder, filename);
        fs.writeFileSync(filePath, buffer);
        // Return relative URL for frontend
        const relativePath = folder.replace(/\\/g, '/');
        return `/${relativePath}/${filename}`;
    } catch (error) {
        console.error('Error downloading image:', error);
        return url; 
    }
}
app.post('/api/tmdb/import', authenticateAdmin, async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'الرابط مطلوب' });
    try {
        // Extract type and id from URL
        const movieMatch = url.match(/movie\/(\d+)/);
        const tvMatch = url.match(/tv\/(\d+)/);
        const type = movieMatch ? 'movie' : (tvMatch ? 'tv' : null);
        const id = movieMatch ? movieMatch[1] : (tvMatch ? tvMatch[1] : null);
        if (!type || !id) {
            return res.status(400).json({ error: 'رابط TMDB غير صالح' });
        }
      
        const [tmdbResAr, tmdbResEn] = await Promise.all([
            fetch(`https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}&language=ar&append_to_response=credits,content_ratings,release_dates,keywords`),
            fetch(`https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}&language=en-US&append_to_response=credits`)
        ]);

        const dataAr = await tmdbResAr.json();
        const dataEn = await tmdbResEn.json();

        if (dataAr.status_code === 34) {
            return res.status(404).json({ error: 'المحتوى غير موجود في TMDB' });
        }

        let ageRating = '';
        if (type === 'movie') {
            const releases = dataAr.release_dates?.results || [];
            const usRelease = releases.find(r => r.iso_3166_1 === 'US') || releases[0];
            if (usRelease) {
                ageRating = usRelease.release_dates.find(rd => rd.certification)?.certification || '';
            }
        } else if (type === 'tv') {
            const ratings = dataAr.content_ratings?.results || [];
            const usRating = ratings.find(r => r.iso_3166_1 === 'US') || ratings[0];
            ageRating = usRating?.rating || '';
        }

        const isEnglishPreferred = url.includes('language=en');
        let finalPosterAr = dataAr.poster_path ? `https://image.tmdb.org/t/p/w500${dataAr.poster_path}` : '';
        let finalPosterEn = dataEn.poster_path ? `https://image.tmdb.org/t/p/w500${dataEn.poster_path}` : '';

        if (isEnglishPreferred && finalPosterEn) {
            const temp = finalPosterAr;
            finalPosterAr = finalPosterEn;
            finalPosterEn = temp;
        }

        let primaryTag = '';
        const keywordsList = type === 'movie' ? (dataAr.keywords?.keywords || []) : (dataAr.keywords?.results || []);
        if (keywordsList.length > 0) {
            primaryTag = keywordsList[0].name;
        }

        const responseData = {
            id: dataAr.id,
            titleAr: dataAr.title || dataAr.name || '',
            titleEn: dataEn.title || dataEn.name || '',
            year: (dataAr.release_date || dataAr.first_air_date || '').split('-')[0],
            posterAr: finalPosterAr,
            posterEn: finalPosterEn,
            backdrop: dataAr.backdrop_path ? `https://image.tmdb.org/t/p/original${dataAr.backdrop_path}` : '',
            rating: dataAr.vote_average ? parseFloat(dataAr.vote_average).toFixed(1) : '0.0',
            ageRating: ageRating,
            tags: primaryTag,
            descriptionAr: dataAr.overview || '',
            descriptionEn: dataEn.overview || '',
            genres: (dataAr.genres || []).map(g => ({ id: g.id, name: g.name })),
            countries: (dataAr.production_countries || []).map(c => c.name),
            isMovie: type === 'movie',
            duration: dataAr.runtime ? `${dataAr.runtime} دقيقة` : (dataAr.episode_run_time ? `${dataAr.episode_run_time[0]} دقيقة` : ''),
            language: dataAr.original_language,
            director: (dataAr.credits?.crew || []).find(c => c.job === 'Director')?.name || '',
            actorRoles: (dataAr.credits?.cast || []).slice(0, 15).map((member, idx) => {
                const enMember = (dataEn.credits?.cast || []).find(c => c.id === member.id) || {};
                return {
                    actorId: member.id,
                    actorNameAr: member.name || '',
                    actorNameEn: enMember.name || member.name || '',
                    actorName: member.name || enMember.name || '', 
                    roleName: member.character || enMember.character || '',
                    image: member.profile_path ? `https://image.tmdb.org/t/p/w500${member.profile_path}` : ''
                };
            })
        };

        if (type === 'tv') {
            const seasons = [];
            for (const s of (dataAr.seasons || [])) {
                if (s.season_number === 0) continue;

                const [seasonResAr, seasonResEn] = await Promise.all([
                    fetch(`https://api.themoviedb.org/3/tv/${id}/season/${s.season_number}?api_key=${TMDB_API_KEY}&language=ar`),
                    fetch(`https://api.themoviedb.org/3/tv/${id}/season/${s.season_number}?api_key=${TMDB_API_KEY}&language=en-US`)
                ]);

                const sDataAr = await seasonResAr.json();
                const sDataEn = await seasonResEn.json();

              
                const sEnMain = (dataEn.seasons || []).find(se => se.season_number === s.season_number) || {};

                seasons.push({
                    seasonNumber: s.season_number,
                    titleAr: s.name || '',
                    titleEn: sEnMain.name || '',
                    descriptionAr: s.overview || '',
                    descriptionEn: sEnMain.overview || '',
                    posterAr: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : responseData.posterAr,
                    posterEn: sEnMain.poster_path ? `https://image.tmdb.org/t/p/w500${sEnMain.poster_path}` : responseData.posterEn,
                    backdrop: dataAr.backdrop_path ? `https://image.tmdb.org/t/p/original${dataAr.backdrop_path}` : '',
                    year: (s.air_date || '').split('-')[0] || responseData.year,
                    episodes: (sDataAr.episodes || []).map((e, index) => {
                        const eEn = sDataEn.episodes ? sDataEn.episodes[index] : {};
                        return {
                            episodeNumber: e.episode_number,
                            titleAr: e.name || '',
                            titleEn: eEn.name || '',
                            descriptionAr: e.overview || '',
                            descriptionEn: eEn.overview || '',
                            image: e.still_path ? `https://image.tmdb.org/t/p/w500${e.still_path}` : '',
                            duration: e.runtime ? `${e.runtime} دقيقة` : responseData.duration
                        };
                    })
                });
            }
            responseData.seasons = seasons;
        }
        res.json(responseData);
    } catch (error) {
        res.status(500).json({ error: 'خطأ في جلب بيانات TMDB: ' + error.message });
    }
});

app.get('/api/tmdb/search', authenticateAdmin, async (req, res) => {
    const { query, type } = req.query;
    if (!query) return res.status(400).json({ error: 'البحث مطلوب' });
    try {
        const searchType = type === 'series' ? 'tv' : 'movie';
        const response = await fetch(`https://api.themoviedb.org/3/search/${searchType}?api_key=${TMDB_API_KEY}&language=ar&query=${encodeURIComponent(query)}`);
        const data = await response.json();
        const results = (data.results || []).map(item => ({
            id: item.id,
            title: item.title || item.name,
            year: (item.release_date || item.first_air_date || '').split('-')[0],
            poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '/assets/default-poster.png',
            backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : '',
            type: searchType,
            url: `https://www.themoviedb.org/${searchType}/${item.id}`
        }));
        res.json({ results });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في بحث TMDB: ' + error.message });
    }
});

const logRequest = (req, res, next) => {
    const logData = [
        req.originalUrl,
        req.method,
        req.ip,
        new Date().toISOString(),
        req.headers['x-admin-user'] || 'unknown'
    ];
    db.run(`INSERT INTO logs (endpoint, method, ip, timestamp, admin) VALUES (?, ?, ?, ?, ?)`, logData)
        .catch(err => console.error("Error writing logs:", err));
    next();
};

async function resolveGenreNames(seriesData) {
    if (!seriesData) return seriesData;
    const isArray = Array.isArray(seriesData);
    const data = isArray ? seriesData : [seriesData];

    try {
        const allGenres = await db.all('SELECT id, name FROM genres');
        const genreMap = {};
        allGenres.forEach(g => genreMap[g.id] = g.name);

        const mappedData = data.map(s => {
            let genreIds = [];
            try {
                genreIds = JSON.parse(s.genres || '[]');
            } catch (e) {
                genreIds = s.genres ? (Array.isArray(s.genres) ? s.genres : [s.genres]) : [];
            }

            return {
                ...s,
                genres: genreIds.map(id => genreMap[id] || id)
            };
        });

        return isArray ? mappedData : mappedData[0];
    } catch (error) {
        console.error('Error resolving genre names:', error);
        return seriesData;
    }
}
app.use(logRequest);
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const type = req.query.type || req.body.type || 'other';
        let folder = 'uploads/';
        switch (type) {
            case 'poster': folder += 'posters/'; break;
            case 'backdrop': folder += 'posters/backdrops/'; break;
            case 'actor': folder += 'actors/'; break;
            case 'episode': folder += 'episodes/'; break;
            case 'movie': folder += 'movies/'; break;
            case 'flag': folder += 'flags/'; break;
            default: folder += 'others/';
        }
        if (!fs.existsSync(folder)) {
            fs.mkdirSync(folder, { recursive: true });
        }
        cb(null, folder);
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 3.5 * 1024 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        cb(null, true);
    }
});


app.get('/api/admin/content-titles', authenticateAdmin, (req, res) => {
    res.json([
        { id: '1', title: '' },
        { id: '2', title: '' },
        { id: '3', title: '' }
    ]);
});
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/apk', (req, res) => {
    res.sendFile(path.join(__dirname, 'apk.html'));
});
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});
app.get('/srt', (req, res) => {
    res.sendFile(path.join(__dirname, 'conv.html'));
});
app.get('/404', (req, res) => {
    res.sendFile(path.join(__dirname, '404.html'));
});
app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const admin = await db.get('SELECT * FROM admins WHERE username = ? AND password = ?', [username, password]);
        if (admin) {
            res.json({
                success: true,
                token: ADMIN_TOKEN,
                admin: {
                    id: admin.id,
                    username: admin.username,
                    name: admin.name,
                    role: admin.role
                }
            });
        } else {
            res.status(401).json({ success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post('/api/upload', authenticateAdmin, upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
        const type = req.query.type || req.body.type || 'other';
        let folderName = 'others';
        if (type === 'poster') folderName = 'posters';
        else if (type === 'backdrop') folderName = 'posters/backdrops';
        else if (['actor', 'episode', 'movie', 'flag'].includes(type)) folderName = type + 's';

        const fileUrl = `/uploads/${folderName}/${req.file.filename}`;
        res.json({
            success: true,
            filename: req.file.filename,
            originalname: req.file.originalname,
            url: fileUrl,
            size: req.file.size,
            mimetype: req.file.mimetype,
            type: type
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        const userRow = await db.get("SELECT COUNT(*) as count FROM users");
        const movieRow = await db.get("SELECT COUNT(*) as count FROM series WHERE isMovie = 1");
        const seriesRow = await db.get("SELECT COUNT(*) as count FROM series WHERE isMovie = 0");

        res.json({
            success: true,
            users: userRow ? userRow.count : 0,
            movies: movieRow ? movieRow.count : 0,
            series: seriesRow ? seriesRow.count : 0,
            views: '0'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post('/api/admin/update-content-order', authenticateAdmin, async (req, res) => {
    const { orders } = req.body;
    if (!orders || !Array.isArray(orders)) {
        return res.status(400).json({ error: 'Orders array is required' });
    }

    try {
        await db.run('BEGIN TRANSACTION');
        for (const item of orders) {
            await db.run('UPDATE series SET order_num = ? WHERE id = ?', [item.order_num, item.id]);
        }
        await db.run('COMMIT');
        res.json({ success: true, message: 'Content order updated successfully' });
    } catch (error) {
        await db.run('ROLLBACK');
        console.error('Error updating content order:', error);
        res.status(500).json({ error: 'Failed to update content order' });
    }
});

app.get('/api/series', async (req, res) => {
    try {
        const series = await db.all('SELECT * FROM series WHERE isMovie = 0');

        const seasons = await db.all('SELECT * FROM seasons');
        const episodes = await db.all('SELECT * FROM episodes');
        const enhancedSeries = series.map(s => ({
            ...s,
            tags: JSON.parse(s.tags || '[]'),
            genres: JSON.parse(s.genres || '[]'),
            countries: JSON.parse(s.countries || '[]'),
            actors: JSON.parse(s.actors || '[]'),
            actorRoles: JSON.parse(s.actorRoles || '[]'),
            promoted: !!s.promoted,
            isMovie: !!s.isMovie,
            seasons: seasons.filter(season => season.seriesId === s.id),
            totalEpisodes: episodes.filter(ep => ep.seriesId === s.id).length
        }));
        enhancedSeries.sort((a, b) => a.order_num - b.order_num);
        const resolvedSeries = await resolveGenreNames(enhancedSeries);
        const finalSeries = await filterContentForUser(resolvedSeries, req.query.userId, req.query.profileId);
        res.json(finalSeries);
    } catch (error) {
        res.status(500).json({ error: 'خطأ في قراءة البيانات' });
    }
});

app.get('/api/movies', async (req, res) => {
    try {
        const movies = await db.all('SELECT * FROM series WHERE isMovie = 1');
        const enhancedMovies = movies.map(s => ({
            ...s,
            tags: JSON.parse(s.tags || '[]'),
            genres: JSON.parse(s.genres || '[]'),
            countries: JSON.parse(s.countries || '[]'),
            actors: JSON.parse(s.actors || '[]'),
            actorRoles: JSON.parse(s.actorRoles || '[]'),
            promoted: !!s.promoted,
            isMovie: true
        }));
        enhancedMovies.sort((a, b) => a.order_num - b.order_num);
        const resolvedMovies = await resolveGenreNames(enhancedMovies);
        const finalMovies = await filterContentForUser(resolvedMovies, req.query.userId, req.query.profileId);
        res.json(finalMovies);
    } catch (error) {
        res.status(500).json({ error: 'خطأ في قراءة الأفلام' });
    }
});
app.post('/api/movies', async (req, res) => {
    try {
        const newMovie = {
            id: Date.now().toString(),
            title: req.body.title,
            videoUrl: req.body.videoUrl || '',
            subtitleUrl: req.body.subtitleUrl || '',
            isMovie: 1,
            type: 'movie',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        await db.run(
            `INSERT INTO series (id, title, videoUrl, subtitleUrl, isMovie, type, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [newMovie.id, newMovie.title, newMovie.videoUrl, newMovie.subtitleUrl, 1, 'movie', newMovie.createdAt, newMovie.updatedAt]
        );
        res.json(newMovie);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/series/:id', async (req, res) => {
    try {
        const userId = req.query.userId || (req.body ? req.body.userId : null);
        const isAllowed = await isContentAllowedForUser(req.params.id, userId);
        if (!isAllowed) {
            return res.status(403).json({ error: 'هذا المحتوى محظور عليك أو غير متاح لفئتك العمرية.' });
        }

        const series = await db.get('SELECT * FROM series WHERE id = ?', [req.params.id]);

        if (!series) return res.status(404).json({ error: 'المحتوى غير موجود' });
        const seasons = await db.all('SELECT * FROM seasons WHERE seriesId = ?', [series.id]);
        const episodes = await db.all('SELECT * FROM episodes WHERE seriesId = ?', [series.id]);
        const actorIds = JSON.parse(series.actors || '[]');
        const actors = await db.all(`SELECT * FROM actors WHERE id IN (${actorIds.map(() => '?').join(',') || 'NULL'})`, actorIds);
        const actorRoles = JSON.parse(series.actorRoles || '[]');
        const fullSeries = {
            ...series,
            tags: JSON.parse(series.tags || '[]'),
            genres: JSON.parse(series.genres || '[]'),
            countries: JSON.parse(series.countries || '[]'),
            actors: actors.map(a => ({
                ...a,
                movies: JSON.parse(a.movies || '[]'),
                series: JSON.parse(a.series || '[]')
            })),
            actorRoles,
            promoted: !!series.promoted,
            isMovie: !!series.isMovie,
            seasons,
            episodes: episodes.map(ep => {
                const season = seasons.find(s => s.id === ep.seasonId);
                return {
                    ...ep,
                    isFree: !!ep.isFree,
                    seasonPoster: season ? season.poster : '',
                    seriesPoster: series.poster
                };
            }),
            totalEpisodes: episodes.length,
            totalSeasons: seasons.length
        };
        const resolvedSeries = await resolveGenreNames(fullSeries);

        const collection = await db.get(`
            SELECT c.id, c.name 
            FROM collection_items ci
            JOIN collections c ON ci.collectionId = c.id
            WHERE ci.mediaId = ?
        `, [series.id]);

        if (collection) {
            const allItems = await db.all('SELECT mediaId FROM collection_items WHERE collectionId = ? ORDER BY orderNum ASC', [collection.id]);
            const currentIdx = allItems.findIndex(i => i.mediaId === series.id);
            resolvedSeries.collectionInfo = {
                id: collection.id,
                name: collection.name,
                partIndex: currentIdx + 1,
                totalParts: allItems.length,
                remainingParts: allItems.length - (currentIdx + 1)
            };
        }

        res.json(resolvedSeries);
    } catch (error) {
        res.status(500).json({ error: 'خطأ في قراءة البيانات: ' + error.message });
    }
});
app.post('/api/series', async (req, res) => {
    try {
        const {
            title, titleAr, titleEn, year, poster, backdrop, rating, order, promoted, description,
            tags, genres, countries, actors, actorRoles, isMovie, duration, director, language,
            videoUrl, subtitleUrl, ageRating
        } = req.body;
        let parsedActorRoles = [];
        try {
            parsedActorRoles = Array.isArray(actorRoles) ? actorRoles : (actorRoles ? JSON.parse(actorRoles) : []);
        } catch (e) { }

        let parsedActors = Array.isArray(actors) ? actors : (actors ? actors.split(',').map(a => a.trim()) : []);
        let finalActors = [];
        let finalActorRoles = [];

        for (const role of parsedActorRoles) {
            if (role.image && role.image.startsWith('http')) {
              
                let actor = null;
                if (role.actorId) {
                    actor = await db.get('SELECT * FROM actors WHERE tmdbId = ?', [role.actorId]);
                }
                if (!actor) {
                    const searchName = role.actorName || role.actorNameAr || role.actorNameEn;
                    actor = await db.get('SELECT * FROM actors WHERE name = ? OR nameAr = ? OR nameEn = ?',
                        [searchName, role.actorNameAr, role.actorNameEn]);
                }

                let finalActorId;
                let localImage = role.image;

                if (!actor) {
                 
                    let bio = '';
                    let birthDate = '';
                    let nationality = '';

                    if (role.actorId) {
                        try {
                            const personRes = await fetch(`https://api.themoviedb.org/3/person/${role.actorId}?api_key=${TMDB_API_KEY}&language=ar`);
                            const personData = await personRes.json();
                            if (personData && personData.id) {
                                bio = personData.biography || '';
                                birthDate = personData.birthday || '';
                                nationality = personData.place_of_birth || '';
                            }
                        } catch (err) {
                            console.error('Error fetching actor details:', err);
                        }
                    }

                    finalActorId = uuidv4();
                    localImage = await downloadImage(role.image, 'uploads/actors');
                    await db.run('INSERT INTO actors (id, tmdbId, name, nameAr, nameEn, image, bio, nationality, birthDate, movies, series, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [finalActorId, role.actorId, role.actorName || role.actorNameAr, role.actorNameAr, role.actorNameEn, localImage, bio, nationality, birthDate, '[]', '[]', new Date().toISOString(), new Date().toISOString()]
                    );
                } else {
                    finalActorId = actor.id;
                    localImage = actor.image;

                    
                    const updates = [];
                    const params = [];
                    if (!actor.tmdbId && role.actorId) { updates.push('tmdbId = ?'); params.push(role.actorId); }
                    if (!actor.nameAr && role.actorNameAr) { updates.push('nameAr = ?'); params.push(role.actorNameAr); }
                    if (!actor.nameEn && role.actorNameEn) { updates.push('nameEn = ?'); params.push(role.actorNameEn); }

                    if (updates.length > 0) {
                        params.push(actor.id);
                        await db.run(`UPDATE actors SET ${updates.join(', ')} WHERE id = ?`, params);
                    }
                }

                if (!finalActors.includes(finalActorId)) finalActors.push(finalActorId);
                finalActorRoles.push({
                    actorId: finalActorId,
                    actorName: role.actorName,
                    characterName: role.roleName || '',
                    role: 'ممثل',
                    image: localImage
                });
            } else {

                if (!finalActors.includes(role.actorId)) finalActors.push(role.actorId);
                finalActorRoles.push(role);
            }
        }

       
        for (const aId of parsedActors) {
            if (!finalActors.includes(aId) && aId !== '') finalActors.push(aId);
        }

        const id = 'series_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const isMovieVal = (isMovie === true || isMovie === 'true' || isMovie === 1);

        // Update actors' filmography
        for (const role of finalActorRoles) {
            const actorId = role.actorId;
            const actorRecord = await db.get('SELECT * FROM actors WHERE id = ?', [actorId]);
            if (actorRecord) {
                let moviesList = [];
                let seriesList = [];
                try { moviesList = JSON.parse(actorRecord.movies || '[]'); } catch (e) { }
                try { seriesList = JSON.parse(actorRecord.series || '[]'); } catch (e) { }

                const entry = { id: id, title: title.trim(), role: role.characterName || 'ممثل' };

                if (isMovieVal) {
                    if (!moviesList.find(m => m.id === id)) {
                        moviesList.push(entry);
                        await db.run('UPDATE actors SET movies = ?, updatedAt = ? WHERE id = ?',
                            [JSON.stringify(moviesList), new Date().toISOString(), actorId]);
                    }
                } else {
                    if (!seriesList.find(s => s.id === id)) {
                        seriesList.push(entry);
                        await db.run('UPDATE actors SET series = ?, updatedAt = ? WHERE id = ?',
                            [JSON.stringify(seriesList), new Date().toISOString(), actorId]);
                    }
                }
            }
        }

       
        let incomingGenres = [];
        if (Array.isArray(genres)) {
            incomingGenres = genres;
        } else if (typeof genres === 'string' && genres.trim()) {
            incomingGenres = genres.split(',').map(g => g.trim()).filter(Boolean);
        }
        const finalGenreIds = [];

        for (const g of incomingGenres) {
            let genreName = typeof g === 'string' ? g : g.name;
            let tmdbId = typeof g === 'object' ? g.id : null;

            if (tmdbId) {
                // Check by TMDB ID as requested
                let existingGenre = await db.get('SELECT id FROM genres WHERE tmdbId = ?', [tmdbId]);
                if (existingGenre) {
                    finalGenreIds.push(existingGenre.id);
                } else {
                    // Create new genre with this TMDB ID
                    const newId = 'genre_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                    await db.run('INSERT INTO genres (id, tmdbId, name, color, icon) VALUES (?, ?, ?, ?, ?)',
                        [newId, tmdbId, genreName, '#1bd68e', 'fa-tag']);
                    finalGenreIds.push(newId);
                }
            } else if (genreName) {
                // Fallback for manual entry or names-only list
                let existingGenre = await db.get('SELECT id FROM genres WHERE name = ?', [genreName]);
                if (existingGenre) {
                    finalGenreIds.push(existingGenre.id);
                } else {
                    const newId = 'genre_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                    await db.run('INSERT INTO genres (id, name, color, icon) VALUES (?, ?, ?, ?)',
                        [newId, genreName, '#1bd68e', 'fa-tag']);
                    finalGenreIds.push(newId);
                }
            }
        }


        const newSeries = {
            id: id,
            title: title.trim(),
            titleAr: titleAr || '',
            titleEn: titleEn || '',
            year: parseInt(year) || new Date().getFullYear(),
            poster: await downloadImage(poster, 'uploads/posters'),
            backdrop: await downloadImage(backdrop, 'uploads/posters/backdrops'),
            rating: parseFloat(rating) || 0.0,
            order_num: parseInt(order) || 0,
            promoted: (promoted === true || promoted === 'true') ? 1 : 0,
            description: description || '',
            videoUrl: videoUrl || '',
            subtitleUrl: subtitleUrl || '',
            tags: JSON.stringify(Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()) : [])),
            genres: JSON.stringify(finalGenreIds), // Store IDs
            countries: JSON.stringify(Array.isArray(countries) ? countries : (countries ? countries.split(',').map(c => c.trim()) : [])),
            actors: JSON.stringify(finalActorRoles.map(r => ({ actorId: r.actorId, actorName: r.actorName }))),
            actorRoles: JSON.stringify(finalActorRoles),
            isMovie: (isMovie === true || isMovie === 'true') ? 1 : 0,
            duration: duration || '',
            director: director || '',
            language: language || 'ar',
            ageRating: ageRating || 'G',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            views: 0,
            likes: 0,
            type: (isMovie === true || isMovie === 'true') ? 'movie' : 'series'
        };
        const keys = Object.keys(newSeries);
        const values = Object.values(newSeries);
        const sqlSeries = `INSERT INTO series (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
        await db.run(sqlSeries, values);
        res.json({ success: true, message: 'تم الإضافة بنجاح', series: newSeries });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في الحفظ: ' + error.message });
    }
});
app.put('/api/series/:id', async (req, res) => {
    try {
        const series = await db.get('SELECT * FROM series WHERE id = ?', [req.params.id]);
        if (!series) return res.status(404).json({ error: 'غير موجود' });

        const updates = { ...req.body };

        // Handle images download if they are from TMDB
        if (updates.poster && updates.poster.startsWith('http')) {
            updates.poster = await downloadImage(updates.poster, 'uploads/posters');
        }
        if (updates.backdrop && updates.backdrop.startsWith('http')) {
            updates.backdrop = await downloadImage(updates.backdrop, 'uploads/posters/backdrops');
        }

     
        if (updates.order !== undefined) {
            updates.order_num = parseInt(updates.order);
            delete updates.order;
        }

        
        ['tags', 'genres', 'countries', 'actors', 'actorRoles'].forEach(field => {
            if (updates[field] !== undefined) {
                // If it's already a string, don't re-stringify (happens if frontend already sent it as string)
                if (typeof updates[field] !== 'string') {
                    updates[field] = JSON.stringify(updates[field]);
                }
            }
        });

   
        ['promoted', 'isMovie'].forEach(field => {
            if (updates[field] !== undefined) {
                updates[field] = (updates[field] === true || updates[field] === 'true' || updates[field] == 1) ? 1 : 0;
            }
        });

       
        const allowedKeys = ['title', 'titleAr', 'titleEn', 'year', 'poster', 'backdrop', 'rating', 'order_num', 'promoted', 'description', 'videoUrl', 'subtitleUrl', 'tags', 'genres', 'countries', 'actors', 'actorRoles', 'isMovie', 'duration', 'director', 'language', 'views', 'likes', 'type', 'ageRating'];

        const validUpdates = {};
        let hasChanges = false;

        for (const key of allowedKeys) {
            if (updates[key] !== undefined) {
              
                if (['poster', 'backdrop', 'videoUrl'].includes(key) && updates[key] === '') {
                    continue; // Skip clearing these fields
                }

            
                if (updates[key] != series[key]) {
                    validUpdates[key] = updates[key];
                    hasChanges = true;
                }
            }
        }

        if (!hasChanges) return res.json({ success: true, message: 'لا توجد تغييرات للحفظ' });

        validUpdates.updatedAt = new Date().toISOString();
        const keys = Object.keys(validUpdates);
        const sql = `UPDATE series SET ${keys.map(k => `${k} = ?`).join(',')} WHERE id = ?`;

        await db.run(sql, [...Object.values(validUpdates), req.params.id]);
        res.json({ success: true, message: 'تم التحديث بنجاح' });
    } catch (error) {
        console.error('Update error:', error);
        res.status(500).json({ error: 'خطأ في التحديث: ' + error.message });
    }
});
app.delete('/api/series/:id', async (req, res) => {
    try {
        await db.run('DELETE FROM seasons WHERE seriesId = ?', [req.params.id]);
        await db.run('DELETE FROM episodes WHERE seriesId = ?', [req.params.id]);
        await db.run('DELETE FROM series WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'تم الحذف بنجاح' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في الحذف' });
    }
});
app.put('/api/content/:id/unpromote', authenticateAdmin, async (req, res) => {
    try {
        await db.run('UPDATE series SET promoted = 0 WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'تم إلغاء التمييز' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.get('/api/series/:seriesId/seasons', async (req, res) => {
    try {
        const userId = req.query.userId || (req.body ? req.body.userId : null);
        if (!(await isContentAllowedForUser(req.params.seriesId, userId))) {
            return res.status(403).json({ error: 'محظور' });
        }
        const seasons = await db.all('SELECT * FROM seasons WHERE seriesId = ? ORDER BY seasonNumber ASC', [req.params.seriesId]);
        res.json(seasons);
    } catch (error) {
        res.status(500).json({ error: 'خطأ في القراءة' });
    }
});
app.get('/api/seasons/:id', async (req, res) => {
    try {
        const season = await db.get('SELECT * FROM seasons WHERE id = ?', [req.params.id]);
        if (!season) return res.status(404).json({ error: 'غير موجود' });

        const userId = req.query.userId || (req.body ? req.body.userId : null);
        if (!(await isContentAllowedForUser(season.seriesId, userId))) {
            return res.status(403).json({ error: 'محظور' });
        }

        const episodes = await db.all('SELECT * FROM episodes WHERE seasonId = ? ORDER BY episodeNumber ASC', [req.params.id]);
        res.json({ ...season, episodes, episodeCount: episodes.length });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.post('/api/seasons', authenticateAdmin, async (req, res) => {
    try {
        const { seriesId, seasonNumber, title, poster, backdrop, description, year } = req.body;
        const series = await db.get('SELECT * FROM series WHERE id = ?', [seriesId]);
        if (!series) return res.status(404).json({ error: 'المسلسل غير موجود' });
        const id = 'season_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const newSeason = {
            id, seriesId, seriesTitle: series.title,
            seasonNumber: parseInt(seasonNumber) || 1,
            title: title || `الموسم ${seasonNumber}`,
            poster: await downloadImage(poster || series.poster, 'uploads/posters'),
            backdrop: await downloadImage(backdrop || series.backdrop || '', 'uploads/posters/backdrops'),
            description: description || '',
            year: parseInt(year) || series.year,
            episodeCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        const keys = Object.keys(newSeason);
        await db.run(`INSERT INTO seasons (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(newSeason));
        res.json({ success: true, message: 'تم الإضافة', season: newSeason });
    } catch (error) {
        res.status(500).json({ error: 'خطأ: ' + error.message });
    }
});
app.put('/api/seasons/:id', authenticateAdmin, async (req, res) => {
    try {
        const season = await db.get('SELECT * FROM seasons WHERE id = ?', [req.params.id]);
        if (!season) return res.status(404).json({ error: 'غير موجود' });
        const updates = { ...req.body, updatedAt: new Date().toISOString() };
        const keys = Object.keys(updates);
        await db.run(`UPDATE seasons SET ${keys.map(k => `${k} = ?`).join(',')} WHERE id = ?`, [...Object.values(updates), req.params.id]);
        res.json({ success: true, message: 'تم التحديث' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.delete('/api/seasons/:id', authenticateAdmin, async (req, res) => {
    try {
        await db.run('DELETE FROM episodes WHERE seasonId = ?', [req.params.id]);
        await db.run('DELETE FROM seasons WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'تم الحذف' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.get('/api/seasons', async (req, res) => {
    try {
        const seasons = await db.all('SELECT * FROM seasons ORDER BY seasonNumber ASC');
        res.json(seasons);
    } catch (error) {
        res.status(500).json({ error: 'خطأ في قراءة المواسم' });
    }
});

app.get('/api/episodes', async (req, res) => {
    try {
        let sql = 'SELECT * FROM episodes';
        let params = [];
        let conditions = [];
        if (req.query.seriesId) {
            conditions.push('seriesId = ?');
            params.push(req.query.seriesId);
        }
        if (req.query.seasonId) {
            conditions.push('seasonId = ?');
            params.push(req.query.seasonId);
        }
        if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');

        const sort = req.query.sort === 'desc' ? 'DESC' : 'ASC';
        sql += ` ORDER BY episodeNumber ${sort}`;
        const episodes = await db.all(sql, params);
        const series = await db.all('SELECT id, title, poster, ageRating, genres FROM series');
        const seasons = await db.all('SELECT id, title, poster FROM seasons');

        const userId = req.query.userId || (req.body ? req.body.userId : null);
        const filteredEpisodes = [];

        for (const ep of episodes) {
            const s = series.find(ser => ser.id === ep.seriesId);
            if (userId && s) {
          
                const allowed = await filterContentForUser([s], userId);
                if (allowed.length === 0) continue;
            }

            const sea = seasons.find(season => season.id === ep.seasonId);
            filteredEpisodes.push({
                ...ep,
                isFree: !!ep.isFree,
                seriesTitle: s ? s.title : 'غير معروف',
                seasonTitle: sea ? sea.title : 'غير معروف',
                seasonPoster: sea ? sea.poster : '',
                seriesPoster: s ? s.poster : '',
                poster: ep.poster || (sea && sea.poster ? sea.poster : (s ? s.poster : ''))
            });
        }
        res.json(filteredEpisodes);

    } catch (error) {
        console.error('Error in /api/episodes:', error);
        res.status(500).json({ error: 'خطأ: ' + error.message });
    }
});
app.get('/api/episodes/:id', async (req, res) => {
    try {
        const userId = req.query.userId || (req.body ? req.body.userId : null);
        const isAllowed = await isContentAllowedForUser(req.params.id, userId);
        if (!isAllowed) {
            return res.status(403).json({ error: 'هذا المحتوى محظور عليك أو غير متاح لفئتك العمرية.' });
        }

        const episode = await db.get('SELECT * FROM episodes WHERE id = ?', [req.params.id]);

        if (!episode) return res.status(404).json({ error: 'غير موجود' });
        const series = await db.get('SELECT title FROM series WHERE id = ?', [episode.seriesId]);
        const season = await db.get('SELECT title FROM seasons WHERE id = ?', [episode.seasonId]);
        res.json({
            ...episode,
            isFree: !!episode.isFree,
            seriesTitle: series ? series.title : 'غير معروف',
            seasonTitle: season ? season.title : 'غير معروف'
        });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.post('/api/episodes', authenticateAdmin, async (req, res) => {
    try {
        const { seriesId, seasonId, episodeNumber, title, description, videoUrl, duration, thumbnail, isFree } = req.body;
        const series = await db.get('SELECT * FROM series WHERE id = ?', [seriesId]);
        if (!series) return res.status(404).json({ error: 'المسلسل غير موجود' });
        const id = 'episode_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const newEpisode = {
            id, seriesId, seasonId: seasonId || null,
            episodeNumber: parseInt(episodeNumber) || 1,
            title: title || `الحلقة ${episodeNumber}`,
            description: description || '',
            videoUrl, duration: duration || '00:00',
            thumbnail: await downloadImage(thumbnail || series.poster, 'uploads/episodes'),
            isFree: (isFree === true || isFree === 'true') ? 1 : 0,
            views: 0, likes: 0,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
        const keys = Object.keys(newEpisode);
        await db.run(`INSERT INTO episodes (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(newEpisode));
        if (seasonId) {
            const count = await db.get('SELECT COUNT(*) as count FROM episodes WHERE seasonId = ?', [seasonId]);
            await db.run('UPDATE seasons SET episodeCount = ? WHERE id = ?', [count.count, seasonId]);
        }
        res.json({ success: true, message: 'تم الإضافة', episode: newEpisode });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.put('/api/episodes/:id', authenticateAdmin, async (req, res) => {
    try {
        const episode = await db.get('SELECT * FROM episodes WHERE id = ?', [req.params.id]);
        if (!episode) return res.status(404).json({ error: 'غير موجود' });
        const updates = { ...req.body, updatedAt: new Date().toISOString() };
        if (updates.isFree !== undefined) updates.isFree = (updates.isFree === true || updates.isFree === 'true') ? 1 : 0;
        const keys = Object.keys(updates);
        await db.run(`UPDATE episodes SET ${keys.map(k => `${k} = ?`).join(',')} WHERE id = ?`, [...Object.values(updates), req.params.id]);
        res.json({ success: true, message: 'تم التحديث' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.delete('/api/episodes/:id', authenticateAdmin, async (req, res) => {
    try {
        await db.run('DELETE FROM episodes WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'تم الحذف' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.get('/api/actors', async (req, res) => {
    try {
        const actors = await db.all('SELECT * FROM actors');
        res.json(actors.map(a => ({
            ...a,
            movies: JSON.parse(a.movies || '[]'),
            series: JSON.parse(a.series || '[]')
        })));
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.get('/api/actors/search', async (req, res) => {
    try {
        const query = req.query.q?.toLowerCase() || '';
        const results = await db.all('SELECT * FROM actors WHERE name LIKE ? OR nameAr LIKE ? OR nameEn LIKE ? OR nationality LIKE ?',
            [`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`]);
        res.json(results.map(a => ({
            ...a,
            movies: JSON.parse(a.movies || '[]'),
            series: JSON.parse(a.series || '[]')
        })));
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.get('/api/actors/:id', async (req, res) => {
    try {
        const actor = await db.get('SELECT * FROM actors WHERE id = ?', [req.params.id]);
        if (!actor) return res.status(404).json({ error: 'غير موجود' });
        const series = await db.all('SELECT id, title, year, poster, rating, tags, isMovie, actors, actorRoles FROM series');
        const isLinked = (actorList, id) => {
            try {
                const list = typeof actorList === 'string' ? JSON.parse(actorList || '[]') : actorList;
                return list.some(a => a === id || a.actorId === id);
            } catch (e) { return false; }
        };

        const rawMovies = series.filter(s => s.isMovie && isLinked(s.actors, req.params.id)).map(s => ({ ...s, isMovie: 1 }));
        const rawSeries = series.filter(s => !s.isMovie && isLinked(s.actors, req.params.id)).map(s => ({ ...s, isMovie: 0 }));

        const linkedMovies = await filterContentForUser(rawMovies, req.query.userId, req.query.profileId);
        const linkedSeries = await filterContentForUser(rawSeries, req.query.userId, req.query.profileId);

        const actorRoles = [];
        series.forEach(content => {
            const roles = JSON.parse(content.actorRoles || '[]');
            roles.forEach(role => {
                if (role.actorId === req.params.id) {
                    actorRoles.push({
                        contentId: content.id,
                        contentTitle: content.title,
                        contentType: content.isMovie ? 'movie' : 'series',
                        characterName: role.characterName,
                        role: role.role,
                        order: role.order
                    });
                }
            });
        });
        res.json({
            ...actor,
            movies: linkedMovies.map(m => ({ ...m, isMovie: true })),
            series: linkedSeries.map(s => ({ ...s, isMovie: false })),
            roles: actorRoles
        });
    } catch (error) {
        res.status(500).json({ error: 'خطأ: ' + error.message });
    }
});
app.post('/api/actors', authenticateAdmin, async (req, res) => {
    try {
        const { name, image, bio, nationality, birthDate } = req.body;
        const id = 'actor_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const newActor = {
            id, name: name.trim(),
            image: image || '/assets/default-actors.png',
            bio: bio || '',
            nationality: nationality || '',
            birthDate: birthDate || '',
            movies: JSON.stringify([]),
            series: JSON.stringify([]),
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
        const keys = Object.keys(newActor);
        await db.run(`INSERT INTO actors (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(newActor));
        res.json({ success: true, message: 'تم الإضافة', actor: newActor });
    } catch (error) {
        res.status(500).json({ error: 'خطأ: ' + error.message });
    }
});
app.put('/api/actors/:id', authenticateAdmin, async (req, res) => {
    try {
        const updates = { ...req.body, updatedAt: new Date().toISOString() };
        if (updates.movies) updates.movies = JSON.stringify(updates.movies);
        if (updates.series) updates.series = JSON.stringify(updates.series);
        const keys = Object.keys(updates);
        await db.run(`UPDATE actors SET ${keys.map(k => `${k} = ?`).join(',')} WHERE id = ?`, [...Object.values(updates), req.params.id]);
        res.json({ success: true, message: 'تم التحديث' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.delete('/api/actors/:id', authenticateAdmin, async (req, res) => {
    try {
        const series = await db.all('SELECT id, actors, actorRoles FROM series');
        for (const content of series) {
            let actors = JSON.parse(content.actors || '[]');
            let roles = JSON.parse(content.actorRoles || '[]');
            if (actors.includes(req.params.id) || roles.some(r => r.actorId === req.params.id)) {
                actors = actors.filter(id => id !== req.params.id);
                roles = roles.filter(r => r.actorId !== req.params.id);
                await db.run('UPDATE series SET actors = ?, actorRoles = ? WHERE id = ?', [JSON.stringify(actors), JSON.stringify(roles), content.id]);
            }
        }
        await db.run('DELETE FROM actors WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'تم الحذف بنجاح' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});

app.post('/api/actors/:id/works', authenticateAdmin, async (req, res) => {
    try {
        const { workId } = req.body;
        const actorId = req.params.id;

        const actor = await db.get('SELECT * FROM actors WHERE id = ?', [actorId]);
        const work = await db.get('SELECT * FROM series WHERE id = ?', [workId]);

        if (!actor || !work) return res.status(404).json({ error: 'الممثل أو العمل غير موجود' });

        let moviesList = [];
        let seriesList = [];
        try { moviesList = typeof actor.movies === 'string' ? JSON.parse(actor.movies || '[]') : (actor.movies || []); } catch (e) { }
        try { seriesList = typeof actor.series === 'string' ? JSON.parse(actor.series || '[]') : (actor.series || []); } catch (e) { }

        const entry = { id: work.id, title: work.title, role: 'ممثل' };

        if (work.isMovie) {
            if (!moviesList.find(m => m.id === work.id)) {
                moviesList.push(entry);
                await db.run('UPDATE actors SET movies = ?, updatedAt = ? WHERE id = ?',
                    [JSON.stringify(moviesList), new Date().toISOString(), actorId]);
            }
        } else {
            if (!seriesList.find(s => s.id === work.id)) {
                seriesList.push(entry);
                await db.run('UPDATE actors SET series = ?, updatedAt = ? WHERE id = ?',
                    [JSON.stringify(seriesList), new Date().toISOString(), actorId]);
            }
        }

        let workActors = JSON.parse(work.actors || '[]');
        let workActorRoles = JSON.parse(work.actorRoles || '[]');

        if (!workActors.includes(actorId)) {
            workActors.push(actorId);
            workActorRoles.push({ actorId, actorName: actor.name, characterName: actor.name, role: 'ممثل', order: 99 });
            await db.run('UPDATE series SET actors = ?, actorRoles = ? WHERE id = ?',
                [JSON.stringify(workActors), JSON.stringify(workActorRoles), workId]);
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/actors/:actorId/works/:workId', authenticateAdmin, async (req, res) => {
    try {
        const { actorId, workId } = req.params;

        const actor = await db.get('SELECT * FROM actors WHERE id = ?', [actorId]);
        if (!actor) return res.status(404).json({ error: 'الممثل غير موجود' });

        let moviesList = typeof actor.movies === 'string' ? JSON.parse(actor.movies || '[]') : (actor.movies || []);
        let seriesList = typeof actor.series === 'string' ? JSON.parse(actor.series || '[]') : (actor.series || []);

        moviesList = moviesList.filter(m => m.id !== workId);
        seriesList = seriesList.filter(s => s.id !== workId);

        await db.run('UPDATE actors SET movies = ?, series = ?, updatedAt = ? WHERE id = ?',
            [JSON.stringify(moviesList), JSON.stringify(seriesList), new Date().toISOString(), actorId]);

        const work = await db.get('SELECT id, actors, actorRoles FROM series WHERE id = ?', [workId]);
        if (work) {
            let workActors = JSON.parse(work.actors || '[]');
            let workActorRoles = JSON.parse(work.actorRoles || '[]');

            workActors = workActors.filter(id => id !== actorId);
            workActorRoles = workActorRoles.filter(r => r.actorId !== actorId);

            await db.run('UPDATE series SET actors = ?, actorRoles = ? WHERE id = ?',
                [JSON.stringify(workActors), JSON.stringify(workActorRoles), workId]);
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ربط الممثلين بالمحتوى
app.post('/api/content/:contentId/actors', authenticateAdmin, async (req, res) => {
    try {
        const { actorId, role, characterName, order } = req.body;
        const content = await db.get('SELECT * FROM series WHERE id = ?', [req.params.contentId]);
        if (!content) return res.status(404).json({ error: 'المحتوى غير موجود' });
        const actor = await db.get('SELECT * FROM actors WHERE id = ?', [actorId]);
        if (!actor) return res.status(404).json({ error: 'الممثل غير موجود' });
        const actorRole = {
            actorId, actorName: actor.name,
            characterName: characterName || actor.name,
            role: role || 'ممثل',
            order: parseInt(order) || 0
        };
        let actorRoles = JSON.parse(content.actorRoles || '[]');
        let actors = JSON.parse(content.actors || '[]');
        const existingIndex = actorRoles.findIndex(ar => ar.actorId === actorId);
        if (existingIndex !== -1) {
            actorRoles[existingIndex] = actorRole;
        } else {
            actorRoles.push(actorRole);
        }
        if (!actors.includes(actorId)) actors.push(actorId);
        await db.run('UPDATE series SET actors = ?, actorRoles = ? WHERE id = ?', [JSON.stringify(actors), JSON.stringify(actorRoles), req.params.contentId]);
        res.json({ success: true, message: 'تم الربط', actorRole });
    } catch (error) {
        res.status(500).json({ error: 'خطأ: ' + error.message });
    }
});
app.delete('/api/content/:contentId/actors/:actorId', authenticateAdmin, async (req, res) => {
    try {
        const content = await db.get('SELECT * FROM series WHERE id = ?', [req.params.contentId]);
        if (!content) return res.status(404).json({ error: 'المحتوى غير موجود' });
        let actors = JSON.parse(content.actors || '[]');
        let actorRoles = JSON.parse(content.actorRoles || '[]');
        actors = actors.filter(id => id !== req.params.actorId);
        actorRoles = actorRoles.filter(r => r.actorId !== req.params.actorId);
        await db.run('UPDATE series SET actors = ?, actorRoles = ? WHERE id = ?', [JSON.stringify(actors), JSON.stringify(actorRoles), req.params.contentId]);
        res.json({ success: true, message: 'تم فك الربط' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.put('/api/content/:contentId/actors/:actorId/order', authenticateAdmin, async (req, res) => {
    try {
        const content = await db.get('SELECT * FROM series WHERE id = ?', [req.params.contentId]);
        if (!content) return res.status(404).json({ error: 'المحتوى غير موجود' });
        let actorRoles = JSON.parse(content.actorRoles || '[]');
        const roleIndex = actorRoles.findIndex(r => r.actorId === req.params.actorId);
        if (roleIndex === -1) return res.status(404).json({ error: 'الدور غير موجود' });
        actorRoles[roleIndex].order = parseInt(req.body.order) || 0;
        await db.run('UPDATE series SET actorRoles = ? WHERE id = ?', [JSON.stringify(actorRoles), req.params.contentId]);
        res.json({ success: true, message: 'تم تحديث الترتيب' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.get('/api/content/:contentId/actors', async (req, res) => {
    try {
        const content = await db.get('SELECT * FROM series WHERE id = ?', [req.params.contentId]);
        if (!content) return res.status(404).json({ error: 'غير موجود' });
        const actorRoles = JSON.parse(content.actorRoles || '[]');
        actorRoles.sort((a, b) => a.order - b.order);
        const actors = await db.all('SELECT id, image, bio, nationality FROM actors');
        const enhancedRoles = actorRoles.map(role => {
            const actor = actors.find(a => a.id === role.actorId);
            return {
                ...role,
                actorImage: actor ? actor.image : '',
                actorBio: actor ? actor.bio : '',
                actorNationality: actor ? actor.nationality : ''
            };
        });
        res.json(enhancedRoles);
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
// ==================== 5. إدارة الأجزاء (Parts) ====================
app.get('/api/parts', async (req, res) => {
    try {
        const parts = await db.all('SELECT * FROM parts');
        const series = await db.all('SELECT id, title, isMovie, poster FROM series');
        const enhancedParts = parts.map(part => {
            const parent = series.find(s => s.id === part.parentId);
            return {
                ...part,
                parentTitle: parent ? parent.title : 'غير معروف',
                parentType: parent ? (parent.isMovie ? 'movie' : 'series') : 'unknown',
                parentPoster: parent ? parent.poster : ''
            };
        });
        res.json(enhancedParts);
    } catch (error) {
        res.status(500).json({ error: 'خطأ: ' + error.message });
    }
});
// مسار لجلب أجزاء محتوى معين (تم تغيير المسار لتجنب التعارض)
app.get('/api/content/:parentId/parts', async (req, res) => {
    try {
        const parts = await db.all('SELECT * FROM parts WHERE parentId = ? ORDER BY partNumber ASC', [req.params.parentId]);
        res.json(parts);
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
// مسار لجلب تفاصيل جزء واحد
app.get('/api/parts/:id', async (req, res) => {
    try {
        const part = await db.get('SELECT * FROM parts WHERE id = ?', [req.params.id]);
        if (!part) return res.status(404).json({ error: 'غير موجود' });
        const parent = await db.get('SELECT title, poster, isMovie FROM series WHERE id = ?', [part.parentId]);
        res.json({
            ...part,
            parentTitle: parent ? parent.title : 'غير معروف',
            parentPoster: parent ? parent.poster : '',
            parentType: parent ? (parent.isMovie ? 'movie' : 'series') : 'unknown'
        });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.post('/api/parts', authenticateAdmin, async (req, res) => {
    try {
        const { parentId, partNumber, title, year, poster, description, duration, videoUrl } = req.body;
        const parent = await db.get('SELECT title, year, poster, isMovie FROM series WHERE id = ?', [parentId]);
        if (!parent) return res.status(404).json({ error: 'المحتوى الأصلي غير موجود' });
        const id = 'part_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const newPart = {
            id, parentId, parentTitle: parent.title,
            parentType: parent.isMovie ? 'movie' : 'series',
            partNumber: parseInt(partNumber) || 1,
            title: title || `الجزء ${partNumber}`,
            year: parseInt(year) || parent.year,
            poster: poster || parent.poster,
            description: description || '',
            duration: duration || '',
            videoUrl: videoUrl || '',
            views: 0, likes: 0,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
        const keys = Object.keys(newPart);
        await db.run(`INSERT INTO parts (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(newPart));
        res.json({ success: true, message: 'تم الإضافة', part: newPart });
    } catch (error) {
        res.status(500).json({ error: 'خطأ: ' + error.message });
    }
});
app.put('/api/parts/:id', authenticateAdmin, async (req, res) => {
    try {
        const updates = { ...req.body, updatedAt: new Date().toISOString() };
        const keys = Object.keys(updates);
        await db.run(`UPDATE parts SET ${keys.map(k => `${k} = ?`).join(',')} WHERE id = ?`, [...Object.values(updates), req.params.id]);
        res.json({ success: true, message: 'تم التحديث' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.delete('/api/parts/:id', authenticateAdmin, async (req, res) => {
    try {
        await db.run('DELETE FROM parts WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'تم الحذف' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});

// ==================== 5.1 إدارة المجموعات (Collections) ====================
app.get('/api/collections', async (req, res) => {
    try {
        const collections = await db.all('SELECT * FROM collections ORDER BY order_num ASC');
        const collectionsWithItems = [];

        for (const col of collections) {
            const items = await db.all(`
                SELECT s.id, s.title, s.poster, s.backdrop 
                FROM collection_items ci
                JOIN series s ON ci.mediaId = s.id
                WHERE ci.collectionId = ?
                ORDER BY ci.orderNum ASC
            `, [col.id]);

            // إضافة مصفوفة البوسترات للسلايدر
            const posters = items.map(i => i.poster).filter(p => p);
            const backdrops = items.map(i => i.backdrop).filter(b => b);

            collectionsWithItems.push({
                ...col,
                items,
                posters,
                backdrops,
                itemCount: items.length
            });
        }

        res.json(collectionsWithItems);
    } catch (error) {
        res.status(500).json({ error: 'خطأ في جلب المجموعات: ' + error.message });
    }
});

app.get('/api/collections/:id', async (req, res) => {
    try {
        const col = await db.get('SELECT * FROM collections WHERE id = ?', [req.params.id]);
        if (!col) return res.status(404).json({ error: 'المجموعة غير موجودة' });

        const items = await db.all(`
            SELECT s.* 
            FROM collection_items ci
            JOIN series s ON ci.mediaId = s.id
            WHERE ci.collectionId = ?
            ORDER BY ci.orderNum ASC
        `, [col.id]);

        // جلب الأجزاء المتاحة لكل عنصر إذا كان مسلسلاً
        const enhancedItems = [];
        for (const item of items) {
            if (!item.isMovie) {
                const episodes = await db.all('SELECT COUNT(*) as count FROM episodes WHERE seriesId = ?', [item.id]);
                enhancedItems.push({ ...item, episodeCount: episodes[0].count });
            } else {
                enhancedItems.push(item);
            }
        }

        res.json({ ...col, items: enhancedItems, itemCount: items.length });
    } catch (error) {
        res.status(500).json({ error: 'خطأ: ' + error.message });
    }
});

app.post('/api/collections', authenticateAdmin, async (req, res) => {
    try {
        let { name, description, poster, backdrop, order_num, mediaIds } = req.body;

        // تخمين الاسم تلقائياً إذا لم يتم توفيره
        if (!name && mediaIds && mediaIds.length > 0) {
            const selectedMedia = await db.all(`SELECT title FROM series WHERE id IN (${mediaIds.map(() => '?').join(',')})`, mediaIds);
            if (selectedMedia.length > 0) {
                const titles = selectedMedia.map(m => m.title);
                // منطق بسيط لاستخراج الجزء المشترك من العناوين
                let common = titles[0];
                for (let i = 1; i < titles.length; i++) {
                    let j = 0;
                    while (j < common.length && j < titles[i].length && common[j] === titles[i][j]) {
                        j++;
                    }
                    common = common.substring(0, j);
                }
                name = common.trim() || 'مجموعة جديدة';
                if (name.endsWith(':') || name.endsWith('-')) name = name.slice(0, -1).trim();
                name = `مجموعة ${name}`;
            }
        }

        const id = 'col_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

        // استخدام أول بوستر من العناصر المختارة إذا لم يتم توفير بوستر
        if (!poster && mediaIds && mediaIds.length > 0) {
            const firstMedia = await db.get('SELECT poster FROM series WHERE id = ?', [mediaIds[0]]);
            poster = firstMedia ? firstMedia.poster : '';
        }
        if (!backdrop && mediaIds && mediaIds.length > 0) {
            const firstMedia = await db.get('SELECT backdrop FROM series WHERE id = ?', [mediaIds[0]]);
            backdrop = firstMedia ? firstMedia.backdrop : '';
        }

        const newCol = {
            id,
            name: name || 'مجموعة غير مسمى',
            description: description || '',
            poster: poster || '',
            backdrop: backdrop || '',
            type: 'collection',
            order_num: parseInt(order_num) || 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const keys = Object.keys(newCol);
        await db.run(`INSERT INTO collections (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(newCol));

        // إضافة العناصر للمجموعة إذا تم توفيرها
        if (mediaIds && Array.isArray(mediaIds)) {
            for (let i = 0; i < mediaIds.length; i++) {
                const itemId = 'col_item_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substr(2, 5);
                await db.run(`INSERT INTO collection_items (id, collectionId, mediaId, orderNum, createdAt) VALUES (?, ?, ?, ?, ?)`,
                    [itemId, id, mediaIds[i], i, new Date().toISOString()]);
            }
        }

        res.json({ success: true, message: 'تم إنشاء المجموعة بنجاح', collection: newCol });
    } catch (error) {
        res.status(500).json({ error: 'خطأ: ' + error.message });
    }
});


app.put('/api/collections/:id', authenticateAdmin, async (req, res) => {
    try {
        const { mediaIds, ...rest } = req.body;
        const updates = { ...rest, updatedAt: new Date().toISOString() };
        const keys = Object.keys(updates);

        if (keys.length > 0) {
            await db.run(`UPDATE collections SET ${keys.map(k => `${k} = ?`).join(',')} WHERE id = ?`, [...Object.values(updates), req.params.id]);
        }

        res.json({ success: true, message: 'تم التحديث بنجاح' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ: ' + error.message });
    }
});

app.delete('/api/collections/:id', authenticateAdmin, async (req, res) => {
    try {
        await db.run('DELETE FROM collection_items WHERE collectionId = ?', [req.params.id]);
        await db.run('DELETE FROM collections WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'تم حذف المجموعة بنجاح' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ: ' + error.message });
    }
});

app.post('/api/collections/:id/sync-items', authenticateAdmin, async (req, res) => {
    try {
        const { mediaIds } = req.body;
        const collectionId = req.params.id;

        // حذف العناصر القديمة
        await db.run('DELETE FROM collection_items WHERE collectionId = ?', [collectionId]);

        // إضافة العناصر الجديدة
        if (mediaIds && Array.isArray(mediaIds)) {
            for (let i = 0; i < mediaIds.length; i++) {
                const itemId = 'col_item_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substr(2, 5);
                await db.run(`INSERT INTO collection_items (id, collectionId, mediaId, orderNum, createdAt) VALUES (?, ?, ?, ?, ?)`,
                    [itemId, collectionId, mediaIds[i], i, new Date().toISOString()]);
            }
        }

        res.json({ success: true, message: 'تم تحديث عناصر المجموعة' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ: ' + error.message });
    }
});

app.post('/api/collections/:id/items', authenticateAdmin, async (req, res) => {
    try {
        const { mediaId, orderNum } = req.body;
        const collectionId = req.params.id;
        const id = 'col_item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

        await db.run(`INSERT INTO collection_items (id, collectionId, mediaId, orderNum, createdAt) VALUES (?, ?, ?, ?, ?)`,
            [id, collectionId, mediaId, parseInt(orderNum) || 0, new Date().toISOString()]);

        res.json({ success: true, message: 'تمت إضافة المحتوى للمجموعة' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ: ' + error.message });
    }
});

app.delete('/api/collections/items/:mediaId', authenticateAdmin, async (req, res) => {
    try {
        const { collectionId } = req.query;
        await db.run('DELETE FROM collection_items WHERE collectionId = ? AND mediaId = ?', [collectionId, req.params.mediaId]);
        res.json({ success: true, message: 'تم حذف المحتوى من المجموعة' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ: ' + error.message });
    }
});
// ==================== 6. إدارة التصنيفات (Genres) ====================
app.get('/api/genres', async (req, res) => {
    try {
        const genres = await db.all('SELECT * FROM genres');
        const series = await db.all('SELECT genres FROM series');
        const enhancedGenres = genres.map(genre => {
            const count = series.filter(s => {
                try {
                    const sGenres = JSON.parse(s.genres || '[]');
                    // Check by ID or name to be backward compatible and robust
                    return sGenres.includes(genre.id) || sGenres.includes(genre.name);
                } catch (e) { return false; }
            }).length;
            return { ...genre, count };
        });
        res.json(enhancedGenres);
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.get('/api/genres/:id', async (req, res) => {
    try {
        console.log('Request for genre content:', req.params.id);
        const genre = await db.get('SELECT * FROM genres WHERE id = ?', [req.params.id]);
        if (!genre) {
            console.warn('Genre not found:', req.params.id);
            return res.status(404).json({ error: 'غير موجود' });
        }

        // Search in series table using LIKE for better performance and reliability
        const series = await db.all('SELECT id, title, year, poster, isMovie, genres FROM series WHERE genres LIKE ? OR genres LIKE ?',
            [`%"${genre.id}"%`, `%"${genre.name}"%`]);

        console.log(`Found ${series.length} items for genre ${genre.name}`);

        const resolvedContent = await resolveGenreNames(series.map(s => ({
            ...s,
            isMovie: !!s.isMovie,
            genres: JSON.parse(s.genres || '[]')
        })));
        const relatedContent = await filterContentForUser(resolvedContent, req.query.userId, req.query.profileId);

        res.json({
            ...genre,
            contentCount: relatedContent.length,
            content: relatedContent.map(c => ({
                id: c.id, title: c.title, year: c.year, poster: c.poster, type: c.isMovie ? 'movie' : 'series'
            }))
        });
    } catch (error) {
        console.error('Error in genre detail:', error);
        res.status(500).json({ error: 'خطأ' });
    }
});
app.post('/api/genres', authenticateAdmin, async (req, res) => {
    try {
        const { name, color, icon } = req.body;
        const trimmedName = name.trim();

        // Check if exists
        const existing = await db.get('SELECT id FROM genres WHERE name = ?', [trimmedName]);
        if (existing) return res.status(400).json({ error: 'هذا التصنيف موجود مسبقاً' });

        const id = 'genre_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const newGenre = { id, name: trimmedName, color: color || '#1bd68e', icon: icon || 'fa-tag' };
        const keys = Object.keys(newGenre);
        await db.run(`INSERT INTO genres (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(newGenre));
        res.json({ success: true, message: 'تم الإضافة', genre: newGenre });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.put('/api/genres/:id', authenticateAdmin, async (req, res) => {
    try {
        const oldGenre = await db.get('SELECT * FROM genres WHERE id = ?', [req.params.id]);
        if (!oldGenre) return res.status(404).json({ error: 'غير موجود' });
        const updates = req.body;
        const keys = Object.keys(updates);
        await db.run(`UPDATE genres SET ${keys.map(k => `${k} = ?`).join(',')} WHERE id = ?`, [...Object.values(updates), req.params.id]);

        res.json({ success: true, message: 'تم التحديث' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.delete('/api/genres/:id', authenticateAdmin, async (req, res) => {
    try {
        await db.run('DELETE FROM genres WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'تم الحذف' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
// ==================== 7. إدارة الدول (Countries) ====================
app.get('/api/countries', async (req, res) => {
    try {
        const countries = await db.all('SELECT * FROM countries');
        res.json(countries);
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.post('/api/countries', authenticateAdmin, async (req, res) => {
    try {
        const { name, code, flag, continent } = req.body;
        const id = 'country_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const newCountry = { id, name: name.trim(), code: code.trim().toUpperCase(), flag: flag || '', continent: continent || '', createdAt: new Date().toISOString() };
        const keys = Object.keys(newCountry);
        await db.run(`INSERT INTO countries (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(newCountry));
        res.json({ success: true, message: 'تم الإضافة', country: newCountry });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.put('/api/countries/:id', authenticateAdmin, async (req, res) => {
    try {
        const oldCountry = await db.get('SELECT * FROM countries WHERE id = ?', [req.params.id]);
        if (!oldCountry) return res.status(404).json({ error: 'غير موجود' });
        const updates = { ...req.body, updatedAt: new Date().toISOString() };
        const keys = Object.keys(updates);
        await db.run(`UPDATE countries SET ${keys.map(k => `${k} = ?`).join(',')} WHERE id = ?`, [...Object.values(updates), req.params.id]);
        // Update nationality in actors if changed
        if (updates.name && updates.name !== oldCountry.name) {
            await db.run('UPDATE actors SET nationality = ? WHERE nationality = ?', [updates.name, oldCountry.name]);
        }
        res.json({ success: true, message: 'تم التحديث' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.delete('/api/countries/:id', authenticateAdmin, async (req, res) => {
    try {
        await db.run('DELETE FROM countries WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'تم الحذف' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});

app.get('/api/tags', async (req, res) => {
    try {
        const tags = await db.all('SELECT * FROM tags');
        res.json(tags);
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.get('/api/tags/:id', async (req, res) => {
    try {
        const tag = await db.get('SELECT * FROM tags WHERE id = ?', [req.params.id]);
        if (!tag) return res.status(404).json({ error: 'غير موجود' });
        const series = await db.all('SELECT id, title, year, poster, isMovie, tags FROM series');
        const relatedContent = series.filter(s => JSON.parse(s.tags || '[]').includes(tag.name));
        res.json({
            ...tag,
            contentCount: relatedContent.length,
            content: relatedContent.slice(0, 10).map(c => ({
                id: c.id, title: c.title, year: c.year, poster: c.poster, type: c.isMovie ? 'movie' : 'series'
            }))
        });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.post('/api/tags', authenticateAdmin, async (req, res) => {
    try {
        const { name, color, type } = req.body;
        const id = 'tag_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const newTag = { id, name: name.trim(), color: color || '#1bd68e', type: type || 'general', count: 0 };
        const keys = Object.keys(newTag);
        await db.run(`INSERT INTO tags (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(newTag));
        res.json({ success: true, message: 'تم الإضافة', tag: newTag });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.put('/api/tags/:id', authenticateAdmin, async (req, res) => {
    try {
        const oldTag = await db.get('SELECT * FROM tags WHERE id = ?', [req.params.id]);
        if (!oldTag) return res.status(404).json({ error: 'غير موجود' });
        const updates = req.body;
        const keys = Object.keys(updates);
        await db.run(`UPDATE tags SET ${keys.map(k => `${k} = ?`).join(',')} WHERE id = ?`, [...Object.values(updates), req.params.id]);
        if (updates.name && updates.name !== oldTag.name) {
            const series = await db.all('SELECT id, tags FROM series');
            for (const s of series) {
                let tags = JSON.parse(s.tags || '[]');
                if (tags.includes(oldTag.name)) {
                    tags = tags.map(t => t === oldTag.name ? updates.name : t);
                    await db.run('UPDATE series SET tags = ? WHERE id = ?', [JSON.stringify(tags), s.id]);
                }
            }
        }
        res.json({ success: true, message: 'تم التحديث' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.delete('/api/tags/:id', authenticateAdmin, async (req, res) => {
    try {
        await db.run('DELETE FROM tags WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'تم الحذف' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.post('/api/content/:contentId/tags', authenticateAdmin, async (req, res) => {
    try {
        const { tagIds } = req.body;
        const content = await db.get('SELECT * FROM series WHERE id = ?', [req.params.contentId]);
        if (!content) return res.status(404).json({ error: 'المحتوى غير موجود' });
        const allTags = await db.all('SELECT * FROM tags');
        const validTags = allTags.filter(tag => tagIds.includes(tag.id));
        const tagNames = validTags.map(tag => tag.name);
        await db.run('UPDATE series SET tags = ? WHERE id = ?', [JSON.stringify(tagNames), req.params.contentId]);
        for (const tag of validTags) {
            await db.run('UPDATE tags SET count = (SELECT COUNT(*) FROM series WHERE tags LIKE ?) WHERE id = ?', [`%${tag.name}%`, tag.id]);
        }
        res.json({ success: true, message: 'تم ربط الوسوم', tags: validTags });
    } catch (error) {
        res.status(500).json({ error: 'خطأ: ' + error.message });
    }
});
// ==================== 9. مسارات عامة (بحث، إحصائيات، الصفحة الرئيسية) ====================
app.get('/api/promoted', async (req, res) => {
    try {
        const promoted = await db.all('SELECT * FROM series WHERE promoted = 1 ORDER BY order_num ASC');
        res.json(promoted.map(s => ({
            ...s,
            tags: JSON.parse(s.tags || '[]'),
            genres: JSON.parse(s.genres || '[]'),
            countries: JSON.parse(s.countries || '[]'),
            actors: JSON.parse(s.actors || '[]'),
            actorRoles: JSON.parse(s.actorRoles || '[]'),
            promoted: true,
            isMovie: !!s.isMovie
        })));
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.get('/api/stats', authenticateAdmin, async (req, res) => {
    try {
        const seriesCount = await db.get('SELECT COUNT(*) as count FROM series WHERE isMovie = 0');
        const moviesCount = await db.get('SELECT COUNT(*) as count FROM series WHERE isMovie = 1');
        const seasonsCount = await db.get('SELECT COUNT(*) as count FROM seasons');
        const episodesCount = await db.get('SELECT COUNT(*) as count FROM episodes');
        const actorsCount = await db.get('SELECT COUNT(*) as count FROM actors');
        const genresCount = await db.get('SELECT COUNT(*) as count FROM genres');
        const countriesCount = await db.get('SELECT COUNT(*) as count FROM countries');
        const promotedCount = await db.get('SELECT COUNT(*) as count FROM series WHERE promoted = 1');
        const viewsSeries = await db.get('SELECT SUM(views) as total FROM series');
        const viewsEpisodes = await db.get('SELECT SUM(views) as total FROM episodes');
        const stats = {
            totalSeries: seriesCount.count,
            totalMovies: moviesCount.count,
            totalSeasons: seasonsCount.count,
            totalEpisodes: episodesCount.count,
            totalActors: actorsCount.count,
            totalGenres: genresCount.count,
            totalCountries: countriesCount.count,
            totalPromoted: promotedCount.count,
            totalViews: (viewsSeries.total || 0) + (viewsEpisodes.total || 0),
            lastUpdated: new Date().toISOString()
        };
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q?.toLowerCase() || '';
        const type = req.query.type || 'all';
        let results = [];
        if (type === 'all' || type === 'series' || type === 'movie') {
            const series = await db.all('SELECT * FROM series WHERE title LIKE ? OR titleAr LIKE ? OR titleEn LIKE ? OR description LIKE ?', [`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`]);
            const resolvedSeries = await resolveGenreNames(series.map(s => ({
                ...s,
                type: s.isMovie ? 'movie' : 'series',
                tags: JSON.parse(s.tags || '[]'),
                genres: JSON.parse(s.genres || '[]'),
                countries: JSON.parse(s.countries || '[]'),
                actors: JSON.parse(s.actors || '[]'),
                actorRoles: JSON.parse(s.actorRoles || '[]'),
                isMovie: !!s.isMovie
            })));
            const allowedSeries = await filterContentForUser(resolvedSeries, req.query.userId, req.query.profileId);

            // Fetch seasons for series
            const seriesWithSeasons = await Promise.all(allowedSeries.map(async s => {
                if (!s.isMovie) {
                    const seasons = await db.all('SELECT * FROM seasons WHERE seriesId = ? ORDER BY seasonNumber', [s.id]);
                    return { ...s, seasons };
                }
                return s;
            }));

            results = [...results, ...seriesWithSeasons];
        }
        if (type === 'all' || type === 'actors') {
            const actors = await db.all('SELECT * FROM actors WHERE name LIKE ?', [`%${query}%`]);
            const filteredActors = [];
            for (const a of actors) {
                const moviesList = JSON.parse(a.movies || '[]');
                const seriesList = JSON.parse(a.series || '[]');
                const allContentIds = [...moviesList.map(m => m.id), ...seriesList.map(s => s.id)];

                if (allContentIds.length === 0) {
                    filteredActors.push({ ...a, type: 'actor' });
                    continue;
                }

                // Check if at least one content is allowed
                let hasAllowed = false;
                for (const cid of allContentIds) {
                    if (await isContentAllowedForUser(cid, req.query.userId)) {
                        hasAllowed = true;
                        break;
                    }
                }
                if (hasAllowed) filteredActors.push({ ...a, type: 'actor' });
            }
            results = [...results, ...filteredActors];
        }

        if (type === 'all' || type === 'episodes') {
            const episodes = await db.all(`
                SELECT e.*, s.title as seriesTitle, sea.title as seasonTitle,
                       COALESCE(e.thumbnail, sea.poster, s.poster) as poster
                FROM episodes e
                JOIN series s ON e.seriesId = s.id
                JOIN seasons sea ON e.seasonId = sea.id
                WHERE e.title LIKE ? OR s.title LIKE ?
            `, [`%${query}%`, `%${query}%`]);

            const allowedEpisodes = [];
            for (const ep of episodes) {
                if (await isContentAllowedForUser(ep.id, req.query.userId)) {
                    allowedEpisodes.push({
                        ...ep,
                        type: 'episode',
                        displayTitle: `${ep.seriesTitle} - ${ep.title}`,
                        isMovie: false
                    });
                }
            }
            results = [...results, ...allowedEpisodes];
        }
        res.json(results);

    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.get('/api/home', async (req, res) => {
    try {
        const userId = req.query.userId;
        const profileId = req.query.profileId;
        const featured = await db.all('SELECT * FROM series WHERE promoted = 1 LIMIT 5');
        const latestSeries = await db.all('SELECT * FROM series WHERE isMovie = 0 ORDER BY createdAt DESC LIMIT 10');
        const latestMovies = await db.all('SELECT * FROM series WHERE isMovie = 1 ORDER BY createdAt DESC LIMIT 10');
        const collections = await db.all('SELECT * FROM collections ORDER BY order_num ASC');

        let continueWatching = [];
        if (userId) {
            const history = await db.all(`
                SELECT h.*, s.title as sTitle, s.poster as sPoster, s.backdrop, s.isMovie, s.ageRating, s.genres, 
                       e.title as epTitle, e.thumbnail as epThumb
                FROM watch_history h
                LEFT JOIN series s ON h.contentId = s.id
                LEFT JOIN episodes e ON h.episodeId = e.id AND h.contentType = 'episode'
                WHERE h.userId = ? AND h.progress > 0 AND h.progress < 90
                AND h.watchedAt = (SELECT MAX(watchedAt) FROM watch_history WHERE userId = h.userId AND contentId = h.contentId)
                ORDER BY h.watchedAt DESC
                LIMIT 30
            `, [userId]);

            // Filter history items manually or via helper
            const filteredHistory = [];
            for (const h of history) {
                // For series, contentId is now the seriesId
                if (await isContentAllowedForUser(h.contentId, userId, profileId)) {
                    filteredHistory.push(h);
                }
                if (filteredHistory.length >= 10) break;
            }

            continueWatching = filteredHistory.map(h => {
                if (h.contentType === 'episode') {
                    return {
                        id: h.episodeId, // Actual episode to play
                        title: `${h.sTitle || ''} - ${h.epTitle || 'حلقة'}`,
                        poster: h.epThumb || h.sPoster,
                        backdrop: h.backdrop,
                        progress: h.progress,
                        seconds: h.seconds || 0,
                        type: 'episode',
                        parentId: h.contentId // Series ID
                    };
                }
                return {
                    id: h.contentId,
                    title: h.sTitle,
                    poster: h.sPoster,
                    backdrop: h.backdrop,
                    progress: h.progress,
                    seconds: h.seconds || 0,
                    type: h.isMovie ? 'movie' : 'series'
                };
            });
        }

        const collectionsWithItems = [];
        for (const col of collections) {
            const items = await db.all(`
                SELECT s.id, s.title, s.poster, s.backdrop, s.isMovie, s.ageRating, s.genres
                FROM collection_items ci
                JOIN series s ON ci.mediaId = s.id
                WHERE ci.collectionId = ?
                ORDER BY ci.orderNum ASC
            `, [col.id]);

            const allowedItems = await filterContentForUser(items, userId, profileId);

            if (allowedItems.length > 0) {
                const posters = allowedItems.map(i => i.poster).filter(p => p);
                collectionsWithItems.push({
                    ...col,
                    items: allowedItems.map(c => ({
                        id: c.id, title: c.title, poster: c.poster, backdrop: c.backdrop, type: c.isMovie ? 'movie' : 'series'
                    })),
                    posters,
                    itemCount: allowedItems.length
                });
            }
        }

        const genres = await db.all('SELECT * FROM genres');
        const countries = await db.all('SELECT * FROM countries');
        const mapSeries = s => {
            const parse = (val) => {
                if (!val) return [];
                try { return typeof val === 'string' ? JSON.parse(val) : val; }
                catch (e) { return []; }
            };
            return {
                ...s,
                tags: parse(s.tags),
                genres: parse(s.genres),
                countries: parse(s.countries),
                actors: parse(s.actors),
                actorRoles: parse(s.actorRoles),
                promoted: !!s.promoted,
                isMovie: !!s.isMovie
            };
        };
        res.json({
            featured: await filterContentForUser(await resolveGenreNames(featured.map(mapSeries)), userId, profileId),
            latestSeries: await filterContentForUser(await resolveGenreNames(latestSeries.map(mapSeries)), userId, profileId),
            latestMovies: await filterContentForUser(await resolveGenreNames(latestMovies.map(mapSeries)), userId, profileId),
            collections: collectionsWithItems,
            genres,
            countries,
            continueWatching
        });

    } catch (error) {
        res.status(500).json({ error: 'خطأ: ' + error.message });
    }
});
app.post('/api/watch/:id', async (req, res) => {
    try {
        const { type = 'episode' } = req.body;
        if (type === 'episode') {
            const ep = await db.get('SELECT seriesId FROM episodes WHERE id = ?', [req.params.id]);
            if (ep) {
                await db.run('UPDATE episodes SET views = views + 1 WHERE id = ?', [req.params.id]);
                await db.run('UPDATE series SET views = views + 1 WHERE id = ?', [ep.seriesId]);
            }
        } else {
            await db.run('UPDATE series SET views = views + 1 WHERE id = ?', [req.params.id]);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, name, age } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبة' });
        }
        const existing = await db.get('SELECT id FROM users WHERE username = ?', [username]);
        if (existing) {
            return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
        }
        const userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const now = new Date().toISOString();
        await db.run(`INSERT INTO users (id, username, password, createdAt, lastActive) VALUES (?, ?, ?, ?, ?)`,
            [userId, username, password, now, now]);
        const profileId = 'profile_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        await db.run(`INSERT INTO profiles (id, userId, name, avatar, isDefault, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
            [profileId, userId, name || username, '/assets/default.png', 1, now]);
        res.json({ success: true, message: 'تم إنشاء الحساب بنجاح', user: { id: userId, username }, profile: { id: profileId, name: name || username } });
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ في إنشاء الحساب' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await db.get('SELECT id, username, name, age, avatar, role, groupId, custom_restrictions FROM users WHERE username = ? AND password = ?', [username, password]);
        if (!user) {
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
        await db.run('UPDATE users SET lastActive = ? WHERE id = ?', [new Date().toISOString(), user.id]);
        let profiles = await db.all('SELECT id, name, avatar, isDefault FROM profiles WHERE userId = ?', [user.id]);

        // إذا لم يكن هناك بروفايلات، قم بإنشاء واحد افتراضي
        if (profiles.length === 0) {
            const profileId = 'profile_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            await db.run(`INSERT INTO profiles (id, userId, name, avatar, isDefault, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
                [profileId, user.id, user.name || user.username, '/assets/default.png', 1, new Date().toISOString()]);
            profiles = [{ id: profileId, name: user.name || user.username, avatar: '/assets/default.png', isDefault: 1 }];
        }

        res.json({ success: true, user, profiles });
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ في تسجيل الدخول' });
    }
});

// تحديث بيانات المستخدم الحالي
app.put('/api/me/update', async (req, res) => {
    try {
        const { userId, name, password, avatar } = req.body;

        if (!userId) return res.status(400).json({ error: 'User ID is required' });

        const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
        if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

        const newName = name !== undefined ? name : user.name;
        const newAvatar = avatar !== undefined ? avatar : user.avatar;
        const newPassword = password !== undefined ? password : user.password;

        await db.run('UPDATE users SET name = ?, password = ?, avatar = ? WHERE id = ?',
            [newName, newPassword, newAvatar, userId]);

        await db.run('UPDATE profiles SET name = ?, avatar = ? WHERE userId = ? AND isDefault = 1', [newName, newAvatar, userId]);

        res.json({ success: true, message: 'تم تحديث البيانات بنجاح' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.post('/api/auth/select-profile', async (req, res) => {
    try {
        const { profileId, userId, pin } = req.body;
        console.log('[DEBUG] Select Profile Attempt:', { profileId, userId });

        // جلب البروفايل
        const profile = await db.get(`SELECT * FROM profiles WHERE id = ?`, [profileId]);

        if (!profile) {
            console.error('[ERROR] Profile NOT found:', profileId);
            // تشخيص: عرض جميع البروفايلات لهذا المستخدم لمعرفة المشكلة
            const allUserProfiles = await db.all('SELECT id FROM profiles WHERE userId = ?', [userId]);
            console.log('[DIAGNOSTIC] All IDs in DB for this user:', allUserProfiles.map(p => p.id));
            return res.status(404).json({ error: 'الملف الشخصي غير موجود في قاعدة البيانات' });
        }

        // تحقق من الرمز السري إذا كان موجوداً في قاعدة البيانات
        if (profile.pin && profile.pin !== pin) {
            return res.status(401).json({ error: 'الرمز السري غير صحيح' });
        }

        if (profile.userId !== userId) {
            console.error('[ERROR] Profile userId mismatch:', { profileUserId: profile.userId, sessionUserId: userId });
            return res.status(403).json({ error: 'هذا الملف الشخصي لا ينتمي لهذا الحساب' });
        }

        const user = await db.get('SELECT username FROM users WHERE id = ?', [userId]);

        res.json({
            success: true,
            session: {
                userId: profile.userId,
                username: user?.username || 'user',
                profileId: profile.id,
                name: profile.name,
                avatar: profile.avatar,
                profileName: profile.name,
                profileAvatar: profile.avatar,
                restrictions: JSON.parse(profile.restrictions || '[]'),
                ageLimit: profile.ageLimit || 0
            }
        });
    } catch (error) {
        console.error('[CRITICAL] select-profile error:', error);
        res.status(500).json({ error: 'حدث خطأ داخلي في السيرفر' });
    }
});
// جلب جميع الملفات الشخصية لمستخدم
app.get('/api/users/:userId/profiles', async (req, res) => {
    try {
        let profiles = await db.all('SELECT id, name, avatar, isDefault, ageLimit FROM profiles WHERE userId = ?', [req.params.userId]);

        // التأكد من وجود بروفايل واحد على الأقل
        if (profiles.length === 0) {
            const user = await db.get('SELECT username, name FROM users WHERE id = ?', [req.params.userId]);
            if (user) {
                const profileId = 'profile_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                await db.run(`INSERT INTO profiles (id, userId, name, avatar, isDefault, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
                    [profileId, req.params.userId, user.name || user.username, '/assets/default.png', 1, new Date().toISOString()]);
                profiles = await db.all('SELECT id, name, avatar, isDefault, ageLimit FROM profiles WHERE userId = ?', [req.params.userId]);
            }
        }

        res.json(profiles);
    } catch (error) {
        res.status(500).json({ error: 'خطأ في جلب الملفات الشخصية' });
    }
});
// إضافة ملف شخصي جديد
app.post('/api/profiles', async (req, res) => {
    try {
        const { userId, name, avatar } = req.body;
        if (!userId || !name) return res.status(400).json({ error: 'معرف المستخدم واسم الملف الشخصي مطلوبان' });
        const profileId = 'profile_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        await db.run(`INSERT INTO profiles (id, userId, name, avatar, isDefault, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
            [profileId, userId, name, avatar || '/assets/default.png', 0, new Date().toISOString()]);
        res.json({ success: true, message: 'تم إنشاء الملف الشخصي بنجاح', profile: { id: profileId, name, avatar: avatar || '/assets/default.png' } });
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ في إنشاء الملف الشخصي' });
    }
});
// تحديث ملف شخصي (للرقابة الأبوية)
app.put('/api/profiles/:profileId', async (req, res) => {
    try {
        const { name, avatar, ageLimit, restrictions } = req.body;
        const updates = [], values = [];
        if (name !== undefined) { updates.push('name = ?'); values.push(name); }
        if (avatar !== undefined) { updates.push('avatar = ?'); values.push(avatar); }
        if (ageLimit !== undefined) { updates.push('ageLimit = ?'); values.push(ageLimit); }
        if (restrictions !== undefined) { updates.push('restrictions = ?'); values.push(JSON.stringify(restrictions)); }
        if (updates.length === 0) return res.json({ success: true });
        values.push(req.params.profileId);
        await db.run(`UPDATE profiles SET ${updates.join(', ')} WHERE id = ?`, values);
        res.json({ success: true, message: 'تم تحديث الملف الشخصي' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في تحديث الملف الشخصي' });
    }
});
app.get('/api/logs', authenticateAdmin, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const logs = await db.all('SELECT * FROM logs ORDER BY timestamp DESC LIMIT ?', [limit]);
        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.get('/api/backup', authenticateAdmin, async (req, res) => {
    try {
        const backup = {
            series: await db.all('SELECT * FROM series'),
            seasons: await db.all('SELECT * FROM seasons'),
            episodes: await db.all('SELECT * FROM episodes'),
            actors: await db.all('SELECT * FROM actors'),
            genres: await db.all('SELECT * FROM genres'),
            countries: await db.all('SELECT * FROM countries'),
            tags: await db.all('SELECT * FROM tags'),
            admins: await db.all('SELECT * FROM admins'),
            timestamp: new Date().toISOString()
        };
        res.json(backup);
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
app.post('/api/restore', authenticateAdmin, upload.single('backup'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });
        const backupData = JSON.parse(fs.readFileSync(req.file.path, 'utf8'));
        if (backupData.db && backupData.admins) {
            fs.writeFileSync('data/db.json', JSON.stringify(backupData.db, null, 2));
            fs.writeFileSync('data/admins.json', JSON.stringify(backupData.admins, null, 2));
            fs.unlinkSync(req.file.path);
            res.json({ success: true, message: 'تم الاستعادة بنجاح' });
        } else {
            res.status(400).json({ error: 'ملف غير صالح' });
        }
    } catch (error) {
        res.status(500).json({ error: 'خطأ' });
    }
});
// ==================== 10. إدارة الملفات (Files Management) ====================
// دالة مساعدة لفحص نوع الملف
function getFileCategory(filename, mimetype) {
    if (!filename) return 'other';
    const ext = path.extname(filename).toLowerCase();
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
    const videoExts = ['.mp4', '.mkv', '.mov', '.wmv', '.flv', '.webm'];
    const subtitleExts = ['.vtt', '.srt', '.ass', '.ssa'];
    if (imageExts.includes(ext) || mimetype?.startsWith('image/')) return 'image';
    if (videoExts.includes(ext) || mimetype?.startsWith('video/')) return 'video';
    if (subtitleExts.includes(ext)) return 'subtitle';
    return 'other';
}
// دالة لجلب جميع الارتباطات من قاعدة البيانات لسرعة الفحص
// دالة لجلب جميع الارتباطات من قاعدة البيانات لسرعة الفحص
async function getAllFileLinks() {
    const map = new Map();
    
    const addLink = (url, linkData) => {
        if (!url) return;
        try {
            const decodedUrl = decodeURIComponent(url);
            const filename = path.basename(decodedUrl);
            
            // دالة مساعدة لإضافة الرابط بدون تكرار
            const addToMap = (key, link) => {
                if (!map.has(key)) map.set(key, []);
                const existing = map.get(key);
                // التحقق من عدم وجود نفس الرابط بالفعل (نفس ID ونفس الحقل)
                const exists = existing.some(l => l.id === link.id && l.field === link.field);
                if (!exists) {
                    existing.push(link);
                }
            };
            
            // إضافة باستخدام URL الكامل
            addToMap(decodedUrl, linkData);
            
            // إضافة باستخدام اسم الملف فقط
            addToMap(filename, linkData);
            
            // إضافة باستخدام المسار النسبي (بدون /uploads/)
            const relativePath = decodedUrl.replace(/^\/uploads\//, '');
            if (relativePath !== decodedUrl) {
                addToMap(relativePath, linkData);
            }
            
            // إضافة باستخدام المسار الكامل بدون بادئة /uploads/
            const fullRelative = relativePath;
            addToMap(fullRelative, linkData);
            
        } catch (e) { 
            console.error("Error adding link:", e);
        }
    };
    
    try {
        // المسلسلات والأفلام
        const series = await db.all('SELECT id, title, isMovie, poster, backdrop, videoUrl, subtitleUrl FROM series');
        for (const c of series) {
            const type = c.isMovie ? 'فيلم' : 'مسلسل';
            addLink(c.poster, { id: c.id, title: c.title, type, field: 'poster' });
            addLink(c.backdrop, { id: c.id, title: c.title, type, field: 'backdrop' }); // إضافة الـ backdrop
            addLink(c.videoUrl, { id: c.id, title: c.title, type, field: 'video' });
            addLink(c.subtitleUrl, { id: c.id, title: c.title, type, field: 'subtitle' });
        }
        
        // المواسم
        const seasons = await db.all('SELECT id, title, poster, backdrop FROM seasons');
        for (const s of seasons) {
            addLink(s.poster, { id: s.id, title: s.title, type: 'season', field: 'poster' });
            addLink(s.backdrop, { id: s.id, title: s.title, type: 'season', field: 'backdrop' });
        }
        
        // الحلقات
        const episodes = await db.all('SELECT id, title, poster, thumbnail, videoUrl, subtitleUrl FROM episodes');
        for (const e of episodes) {
            addLink(e.poster, { id: e.id, title: e.title, type: 'episode', field: 'poster' });
            addLink(e.thumbnail, { id: e.id, title: e.title, type: 'episode', field: 'thumbnail' });
            addLink(e.videoUrl, { id: e.id, title: e.title, type: 'episode', field: 'video' });
            addLink(e.subtitleUrl, { id: e.id, title: e.title, type: 'episode', field: 'subtitle' });
        }
        
        // الممثلين
        const actors = await db.all('SELECT id, name, image FROM actors');
        for (const a of actors) {
            addLink(a.image, { id: a.id, title: a.name, type: 'actor', field: 'image' });
        }
        
        // الدول
        const countries = await db.all('SELECT id, name, flag FROM countries');
        for (const c of countries) {
            addLink(c.flag, { id: c.id, title: c.name, type: 'country', field: 'flag' });
        }
        
        // الأجزاء
        const partsCheck = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='parts'");
        if (partsCheck.length > 0) {
            const parts = await db.all('SELECT id, title, poster, videoUrl FROM parts');
            for (const p of parts) {
                addLink(p.poster, { id: p.id, title: p.title, type: 'part', field: 'poster' });
                addLink(p.videoUrl, { id: p.id, title: p.title, type: 'part', field: 'video' });
            }
        }
        
        console.log(`[getAllFileLinks] Loaded ${map.size} unique keys, total links: ${Array.from(map.values()).reduce((a,b) => a + b.length, 0)}`);
        
    } catch (err) { 
        console.error("Error getting links:", err); 
    }
    return map;
}
// دالة لتحديث الروابط في قاعدة البيانات بعد نقل أو إعادة تسمية ملف
async function updateDbLinks(oldUrl, newUrl) {
    try {
        await db.run('UPDATE series SET poster = ? WHERE poster = ?', [newUrl, oldUrl]);
        await db.run('UPDATE series SET videoUrl = ? WHERE videoUrl = ?', [newUrl, oldUrl]);
        await db.run('UPDATE series SET subtitleUrl = ? WHERE subtitleUrl = ?', [newUrl, oldUrl]);
        await db.run('UPDATE seasons SET poster = ? WHERE poster = ?', [newUrl, oldUrl]);
        await db.run('UPDATE episodes SET poster = ? WHERE poster = ?', [newUrl, oldUrl]);
        await db.run('UPDATE episodes SET thumbnail = ? WHERE thumbnail = ?', [newUrl, oldUrl]);
        await db.run('UPDATE episodes SET videoUrl = ? WHERE videoUrl = ?', [newUrl, oldUrl]);
        await db.run('UPDATE episodes SET subtitleUrl = ? WHERE subtitleUrl = ?', [newUrl, oldUrl]);
        await db.run('UPDATE actors SET image = ? WHERE image = ?', [newUrl, oldUrl]);
        await db.run('UPDATE countries SET flag = ? WHERE flag = ?', [newUrl, oldUrl]);
        const partsCheck = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='parts'");
        if (partsCheck.length > 0) {
            await db.run('UPDATE parts SET poster = ? WHERE poster = ?', [newUrl, oldUrl]);
            await db.run('UPDATE parts SET videoUrl = ? WHERE videoUrl = ?', [newUrl, oldUrl]);
        }
    } catch (err) { console.error("Error updating DB links:", err); }
}
// جلب قائمة الملفات
// جلب قائمة الملفات
app.get('/api/fs/list', authenticateAdmin, async (req, res) => {
    try {
        const queryDir = req.query.dir || '';
        const baseUploads = path.join(__dirname, 'uploads');
        const targetDir = path.join(baseUploads, queryDir);
        if (!targetDir.startsWith(baseUploads)) return res.status(403).json({ error: 'وصول غير مصرح به' });
        if (!fs.existsSync(targetDir)) return res.status(404).json({ error: 'المجلد غير موجود' });
        
        const items = fs.readdirSync(targetDir);
        const map = await getAllFileLinks();
        const filesInfo = items.map(item => {
            const itemPath = path.join(targetDir, item);
            let isDir = false;
            let size = 0;
            try {
                const stat = fs.statSync(itemPath);
                isDir = stat.isDirectory();
                size = stat.size;
            } catch (e) { }
            
            const relPath = path.join(queryDir, item).replace(/\\/g, '/');
            const fileUrl = `/uploads/${relPath}`;
            
            let links = [];
            if (!isDir) {
                // محاولة البحث بطرق متعددة لضمان العثور على الرابط
                const linksByUrl = map.get(fileUrl) || [];
                const linksByRelativePath = map.get(relPath) || [];
                const linksByFilename = map.get(item) || [];
                const linksByDir = map.get(queryDir) || [];
                
                // دمج جميع النتائج وتجنب التكرار
                const allLinks = [...linksByUrl, ...linksByRelativePath, ...linksByFilename, ...linksByDir];
                const uniqueMap = new Map();
                for (const link of allLinks) {
                    const key = `${link.id}-${link.field}`;
                    if (!uniqueMap.has(key)) {
                        uniqueMap.set(key, link);
                    }
                }
                links = Array.from(uniqueMap.values());
            }
            
            return {
                name: item,
                path: relPath,
                isDir,
                size,
                category: isDir ? 'folder' : getFileCategory(item),
                url: fileUrl,
                links
            };
        });
        
        // ترتيب المجلدات أولاً
        filesInfo.sort((a, b) => {
            if (a.isDir && !b.isDir) return -1;
            if (!a.isDir && b.isDir) return 1;
            return a.name.localeCompare(b.name);
        });
        
        res.json({ success: true, files: filesInfo });
    } catch (error) {
        console.error('Error in /api/fs/list:', error);
        res.status(500).json({ error: error.message });
    }
});
app.post('/api/fs/mkdir', authenticateAdmin, (req, res) => {
    try {
        const { dir, name } = req.body;
        const baseUploads = path.join(__dirname, 'uploads');
        const targetDir = path.join(baseUploads, dir, name);
        if (!targetDir.startsWith(baseUploads)) return res.status(403).json({ error: 'غير مصرح' });
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/fs/move', authenticateAdmin, async (req, res) => {
    try {
        const { source, destination } = req.body;
        const baseUploads = path.join(__dirname, 'uploads');
        const srcPath = path.join(baseUploads, source);
        const destPath = path.join(baseUploads, destination);
        if (!srcPath.startsWith(baseUploads) || !destPath.startsWith(baseUploads)) return res.status(403).json({ error: 'غير مصرح' });
        if (!fs.existsSync(srcPath)) return res.status(404).json({ error: 'الملف غير موجود' });
        fs.renameSync(srcPath, destPath);
        const oldUrl = `/uploads/${source.replace(/\\/g, '/')}`;
        const newUrl = `/uploads/${destination.replace(/\\/g, '/')}`;
        await updateDbLinks(oldUrl, newUrl);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post('/api/fs/delete', authenticateAdmin, (req, res) => {
    try {
        const { path: delPath } = req.body;
        const baseUploads = path.join(__dirname, 'uploads');
        const targetPath = path.join(baseUploads, delPath);
        if (!targetPath.startsWith(baseUploads)) return res.status(403).json({ error: 'غير مصرح' });
        if (!fs.existsSync(targetPath)) return res.status(404).json({ error: 'غير موجود' });
        if (fs.statSync(targetPath).isDirectory()) {
            fs.rmSync(targetPath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(targetPath);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// دالة مساعدة لتنسيق حجم الملف
// جلب قائمة الملفات (نسخة مصححة 100%)
// ==================== USERS & GROUPS API ====================

// جلب جميع المستخدمين (للوحة التحكم)
app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
    console.log('GET /api/admin/users called');
    try {
        const users = await db.all('SELECT * FROM users ORDER BY createdAt DESC');
        console.log(`Found ${users.length} users`);
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: error.message });
    }
});

// إنشاء مستخدم جديد
app.post('/api/admin/users', authenticateAdmin, async (req, res) => {
    try {
        const { username, password, name, age, avatar, groupId, custom_restrictions } = req.body;
        const id = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        const createdAt = new Date().toISOString();
        await db.run(`INSERT INTO users (id, username, password, name, age, avatar, groupId, custom_restrictions, createdAt, lastActive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, username, password, name || username, age || 0, avatar || '/assets/default.png', groupId || null, custom_restrictions || '{"titles":[],"genres":[]}', createdAt, createdAt]);
        res.json({ success: true, id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// تحديث مستخدم
app.put('/api/admin/users/:id', authenticateAdmin, async (req, res) => {
    try {
        const { username, password, name, age, avatar, groupId, custom_restrictions } = req.body;
        await db.run(`UPDATE users SET username=?, password=?, name=?, age=?, avatar=?, groupId=?, custom_restrictions=? WHERE id=?`,
            [username, password, name || username, age || 0, avatar || '/assets/default.png', groupId || null, custom_restrictions || '{"titles":[],"genres":[]}', req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// حذف مستخدم
app.delete('/api/admin/users/:id', authenticateAdmin, async (req, res) => {
    try {
        await db.run('DELETE FROM users WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// جلب المجموعات
app.get('/api/admin/groups', authenticateAdmin, async (req, res) => {
    try {
        const groups = await db.all('SELECT * FROM age_groups ORDER BY min_age ASC');
        res.json(groups);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// إنشاء مجموعة
app.post('/api/admin/groups', authenticateAdmin, async (req, res) => {
    try {
        const { name, min_age, max_age, blocked_genres, blocked_titles } = req.body;
        const id = 'group_' + Date.now();
        const createdAt = new Date().toISOString();
        await db.run(`INSERT INTO age_groups (id, name, min_age, max_age, blocked_genres, blocked_titles, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, name, min_age || 0, max_age || 18, blocked_genres || '[]', blocked_titles || '[]', createdAt]);
        res.json({ success: true, id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// تحديث مجموعة
app.put('/api/admin/groups/:id', authenticateAdmin, async (req, res) => {
    try {
        const { name, min_age, max_age, blocked_genres, blocked_titles } = req.body;
        await db.run(`UPDATE age_groups SET name=?, min_age=?, max_age=?, blocked_genres=?, blocked_titles=? WHERE id=?`,
            [name, min_age || 0, max_age || 18, blocked_genres || '[]', blocked_titles || '[]', req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// حذف مجموعة
app.delete('/api/admin/groups/:id', authenticateAdmin, async (req, res) => {
    try {
        await db.run('DELETE FROM age_groups WHERE id=?', [req.params.id]);
        await db.run('UPDATE users SET groupId = NULL WHERE groupId=?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Public Profile APIs ---

// جلب جميع البروفايلات (المستخدمين) للشاشة الرئيسية - تم إيقافها لحماية خصوصية المستخدمين
app.get('/api/profiles', async (req, res) => {
    try {
        // لحماية الخصوصية، لا يتم إرجاع قائمة المستخدمين العامة
        res.json([]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/profiles/select', async (req, res) => {
    try {
        const { userId } = req.body;
        const user = await db.get('SELECT id, username, name, age, avatar, role, groupId, custom_restrictions FROM users WHERE id = ?', [userId]);
        if (user) {
            res.json({ success: true, user });
        } else {
            res.status(404).json({ error: 'المستخدم غير موجود' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/profiles/:id', authenticateAdmin, async (req, res) => {
    try {
        const { name, avatar, ageLimit, restrictions } = req.body;
        await db.run(`UPDATE profiles SET name=?, avatar=?, ageLimit=?, restrictions=? WHERE id=?`,
            [name, avatar, ageLimit || 0, JSON.stringify(restrictions || []), req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/profiles/:id', authenticateAdmin, async (req, res) => {
    try {
        await db.run('DELETE FROM profiles WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/history/:userId', async (req, res) => {
    try {
        const history = await db.all(`
            SELECT h.*, 
                   s.title as seriesTitle, s.poster as seriesPoster, s.isMovie,
                   e.title as epTitle, e.thumbnail as epThumb
            FROM watch_history h
            LEFT JOIN series s ON h.contentId = s.id
            LEFT JOIN episodes e ON h.episodeId = e.id AND h.contentType = 'episode'
            WHERE h.userId = ?
            ORDER BY h.watchedAt DESC
            LIMIT 100
        `, [req.params.userId]);

        const results = history.map(h => ({
            ...h,
            title: h.contentType === 'episode' ? `${h.seriesTitle || ''} - ${h.epTitle || 'حلقة'}` : h.seriesTitle,
            poster: (h.contentType === 'episode' ? h.epThumb : h.seriesPoster) || h.seriesPoster
        }));

        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/user-activity/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const [history, likes, watchlist] = await Promise.all([
            db.all(`
                SELECT h.*, s.title, e.title as epTitle 
                FROM watch_history h 
                LEFT JOIN series s ON h.contentId = s.id
                LEFT JOIN episodes e ON h.episodeId = e.id AND h.contentType = 'episode'
                WHERE h.userId = ? ORDER BY h.watchedAt DESC LIMIT 50`, [userId]),
            db.all(`
                SELECT l.*, s.title 
                FROM user_likes l 
                JOIN series s ON l.contentId = s.id 
                WHERE l.userId = ? ORDER BY l.likedAt DESC`, [userId]),
            db.all(`
                SELECT w.*, s.title 
                FROM watchlist w 
                JOIN series w_s ON w.contentId = w_s.id 
                WHERE w.userId = ? ORDER BY w.addedAt DESC`, [userId])
        ]);
        res.json({ history, likes, watchlist });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/content-names', authenticateAdmin, async (req, res) => {
    try {
        const content = await db.all('SELECT id, title, titleAr, titleEn, poster, isMovie FROM series ORDER BY title ASC');
        res.json(content);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/user-allowed-content/:userId', authenticateAdmin, async (req, res) => {
    try {
        const userId = req.params.userId;
        const allContent = await db.all('SELECT * FROM series ORDER BY createdAt DESC');
        const allowedContent = await filterContentForUser(allContent, userId);
        res.json(allowedContent);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/user-blocked-content/:userId', authenticateAdmin, async (req, res) => {
    try {
        const userId = req.params.userId;
        const allContent = await db.all('SELECT * FROM series ORDER BY createdAt DESC');
        const allowedContent = await filterContentForUser(allContent, userId);
        const allowedIds = new Set(allowedContent.map(c => c.id));
        const blockedContent = allContent.filter(c => !allowedIds.has(c.id));
        res.json(blockedContent);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/history', async (req, res) => {
    try {
        const { userId, contentId, contentType, progress } = req.body;
        if (!userId || !contentId) return res.status(400).json({ error: 'userId and contentId required' });
        const id = 'hist_' + Date.now();
        const watchedAt = new Date().toISOString();
        await db.run(`INSERT INTO watch_history (id, userId, contentId, contentType, watchedAt, progress) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, userId, contentId, contentType, watchedAt, progress || 0]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/watch/:id', async (req, res) => {
    try {
        const userId = req.query.userId || (req.body ? req.body.userId : null);
        const isAllowed = await isContentAllowedForUser(req.params.id, userId);
        if (!isAllowed) {
            return res.status(403).json({ error: 'هذا المحتوى محظور' });
        }

        const id = req.params.id;

        const isEpisode = id.startsWith('episode_');
        const table = isEpisode ? 'episodes' : 'series';
        await db.run(`UPDATE ${table} SET views = views + 1 WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/watchlist/add', async (req, res) => {
    try {
        const { userId, contentId, contentType } = req.body;
        if (!userId || !contentId) return res.status(400).json({ error: 'userId and contentId required' });

        const id = 'wl_' + Date.now();
        const addedAt = new Date().toISOString();

        const existing = await db.get('SELECT * FROM watchlist WHERE userId = ? AND contentId = ?', [userId, contentId]);
        if (existing) return res.json({ success: true, message: 'Already in watchlist' });

        await db.run(`INSERT INTO watchlist (id, userId, contentId, contentType, addedAt) VALUES (?, ?, ?, ?, ?)`,
            [id, userId, contentId, contentType || 'movie', addedAt]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/watchlist/:userId', async (req, res) => {
    try {
        const watchlist = await db.all(`
            SELECT w.*, s.title, s.poster, s.rating, s.year, s.isMovie
            FROM watchlist w
            JOIN series s ON w.contentId = s.id
            WHERE w.userId = ?
            ORDER BY w.addedAt DESC
        `, [req.params.userId]);
        res.json(watchlist);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/like/:contentId', async (req, res) => {
    try {
        await db.run('UPDATE series SET likes = likes + 1 WHERE id = ?', [req.params.contentId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

async function filterContentForUser(contentArray, userId, profileId = null) {
    if (!userId) return contentArray;
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return contentArray;

    let blockedGenres = [];
    let blockedTitles = [];
    let ageLimit = 0;

    // 1. User Level Restrictions
    try {
        const custom = typeof user.custom_restrictions === 'string' ? JSON.parse(user.custom_restrictions) : user.custom_restrictions;
        if (custom) {
            blockedGenres.push(...(custom.genres || []));
            blockedTitles.push(...(custom.titles || []));
        }
    } catch (e) { }

    // 2. Profile Level Restrictions (If profileId provided)
    if (profileId) {
        const profile = await db.get('SELECT * FROM profiles WHERE id = ?', [profileId]);
        if (profile) {
            try {
                const pRestrictions = typeof profile.restrictions === 'string' ? JSON.parse(profile.restrictions) : profile.restrictions;
                if (Array.isArray(pRestrictions)) {
                    blockedTitles.push(...pRestrictions);
                }

                // New profile table columns
                if (profile.blocked_genres) {
                    const bGenres = typeof profile.blocked_genres === 'string' ? JSON.parse(profile.blocked_genres) : profile.blocked_genres;
                    blockedGenres.push(...(bGenres || []));
                }
                if (profile.blocked_titles) {
                    const bTitles = typeof profile.blocked_titles === 'string' ? JSON.parse(profile.blocked_titles) : profile.blocked_titles;
                    blockedTitles.push(...(bTitles || []));
                }

                if (profile.ageLimit > ageLimit) ageLimit = profile.ageLimit;
            } catch (e) { }
        }
    }

    // 3. Group Level Restrictions
    if (user.groupId) {
        const group = await db.get('SELECT * FROM age_groups WHERE id = ?', [user.groupId]);
        if (group) {
            try {
                const bGenres = typeof group.blocked_genres === 'string' ? JSON.parse(group.blocked_genres) : group.blocked_genres;
                const bTitles = typeof group.blocked_titles === 'string' ? JSON.parse(group.blocked_titles) : group.blocked_titles;
                blockedGenres.push(...(bGenres || []));
                blockedTitles.push(...(bTitles || []));

                if (group.min_age > ageLimit) ageLimit = group.min_age;
            } catch (e) { }
        }
    }

    blockedGenres = [...new Set(blockedGenres.map(g => g.toString().trim().toLowerCase()))];
    blockedTitles = [...new Set(blockedTitles.map(t => t.toString().trim().toLowerCase()))];

    return contentArray.filter(item => {
        const titleLower = item.title ? item.title.toLowerCase() : '';
        const titleArLower = item.titleAr ? item.titleAr.toLowerCase() : '';
        const titleEnLower = item.titleEn ? item.titleEn.toLowerCase() : '';

        if (blockedTitles.includes(titleLower) ||
            blockedTitles.includes(titleArLower) ||
            blockedTitles.includes(titleEnLower)) return false;

        let itemGenres = [];
        try {
            itemGenres = typeof item.genres === 'string' ? JSON.parse(item.genres) : item.genres;
        } catch (e) { }

        if (itemGenres && itemGenres.some(g => {
            const gName = g.name ? g.name.toLowerCase() : (typeof g === 'string' ? g.toLowerCase() : '');
            return blockedGenres.includes(gName);
        })) return false;

        const ratingMap = { 'G': 0, 'PG': 8, 'PG-13': 13, 'R': 17, 'NC-17': 18, 'TV-Y': 0, 'TV-Y7': 7, 'TV-G': 0, 'TV-PG': 8, 'TV-14': 14, 'TV-MA': 18 };
        const itemRating = item.ageRating || 'G';
        const reqAge = ratingMap[itemRating] || 0;

        // Use the effective age (user age vs age limit)
        const effectiveUserAge = user.age || 0;
        if (effectiveUserAge < reqAge) return false;
        if (ageLimit > 0 && reqAge > ageLimit) return false; // Optional: additional group/profile age limit logic

        return true;
    });
}

async function isContentAllowedForUser(contentId, userId, profileId = null) {
    if (!contentId) return false;
    if (!userId) return true;
    let content;
    if (typeof contentId === 'string' && contentId.startsWith('episode_')) {
        const ep = await db.get('SELECT seriesId FROM episodes WHERE id = ?', [contentId]);
        if (!ep) return false;
        content = await db.get('SELECT * FROM series WHERE id = ?', [ep.seriesId]);
    } else {
        content = await db.get('SELECT * FROM series WHERE id = ?', [contentId]);
    }

    if (!content) return false;

    const results = await filterContentForUser([content], userId, profileId);
    return results.length > 0;
}



app.post('/api/user/like', async (req, res) => {
    try {
        const { userId, contentId, contentType } = req.body;
        if (!userId || !contentId) return res.status(400).json({ error: 'Missing parameters' });

        if (!(await isContentAllowedForUser(contentId, userId))) {
            return res.status(403).json({ error: 'غير مسموح بتقييم هذا المحتوى' });
        }

        const existing = await db.get('SELECT id FROM user_likes WHERE userId = ? AND contentId = ?', [userId, contentId]);
        let isLiked = false;

        if (existing) {
            await db.run('DELETE FROM user_likes WHERE id = ?', [existing.id]);
        } else {
            const id = 'like_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            await db.run('INSERT INTO user_likes (id, userId, contentId, contentType, likedAt) VALUES (?, ?, ?, ?, ?)',
                [id, userId, contentId, contentType || 'movie', new Date().toISOString()]);
            isLiked = true;
        }

        const table = contentType === 'episode' ? 'episodes' : 'series';
        const increment = isLiked ? 1 : -1;
        await db.run(`UPDATE ${table} SET likes = MAX(0, likes + ?) WHERE id = ?`, [increment, contentId]);

        res.json({ success: true, isLiked });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/user/save', async (req, res) => {
    try {
        const { userId, contentId, contentType } = req.body;
        if (!userId || !contentId) return res.status(400).json({ error: 'Missing parameters' });

        if (!(await isContentAllowedForUser(contentId, userId))) {
            return res.status(403).json({ error: 'غير مسموح بحفظ هذا المحتوى' });
        }

        const existing = await db.get('SELECT id FROM watchlist WHERE userId = ? AND contentId = ?', [userId, contentId]);
        let isSaved = false;

        if (existing) {
            await db.run('DELETE FROM watchlist WHERE id = ?', [existing.id]);
        } else {
            const id = 'watch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            await db.run('INSERT INTO watchlist (id, userId, contentId, contentType, addedAt) VALUES (?, ?, ?, ?, ?)',
                [id, userId, contentId, contentType || 'movie', new Date().toISOString()]);
            isSaved = true;
        }

        res.json({ success: true, isSaved });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/user/history', async (req, res) => {
    try {
        const { userId, contentId, contentType, episodeId, progress, seconds, isPlaying } = req.body;
        if (!userId || !contentId) return res.status(400).json({ error: 'Missing parameters' });

        const now = new Date().toISOString();

        // Check for existing record for this specific episode/movie
        const existing = await db.get(
            'SELECT id FROM watch_history WHERE userId = ? AND contentId = ? AND (episodeId = ? OR (episodeId IS NULL AND ? IS NULL))',
            [userId, contentId, episodeId || null, episodeId || null]
        );

        if (existing) {
            await db.run(
                'UPDATE watch_history SET progress = ?, seconds = ?, watchedAt = ?, contentType = ?, episodeId = ? WHERE id = ?',
                [progress, seconds || 0, now, contentType || 'movie', episodeId || null, existing.id]
            );
        } else {
            const id = 'hist_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            await db.run(
                'INSERT INTO watch_history (id, userId, contentId, contentType, episodeId, watchedAt, progress, seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [id, userId, contentId, contentType || 'movie', episodeId || null, now, progress, seconds || 0]
            );
        }

        // Sessions logic: Only increment duration if the content is being played
        if (isPlaying) {
            const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
            const sessionContentId = episodeId || contentId;

            const recentSession = await db.get(
                'SELECT id, duration FROM watch_sessions WHERE userId = ? AND contentId = ? AND watchedAt > ? ORDER BY watchedAt DESC LIMIT 1',
                [userId, sessionContentId, fifteenMinsAgo]
            );

            if (recentSession) {
                await db.run('UPDATE watch_sessions SET duration = duration + 10, watchedAt = ? WHERE id = ?', [now, recentSession.id]);
            } else {
                const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                await db.run('INSERT INTO watch_sessions (id, userId, contentId, contentType, watchedAt, duration) VALUES (?, ?, ?, ?, ?, ?)',
                    [sessionId, userId, sessionContentId, contentType || 'movie', now, 10]);
            }
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/user/detailed-history/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;


        const historyRaw = await db.all(`
            SELECT h.*, 
                   s.title as sTitle, s.poster as sPoster, s.year as sYear, s.isMovie,
                   e.title as epTitle, e.thumbnail as epThumb
            FROM watch_history h
            LEFT JOIN series s ON h.contentId = s.id
            LEFT JOIN episodes e ON h.episodeId = e.id AND h.contentType = 'episode'
            WHERE h.userId = ? AND h.progress > 0
            ORDER BY h.watchedAt DESC
            LIMIT 50
        `, [userId]);

        const history = historyRaw.map(h => ({
            ...h,
            title: h.contentType === 'episode' ? `${h.sTitle || ''} - ${h.epTitle || 'حلقة'}` : h.sTitle,
            poster: (h.contentType === 'episode' ? h.epThumb : h.sPoster) || h.sPoster,
            year: h.sYear
        }));


        const completed = history.filter(h => h.progress >= 90);


        const statsRaw = await db.all(`
            SELECT contentId, contentType, SUM(duration) as totalTime, COUNT(*) as sessionCount
            FROM watch_sessions
            WHERE userId = ?
            GROUP BY contentId, contentType
        `, [userId]);

        const stats = await Promise.all(statsRaw.map(async s => {
            let details;
            if (s.contentType === 'episode') {
                details = await db.get(`
                    SELECT e.title, COALESCE(e.thumbnail, sea.poster, ser.poster) as poster, 
                           ser.title as seriesTitle, ser.year, ser.rating, ser.isMovie
                    FROM episodes e
                    LEFT JOIN seasons sea ON e.seasonId = sea.id
                    LEFT JOIN series ser ON e.seriesId = ser.id
                    WHERE e.id = ?
                `, [s.contentId]);
                if (details) details.title = `${details.seriesTitle} - ${details.title}`;
            } else {
                details = await db.get('SELECT title, poster, year, rating, isMovie FROM series WHERE id = ?', [s.contentId]);
            }
            return { ...s, ...details };
        }));

        const totalWatchTime = statsRaw.reduce((acc, curr) => acc + curr.totalTime, 0);

        // 4. Timeline (Memories)
        const timelineRaw = await db.all(`
            SELECT ws.*, 
                   COALESCE(e.title, s.title) as title, 
                   COALESCE(e.thumbnail, sea.poster, s.poster) as poster,
                   s.title as seriesTitle,
                   s.year,
                   s.rating,
                   s.isMovie
            FROM watch_sessions ws
            LEFT JOIN episodes e ON ws.contentId = e.id AND ws.contentType = 'episode'
            LEFT JOIN seasons sea ON e.seasonId = sea.id
            LEFT JOIN series s ON (ws.contentId = s.id AND ws.contentType != 'episode') OR (e.seriesId = s.id)
            WHERE ws.userId = ?
            ORDER BY ws.watchedAt DESC
            LIMIT 100
        `, [userId]);

        const timeline = timelineRaw.map(t => ({
            ...t,
            title: t.seriesTitle && t.contentType === 'episode' ? `${t.seriesTitle} - ${t.title}` : t.title
        }));

        res.json({
            history,
            completed,
            stats: {
                items: stats,
                totalSeconds: totalWatchTime
            },
            timeline
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/user/state/:contentId', async (req, res) => {
    try {
        const { userId: rawUserId, episodeId } = req.query;
        const userId = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;
        const contentId = req.params.contentId;

        if (!userId) return res.json({ isLiked: false, isSaved: false, progress: 0, seconds: 0 });

        // Fetch like and save status for the content (series or movie)
        const [like, save] = await Promise.all([
            db.get('SELECT id FROM user_likes WHERE userId = ? AND contentId = ?', [userId, contentId]),
            db.get('SELECT id FROM watchlist WHERE userId = ? AND contentId = ?', [userId, contentId])
        ]);

        // Fetch history record. If episodeId is provided, get that specific episode. 
        // Otherwise get the latest record for that contentId.
        let history;
        if (episodeId) {
            history = await db.get('SELECT progress, seconds, episodeId FROM watch_history WHERE userId = ? AND contentId = ? AND episodeId = ?', [userId, contentId, episodeId]);
        } else {
            history = await db.get('SELECT progress, seconds, episodeId FROM watch_history WHERE userId = ? AND contentId = ? ORDER BY watchedAt DESC LIMIT 1', [userId, contentId]);
        }

        res.json({
            isLiked: !!like,
            isSaved: !!save,
            progress: history ? history.progress : 0,
            seconds: history ? history.seconds : 0,
            episodeId: history ? history.episodeId : null
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/user/library/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;

        const getDetails = async (items) => {
            const results = await Promise.all(items.map(async item => {
                let details;
                if (item.contentType === 'episode') {
                    // contentId is the series ID, episodeId is the actual episode
                    const [series, episode] = await Promise.all([
                        db.get('SELECT title, poster FROM series WHERE id = ?', [item.contentId]),
                        db.get('SELECT id, title, thumbnail FROM episodes WHERE id = ?', [item.episodeId || item.contentId])
                    ]);
                    if (series && episode) {
                        details = {
                            id: episode.id,
                            title: `${series.title} - ${episode.title}`,
                            poster: episode.thumbnail || series.poster,
                            type: 'episode',
                            seriesId: item.contentId
                        };
                    }
                } else {
                    details = await db.get('SELECT id, title, poster, isMovie, rating, year FROM series WHERE id = ?', [item.contentId]);
                    if (details) {
                        details.type = details.isMovie ? 'movie' : 'series';
                    }
                }
                return details ? { ...details, ...item } : null;
            }));
            return results.filter(Boolean);
        };

        const [watchlistRaw, likesRaw, historyRaw] = await Promise.all([
            db.all('SELECT contentId, contentType, addedAt FROM watchlist WHERE userId = ? ORDER BY addedAt DESC', [userId]),
            db.all('SELECT contentId, contentType, likedAt FROM user_likes WHERE userId = ? ORDER BY likedAt DESC', [userId]),
            db.all('SELECT contentId, contentType, episodeId, watchedAt, progress, seconds FROM watch_history WHERE userId = ? AND progress > 0 ORDER BY watchedAt DESC', [userId])
        ]);

        const [watchlistAll, likesAll, historyAll] = await Promise.all([
            getDetails(watchlistRaw),
            getDetails(likesRaw),
            getDetails(historyRaw)
        ]);

        // Filter based on allowed content
        const filterAllowed = async (items) => {
            const results = [];
            for (const item of items) {
                // If it's an episode, we need to check the series
                const checkId = item.contentType === 'episode' ? (item.seriesId || item.contentId) : item.contentId;
                if (await isContentAllowedForUser(checkId, userId)) {
                    results.push(item);
                }
            }
            return results;
        };

        const [watchlist, likes, history] = await Promise.all([
            filterAllowed(watchlistAll),
            filterAllowed(likesAll),
            filterAllowed(historyAll)
        ]);

        res.json({ watchlist, likes, history });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// --- Social & Chat APIs ---
// ==========================================

// Search user by username with privacy logic
app.get('/api/social/search', async (req, res) => {
    try {
        const { username, currentUserId } = req.query;
        if (!username || !currentUserId) {
            return res.status(400).json({ error: 'البيانات المطلوبة ناقصة' });
        }
        
        const targetUser = await db.get('SELECT id, username, name, avatar FROM users WHERE username = ?', [username.trim()]);
        if (!targetUser) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }
        
        if (targetUser.id === currentUserId) {
            return res.status(400).json({ error: 'لا يمكنك البحث عن نفسك' });
        }
        
        // Check follow relationships with status
        const followTo = await db.get('SELECT id, status FROM social_follows WHERE followerId = ? AND followingId = ?', [currentUserId, targetUser.id]);
        const followFrom = await db.get('SELECT id, status FROM social_follows WHERE followerId = ? AND followingId = ?', [targetUser.id, currentUserId]);
        
        const isFollowing = !!followTo;
        const isFollower = !!followFrom;
        const isMutual = isFollowing && isFollower && followTo.status === 'accepted' && followFrom.status === 'accepted';
        
        if (isMutual) {
            res.json({
                user: {
                    id: targetUser.id,
                    username: targetUser.username,
                    name: targetUser.name || targetUser.username,
                    avatar: targetUser.avatar,
                    isBlurred: false
                },
                followStatus: 'mutual'
            });
        } else {
            let status = 'none';
            if (isFollowing) {
                status = followTo.status === 'pending' ? 'pending_sent' : 'following_only';
            } else if (isFollower) {
                status = followFrom.status === 'pending' ? 'pending_received' : 'follower_only';
            }
            
            res.json({
                user: {
                    id: targetUser.id,
                    username: 'مجهول',
                    name: 'مجهول',
                    avatar: targetUser.avatar,
                    isBlurred: true
                },
                followStatus: status
            });
        }
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ في البحث' });
    }
});

// Follow a user
app.post('/api/social/follow', async (req, res) => {
    try {
        const { followerId, followingId } = req.body;
        if (!followerId || !followingId) {
            return res.status(400).json({ error: 'البيانات ناقصة' });
        }
        
        const existing = await db.get('SELECT id, status FROM social_follows WHERE followerId = ? AND followingId = ?', [followerId, followingId]);
        if (!existing) {
            const id = uuidv4();
            await db.run("INSERT INTO social_follows (id, followerId, followingId, status, createdAt) VALUES (?, ?, ?, 'pending', ?)",
                [id, followerId, followingId, new Date().toISOString()]);
            
            // Emit real-time notification
            io.to(`user_${followingId}`).emit('follow_request_received', { followerId });
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء المتابعة' });
    }
});

// Get follow requests
app.get('/api/social/requests', async (req, res) => {
    try {
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ error: 'معرف المستخدم مطلوب' });
        
        const requests = await db.all(`
            SELECT f.id as requestId, u.id as userId, u.username, u.name, u.avatar, f.createdAt
            FROM social_follows f
            JOIN users u ON f.followerId = u.id
            WHERE f.followingId = ? AND f.status = 'pending'
            ORDER BY f.createdAt DESC
        `, [userId]);
        
        res.json(requests);
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء جلب الطلبات' });
    }
});

// Accept a follow request
app.post('/api/social/requests/accept', async (req, res) => {
    try {
        const { requestId, userId } = req.body; // userId is B (recipient accepting the request)
        if (!requestId || !userId) {
            return res.status(400).json({ error: 'البيانات ناقصة' });
        }
        
        const followReq = await db.get('SELECT followerId FROM social_follows WHERE id = ? AND followingId = ?', [requestId, userId]);
        if (!followReq) {
            return res.status(404).json({ error: 'الطلب غير موجود' });
        }
        
        const requesterId = followReq.followerId;
        const now = new Date().toISOString();
        
        // 1. Update status of requester follow to 'accepted'
        await db.run("UPDATE social_follows SET status = 'accepted' WHERE id = ?", [requestId]);
        
        // 2. Ensure current user (B) also follows requester (A) as 'accepted'
        const existingFollowBack = await db.get('SELECT id FROM social_follows WHERE followerId = ? AND followingId = ?', [userId, requesterId]);
        if (!existingFollowBack) {
            await db.run("INSERT INTO social_follows (id, followerId, followingId, status, createdAt) VALUES (?, ?, ?, 'accepted', ?)",
                [uuidv4(), userId, requesterId, now]);
        } else {
            await db.run("UPDATE social_follows SET status = 'accepted' WHERE followerId = ? AND followingId = ?", [userId, requesterId]);
        }
        
        // 3. Automatically create a private conversation if it doesn't exist
        const existingConv = await db.get(`
            SELECT c.id FROM social_conversations c
            JOIN social_conversation_members m1 ON c.id = m1.conversationId AND m1.userId = ?
            JOIN social_conversation_members m2 ON c.id = m2.conversationId AND m2.userId = ?
            WHERE c.isGroup = 0
        `, [userId, requesterId]);
        
        let conversationId;
        if (existingConv) {
            conversationId = existingConv.id;
        } else {
            conversationId = uuidv4();
            await db.run(`
                INSERT INTO social_conversations (id, name, avatar, isGroup, createdById, createdAt)
                VALUES (?, NULL, NULL, 0, ?, ?)
            `, [conversationId, userId, now]);
            
            await db.run(`
                INSERT INTO social_conversation_members (id, conversationId, userId, joinedAt)
                VALUES (?, ?, ?, ?)
            `, [uuidv4(), conversationId, userId, now]);
            
            await db.run(`
                INSERT INTO social_conversation_members (id, conversationId, userId, joinedAt)
                VALUES (?, ?, ?, ?)
            `, [uuidv4(), conversationId, requesterId, now]);
        }
        
        // 4. Emit socket updates
        io.to(`user_${userId}`).emit('new_conversation', { conversationId, isGroup: false });
        io.to(`user_${requesterId}`).emit('new_conversation', { conversationId, isGroup: false });
        io.to(`user_${userId}`).emit('follow_request_accepted', { requesterId });
        io.to(`user_${requesterId}`).emit('follow_request_accepted', { requesterId: userId });
        
        res.json({ success: true, conversationId });
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء قبول الطلب' });
    }
});

// Reject a follow request
app.post('/api/social/requests/reject', async (req, res) => {
    try {
        const { requestId, userId } = req.body;
        if (!requestId || !userId) {
            return res.status(400).json({ error: 'البيانات ناقصة' });
        }
        
        await db.run('DELETE FROM social_follows WHERE id = ? AND followingId = ?', [requestId, userId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء رفض الطلب' });
    }
});

// Delete message with conditional timing
app.post('/api/social/messages/:id/delete', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'معرف المستخدم مطلوب' });
        
        const message = await db.get('SELECT * FROM social_messages WHERE id = ?', [id]);
        if (!message) return res.status(404).json({ error: 'الرسالة غير موجودة' });
        
        if (message.senderId !== userId) {
            return res.status(403).json({ error: 'غير مصرح لك بحذف هذه الرسالة' });
        }
        
        // Get conversation details
        const conv = await db.get('SELECT isGroup FROM social_conversations WHERE id = ?', [message.conversationId]);
        if (!conv) return res.status(404).json({ error: 'المحادثة غير موجودة' });
        
        // Check who has seen it (other than sender)
        const seenByOthers = await db.get('SELECT count(*) as count FROM social_message_seen WHERE messageId = ? AND userId != ?', [id, userId]);
        const hasBeenSeen = seenByOthers && seenByOthers.count > 0;
        
        const elapsedMs = Date.now() - new Date(message.createdAt).getTime();
        const elapsedMinutes = elapsedMs / (1000 * 60);
        
        let allowed = false;
        
        if (conv.isGroup === 0) {
            // 1-on-1 private chat
            if (hasBeenSeen) {
                allowed = elapsedMinutes <= 3;
            } else {
                allowed = elapsedMinutes <= 15;
            }
        } else {
            // Group chat
            if (hasBeenSeen) {
                allowed = elapsedMinutes <= 5;
            } else {
                allowed = elapsedMinutes <= 20;
            }
        }
        
        if (!allowed) {
            const errMsg = conv.isGroup === 0
                ? (hasBeenSeen 
                    ? 'انتهى وقت الحذف! (3 دقائق للرسائل المرئية)' 
                    : 'انتهى وقت الحذف! (15 دقيقة للرسائل غير المرئية)')
                : (hasBeenSeen 
                    ? 'انتهى وقت الحذف! (5 دقائق للمجموعات عند رؤيتها)' 
                    : 'انتهى وقت الحذف! (20 دقيقة للمجموعات غير المرئية)');
            return res.status(400).json({ error: errMsg });
        }
        
        // Soft delete: update content and messageType
        await db.run("UPDATE social_messages SET messageType = 'deleted', content = 'تم حذف هذه الرسالة', mediaId = NULL, mediaType = NULL WHERE id = ?", [id]);
        
        // Emit socket deletion update
        io.to(`chat_${message.conversationId}`).emit('message_deleted', { messageId: id });
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء حذف الرسالة' });
    }
});

// Unfollow a user
app.post('/api/social/unfollow', async (req, res) => {
    try {
        const { followerId, followingId } = req.body;
        if (!followerId || !followingId) {
            return res.status(400).json({ error: 'البيانات ناقصة' });
        }
        
        await db.run('DELETE FROM social_follows WHERE followerId = ? AND followingId = ?', [followerId, followingId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء إلغاء المتابعة' });
    }
});

// Get mutual follow friends
app.get('/api/social/friends', async (req, res) => {
    try {
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ error: 'معرف المستخدم مطلوب' });
        
        const friends = await db.all(`
            SELECT u.id, u.username, u.name, u.avatar 
            FROM users u
            JOIN social_follows f1 ON u.id = f1.followingId AND f1.followerId = ? AND f1.status = 'accepted'
            JOIN social_follows f2 ON u.id = f2.followerId AND f2.followingId = ? AND f2.status = 'accepted'
            WHERE u.id != ?
        `, [userId, userId, userId]);
        
        res.json(friends);
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ في جلب الأصدقاء' });
    }
});

// Get conversations
app.get('/api/social/conversations', async (req, res) => {
    try {
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ error: 'معرف المستخدم مطلوب' });
        
        const convs = await db.all(`
            SELECT c.*, u.username as creatorUsername, u.name as creatorName
            FROM social_conversations c
            JOIN social_conversation_members m ON c.id = m.conversationId
            LEFT JOIN users u ON c.createdById = u.id
            WHERE m.userId = ?
            ORDER BY c.createdAt DESC
        `, [userId]);
        
        for (let i = 0; i < convs.length; i++) {
            const c = convs[i];
            const members = await db.all(`
                SELECT u.id, u.username, u.name, u.avatar
                FROM users u
                JOIN social_conversation_members m ON u.id = m.userId
                WHERE m.conversationId = ?
            `, [c.id]);
            
            c.members = members;
            
            if (c.isGroup === 0) {
                const other = members.find(m => m.id !== userId);
                if (other) {
                    c.name = other.name || other.username;
                    c.avatar = other.avatar;
                } else {
                    c.name = 'مستخدم غير معروف';
                    c.avatar = '/uploads/users/default.png';
                }
            }
            
            c.lastMessage = await db.get(`
                SELECT * FROM social_messages 
                WHERE conversationId = ? 
                ORDER BY createdAt DESC LIMIT 1
            `, [c.id]);
            
            const lastSeen = await db.get(`
                SELECT messageId FROM social_message_seen
                WHERE userId = ? AND messageId IN (SELECT id FROM social_messages WHERE conversationId = ?)
            `, [userId, c.id]);
            
            let unreadQuery = `SELECT count(*) as count FROM social_messages WHERE conversationId = ?`;
            let params = [c.id];
            if (lastSeen) {
                unreadQuery += ` AND createdAt > (SELECT createdAt FROM social_messages WHERE id = ?)`;
                params.push(lastSeen.messageId);
            }
            
            const unreadRes = await db.get(unreadQuery, params);
            c.unreadCount = unreadRes ? unreadRes.count : 0;
        }
        
        res.json(convs);
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ في جلب المحادثات' });
    }
});

// Create conversation
app.post('/api/social/conversations', async (req, res) => {
    try {
        const { isGroup, name, avatar, members, createdById } = req.body;
        if (!createdById || !members || !Array.isArray(members)) {
            return res.status(400).json({ error: 'البيانات المطلوبة ناقصة' });
        }
        
        if (!members.includes(createdById)) {
            members.push(createdById);
        }
        
        if (isGroup) {
            if (members.length < 3) {
                return res.status(400).json({ error: 'يجب أن تضم المجموعة 3 أعضاء على الأقل' });
            }
            if (!name) {
                return res.status(400).json({ error: 'اسم المجموعة مطلوب' });
            }
        } else {
            if (members.length !== 2) {
                return res.status(400).json({ error: 'محادثة خاصة تتطلب عضوين فقط' });
            }
            
            const user1 = members[0];
            const user2 = members[1];
            const f1 = await db.get('SELECT id FROM social_follows WHERE followerId = ? AND followingId = ?', [user1, user2]);
            const f2 = await db.get('SELECT id FROM social_follows WHERE followerId = ? AND followingId = ?', [user2, user1]);
            if (!f1 || !f2) {
                return res.status(403).json({ error: 'يجب أن تكون المتابعة متبادلة للدردشة الثنائية' });
            }
            
            const existing = await db.get(`
                SELECT c.id FROM social_conversations c
                JOIN social_conversation_members m1 ON c.id = m1.conversationId AND m1.userId = ?
                JOIN social_conversation_members m2 ON c.id = m2.conversationId AND m2.userId = ?
                WHERE c.isGroup = 0
            `, [user1, user2]);
            
            if (existing) {
                return res.json({ success: true, conversationId: existing.id, isExisting: true });
            }
        }
        
        const conversationId = uuidv4();
        const now = new Date().toISOString();
        
        await db.run(`
            INSERT INTO social_conversations (id, name, avatar, isGroup, createdById, createdAt)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [conversationId, name || null, avatar || null, isGroup ? 1 : 0, createdById, now]);
        
        for (const mId of members) {
            const memberRecordId = uuidv4();
            await db.run(`
                INSERT INTO social_conversation_members (id, conversationId, userId, joinedAt)
                VALUES (?, ?, ?, ?)
            `, [memberRecordId, conversationId, mId, now]);
        }
        
        members.forEach(mId => {
            io.to(`user_${mId}`).emit('new_conversation', { conversationId, isGroup });
        });
        
        res.json({ success: true, conversationId });
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ في إنشاء المحادثة' });
    }
});

// Get messages for a conversation
app.get('/api/social/conversations/:id/messages', async (req, res) => {
    try {
        const { id } = req.params;
        const messages = await db.all(`
            SELECT m.*, u.username as senderUsername, u.name as senderName, u.avatar as senderAvatar,
                   r.content as replyContent, r.senderId as replySenderId, ru.name as replySenderName
            FROM social_messages m
            LEFT JOIN users u ON m.senderId = u.id
            LEFT JOIN social_messages r ON m.replyToId = r.id
            LEFT JOIN users ru ON r.senderId = ru.id
            WHERE m.conversationId = ?
            ORDER BY m.createdAt ASC
        `, [id]);
        
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            
            // Reactions
            const reactions = await db.all(`
                SELECT r.userId, r.emoji, u.name as userName, u.username
                FROM social_message_reactions r
                JOIN users u ON r.userId = u.id
                WHERE r.messageId = ?
            `, [msg.id]);
            msg.reactions = reactions;
            
            // Seen by
            const seenList = await db.all(`
                SELECT s.userId, u.name as userName, u.username
                FROM social_message_seen s
                JOIN users u ON s.userId = u.id
                WHERE s.messageId = ?
            `, [msg.id]);
            msg.seenBy = seenList;
        }
        
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ في جلب الرسائل' });
    }
});

// Send a message
app.post('/api/social/conversations/:id/messages', async (req, res) => {
    try {
        const { id } = req.params;
        const { senderId, messageType, content, mediaId, mediaType, replyToId } = req.body;
        
        if (!senderId || (!content && !mediaId)) {
            return res.status(400).json({ error: 'محتوى الرسالة مطلوب' });
        }
        
        const messageId = uuidv4();
        const now = new Date().toISOString();
        
        await db.run(`
            INSERT INTO social_messages (id, conversationId, senderId, messageType, content, mediaId, mediaType, replyToId, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [messageId, id, senderId, messageType || 'text', content || null, mediaId || null, mediaType || null, replyToId || null, now]);
        
        const fullMessage = await db.get(`
            SELECT m.*, u.username as senderUsername, u.name as senderName, u.avatar as senderAvatar,
                   r.content as replyContent, r.senderId as replySenderId, ru.name as replySenderName
            FROM social_messages m
            LEFT JOIN users u ON m.senderId = u.id
            LEFT JOIN social_messages r ON m.replyToId = r.id
            LEFT JOIN users ru ON r.senderId = ru.id
            WHERE m.id = ?
        `, [messageId]);
        
        fullMessage.reactions = [];
        fullMessage.seenBy = [];
        
        // Mark as seen by sender
        const seenId = uuidv4();
        await db.run('INSERT INTO social_message_seen (id, messageId, userId, seenAt) VALUES (?, ?, ?, ?)',
            [seenId, messageId, senderId, now]);
            
        fullMessage.seenBy.push({ userId: senderId, userName: fullMessage.senderName || fullMessage.senderUsername });
        
        io.to(`chat_${id}`).emit('new_message', fullMessage);
        
        const members = await db.all('SELECT userId FROM social_conversation_members WHERE conversationId = ?', [id]);
        members.forEach(m => {
            if (m.userId !== senderId) {
                io.to(`user_${m.userId}`).emit('message_notification', { conversationId: id, message: fullMessage });
            }
        });
        
        res.json({ success: true, message: fullMessage });
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ في إرسال الرسالة' });
    }
});

// React to message
app.post('/api/social/messages/:id/react', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId, emoji } = req.body;
        if (!userId) return res.status(400).json({ error: 'معرف المستخدم مطلوب' });
        
        const now = new Date().toISOString();
        const existing = await db.get('SELECT id FROM social_message_reactions WHERE messageId = ? AND userId = ?', [id, userId]);
        
        if (emoji === null || emoji === '') {
            await db.run('DELETE FROM social_message_reactions WHERE messageId = ? AND userId = ?', [id, userId]);
        } else {
            if (existing) {
                await db.run('UPDATE social_message_reactions SET emoji = ?, createdAt = ? WHERE messageId = ? AND userId = ?',
                    [emoji, now, id, userId]);
            } else {
                const reactionId = uuidv4();
                await db.run('INSERT INTO social_message_reactions (id, messageId, userId, emoji, createdAt) VALUES (?, ?, ?, ?, ?)',
                    [reactionId, id, userId, emoji, now]);
            }
        }
        
        const msgObj = await db.get('SELECT conversationId FROM social_messages WHERE id = ?', [id]);
        if (msgObj) {
            const reactions = await db.all(`
                SELECT r.userId, r.emoji, u.name as userName, u.username
                FROM social_message_reactions r
                JOIN users u ON r.userId = u.id
                WHERE r.messageId = ?
            `, [id]);
            
            io.to(`chat_${msgObj.conversationId}`).emit('message_reaction_updated', { messageId: id, reactions });
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ في التفاعل' });
    }
});

// Mark as seen
app.post('/api/social/messages/:id/seen', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'معرف المستخدم مطلوب' });
        
        const existing = await db.get('SELECT id FROM social_message_seen WHERE messageId = ? AND userId = ?', [id, userId]);
        if (!existing) {
            const seenId = uuidv4();
            await db.run('INSERT INTO social_message_seen (id, messageId, userId, seenAt) VALUES (?, ?, ?, ?)',
                [seenId, id, userId, new Date().toISOString()]);
        }
        
        const msgObj = await db.get('SELECT conversationId FROM social_messages WHERE id = ?', [id]);
        if (msgObj) {
            const seenBy = await db.all(`
                SELECT s.userId, u.name as userName, u.username
                FROM social_message_seen s
                JOIN users u ON s.userId = u.id
                WHERE s.messageId = ?
            `, [id]);
            
            io.to(`chat_${msgObj.conversationId}`).emit('message_seen_updated', { messageId: id, seenBy });
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ في التحديث' });
    }
});

// Chat upload image
app.post('/api/social/upload', upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
        }
        const filePath = `/uploads/others/${req.file.filename}`;
        res.json({ success: true, filePath });
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء رفع الصورة' });
    }
});

// Socket.io Social Handlers
io.on('connection', (socket) => {
    socket.on('join_user', (userId) => {
        socket.join(`user_${userId}`);
    });
    
    socket.on('join_conversation', (conversationId) => {
        socket.join(`chat_${conversationId}`);
    });
    
    socket.on('typing', ({ conversationId, userId, username, isTyping }) => {
        socket.to(`chat_${conversationId}`).emit('user_typing', { conversationId, userId, username, isTyping });
    });
});




app.use((req, res, next) => {
    const excludedPrefixes = ['/api', '/uploads', '/videojs', '/fontawesome', '/css', '/admin', '/srt', '/404'];
    if (req.method !== 'GET' || excludedPrefixes.some(p => req.path.startsWith(p)) || req.path.includes('.')) {
        return next();
    }
    res.sendFile(path.join(__dirname, 'index.html'));
});


app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, '404.html'));
});
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Server side error', message: err.message });


});

(async () => {
    try {
        const adminCheck = await db.get('SELECT * FROM admins WHERE username = ?', ['admin']);
        if (!adminCheck) {
            await db.run(`INSERT INTO admins (id, username, password, name, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
                ['admin_1', 'admin', 'admin123', 'Admin', 'super_admin', new Date().toISOString()]);
            console.log('Admin: admin / admin123');
        }

        const groupsCheck = await db.get('SELECT * FROM age_groups LIMIT 1');
        if (!groupsCheck) {
            await db.run(`INSERT INTO age_groups (id, name, min_age, max_age, blocked_genres, blocked_titles, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                ['group_1', 'أطفال', 0, 12, '[]', '[]', new Date().toISOString()]);
            await db.run(`INSERT INTO age_groups (id, name, min_age, max_age, blocked_genres, blocked_titles, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                ['group_2', 'مراهقين', 13, 17, '[]', '[]', new Date().toISOString()]);
            await db.run(`INSERT INTO age_groups (id, name, min_age, max_age, blocked_genres, blocked_titles, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                ['group_3', 'بالغين', 18, 100, '[]', '[]', new Date().toISOString()]);
            console.log('Default age groups created successfully');
        }
    } catch (error) {
        console.error('error add minf data', error);
    }
})();

process.on('unhandledRejection', (reason, promise) => {
    console.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('CRITICAL: Uncaught Exception:', err);
});


app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.includes('.')) {
        return next();
    }
    res.sendFile(path.join(__dirname, 'index.html'));
});


try {
    server.listen(PORT, () => {
        console.log(`[+] Server started`);
        console.log(`[+] Home: http://localhost:${PORT}`);
        console.log(`[+] Admin: http://localhost:${PORT}/admin`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`[X] Port ${PORT} is already in use.`);
        } else {
            console.error('[X] Server error:', err);
        }
    });
} catch (e) {
    console.error('[X] Failed to start server:', e);
}