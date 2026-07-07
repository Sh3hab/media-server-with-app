const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Attempt to add columns to users
    const addColumn = (col, def) => {
        db.run(`ALTER TABLE users ADD COLUMN ${col} ${def}`, (err) => {
            if (err) console.log(`Column ${col} might already exist:`, err.message);
            else console.log(`Added column ${col}`);
        });
    };

    addColumn('password', 'TEXT');
    addColumn('name', 'TEXT');
    addColumn('age', 'INTEGER DEFAULT 0');
    addColumn('groupId', 'TEXT');
    addColumn('custom_restrictions', 'TEXT DEFAULT \'{"titles":[],"genres":[]}\'');

    // Make sure tables are created
    const { initDatabase } = require('../database');
    initDatabase().then(() => {
        console.log('Database init run successfully.');
        db.close();
    }).catch(err => {
        console.error(err);
        db.close();
    });
});
