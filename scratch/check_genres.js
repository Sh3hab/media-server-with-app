const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(process.cwd(), 'data', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.all('SELECT name FROM genres', [], (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        console.log('Genres found:');
        rows.forEach(row => console.log('- ' + row.name));
    }
    db.close();
});
