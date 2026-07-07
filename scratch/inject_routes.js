const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, '../server.js');
let content = fs.readFileSync(serverFile, 'utf8');

const newRoutes = `
// ==================== USERS & GROUPS API ====================

app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
    try {
        const users = await db.all('SELECT * FROM users');
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/users', authenticateAdmin, async (req, res) => {
    try {
        const { username, password, name, age, avatar, groupId, custom_restrictions } = req.body;
        const id = 'user_' + Date.now();
        const createdAt = new Date().toISOString();
        await db.run(\`INSERT INTO users (id, username, password, name, age, avatar, groupId, custom_restrictions, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)\`,
            [id, username, password, name, age, avatar, groupId, custom_restrictions, createdAt]);
        res.json({ success: true, id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/admin/users/:id', authenticateAdmin, async (req, res) => {
    try {
        const { username, password, name, age, avatar, groupId, custom_restrictions } = req.body;
        await db.run(\`UPDATE users SET username=?, password=?, name=?, age=?, avatar=?, groupId=?, custom_restrictions=? WHERE id=?\`,
            [username, password, name, age, avatar, groupId, custom_restrictions, req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/users/:id', authenticateAdmin, async (req, res) => {
    try {
        await db.run('DELETE FROM users WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/users/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await db.get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);
        if (user) {
            // Update last active
            await db.run('UPDATE users SET lastActive = ? WHERE id = ?', [new Date().toISOString(), user.id]);
            res.json({ success: true, user });
        } else {
            res.status(401).json({ error: 'Username or password incorrect' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/groups', authenticateAdmin, async (req, res) => {
    try {
        const groups = await db.all('SELECT * FROM age_groups');
        res.json(groups);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/groups', authenticateAdmin, async (req, res) => {
    try {
        const { name, min_age, max_age, blocked_genres, blocked_titles } = req.body;
        const id = 'group_' + Date.now();
        const createdAt = new Date().toISOString();
        await db.run(\`INSERT INTO age_groups (id, name, min_age, max_age, blocked_genres, blocked_titles, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)\`,
            [id, name, min_age, max_age, blocked_genres, blocked_titles, createdAt]);
        res.json({ success: true, id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/admin/groups/:id', authenticateAdmin, async (req, res) => {
    try {
        const { name, min_age, max_age, blocked_genres, blocked_titles } = req.body;
        await db.run(\`UPDATE age_groups SET name=?, min_age=?, max_age=?, blocked_genres=?, blocked_titles=? WHERE id=?\`,
            [name, min_age, max_age, blocked_genres, blocked_titles, req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/groups/:id', authenticateAdmin, async (req, res) => {
    try {
        await db.run('DELETE FROM age_groups WHERE id=?', [req.params.id]);
        await db.run('UPDATE users SET groupId = NULL WHERE groupId=?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/history/:userId', async (req, res) => {
    try {
        const history = await db.all('SELECT * FROM watch_history WHERE userId = ? ORDER BY watchedAt DESC', [req.params.userId]);
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/history', async (req, res) => {
    try {
        const { userId, contentId, contentType, progress } = req.body;
        if (!userId || !contentId) return res.status(400).json({error: 'userId and contentId required'});
        const id = 'hist_' + Date.now();
        const watchedAt = new Date().toISOString();
        await db.run(\`INSERT INTO watch_history (id, userId, contentId, contentType, watchedAt, progress) VALUES (?, ?, ?, ?, ?, ?)\`,
            [id, userId, contentId, contentType, watchedAt, progress || 0]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Helper for Content Filtering
async function filterContentForUser(contentArray, userId) {
    if (!userId) return contentArray;
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return contentArray;

    let blockedGenres = [];
    let blockedTitles = [];
    
    // Custom restrictions
    try {
        const custom = JSON.parse(user.custom_restrictions || '{"titles":[],"genres":[]}');
        blockedGenres.push(...(custom.genres || []));
        blockedTitles.push(...(custom.titles || []));
    } catch(e){}

    // Group restrictions
    if (user.groupId) {
        const group = await db.get('SELECT * FROM age_groups WHERE id = ?', [user.groupId]);
        if (group) {
            try {
                blockedGenres.push(...JSON.parse(group.blocked_genres || '[]'));
                blockedTitles.push(...JSON.parse(group.blocked_titles || '[]'));
            } catch(e){}
        }
    }

    return contentArray.filter(item => {
        // Filter by title
        if (blockedTitles.includes(item.title)) return false;
        
        // Filter by genre
        let itemGenres = [];
        try { itemGenres = typeof item.genres === 'string' ? JSON.parse(item.genres) : item.genres; } catch(e){}
        if (itemGenres && itemGenres.some(g => blockedGenres.includes(g))) return false;

        // Filter by Age
        // Try mapping TMDB age ratings to minimum age required
        const ratingMap = { 'G': 0, 'PG': 8, 'PG-13': 13, 'R': 17, 'NC-17': 18, 'TV-Y': 0, 'TV-Y7': 7, 'TV-G': 0, 'TV-PG': 8, 'TV-14': 14, 'TV-MA': 18 };
        const reqAge = ratingMap[item.ageRating] || 0;
        if (user.age < reqAge) return false;

        return true;
    });
}
`;

if (content.includes('// ==================== USERS & GROUPS API ====================')) {
    console.log('Routes already injected.');
} else {
    const insertPoint = content.lastIndexOf('// 404 & Error Handlers');
    if (insertPoint !== -1) {
        content = content.substring(0, insertPoint) + newRoutes + '\n' + content.substring(insertPoint);
        fs.writeFileSync(serverFile, content);
        console.log('Successfully injected routes!');
    } else {
        console.log('Could not find insert point.');
    }
}
