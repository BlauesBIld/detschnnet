const db = require('../services/database.js').config;
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt')
require('body-parser');

let accessSchema;
function ensureAccessSchema() {
    if (!accessSchema) {
        // Only the initial column addition disables everyone; later restarts
        // retain the owner's choices. New accounts also start disabled.
        accessSchema = db.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS login_enabled BOOLEAN NOT NULL DEFAULT FALSE;
            UPDATE users SET user_role = 'admin', login_enabled = TRUE WHERE username = 'detschn';
        `).catch(error => {accessSchema = undefined; throw error;});
    }
    return accessSchema;
}

async function getUserByUuid(uuid) {
    await ensureAccessSchema();
    const result = await db.query('SELECT uuid, username, user_role, login_enabled FROM users WHERE uuid = $1', [uuid]);
    return result.rows[0];
}

async function getLoginAccessUsers() {
    await ensureAccessSchema();
    const result = await db.query('SELECT uuid, username, user_role, login_enabled FROM users ORDER BY username');
    return result.rows;
}

async function setLoginEnabled(uuid, enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Login access must be a boolean');
    await ensureAccessSchema();
    const result = await db.query(`UPDATE users SET login_enabled = $1
        WHERE uuid = $2 AND username <> 'detschn' RETURNING uuid`, [enabled, uuid]);
    return result.rowCount > 0;
}

async function getUsers() {
    await ensureAccessSchema();
    const result = await db.query('SELECT * FROM users');
    return result.rows;
}

let getUserById = (id) => new Promise((resolve, reject) => {
    db.query('SELECT * FROM users WHERE id = ?', [id], function (err, result, fields) {
        if (err) {
            reject(err)
        } else {
            resolve(result[0]);
        }
    });
});

function uploadAvatarToServer(reqFiles, pictureName, reject) {
    let filename = './public/avatars/' + pictureName;
    reqFiles.avatar.mv(filename, function (err) {
        if (err) {
            reject(err);
        }
    });
}

async function createUser(userData) {
    if (!['admin', 'streamer'].includes(userData.role)) throw new Error('Unknown user role');
    if (typeof userData.username !== 'string' || !userData.username.trim() || userData.username.trim().toLowerCase() === 'detschn') {
        throw new Error('Choose a username other than the reserved owner account');
    }
    await ensureAccessSchema();
    const hashedPassword = await bcrypt.hash(userData.password, 10);
    const uuid = uuidv4();
    await db.query('INSERT INTO users (uuid, username, password_hash, user_role) VALUES ($1, $2, $3, $4)',
        [uuid, userData.username, hashedPassword, userData.role]);
    return uuid;
}

let getUserTableColumns = () => new Promise((resolve, reject) => {
    db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'", function (err, columns, fields) {
        if (err) reject(err);
        resolve(columns);
    });
});

let deleteUser = (id) => new Promise((resolve, reject) => {
    db.query("DELETE FROM users WHERE id = " + parseInt(id), function (err, result, fields) {
        if (err) reject(err);
        resolve(result);
    });
});


let getGuildMembers = (guildId) => new Promise((resolve, reject) => {
    db.query('SELECT * FROM users WHERE guild_id = ?', [guildId], function (err, result, fields) {
        if (err) reject(err);
        resolve(result);
    });
});

let removeGuildIdFromUser = (userId) => new Promise((resolve, reject) => {
    db.query('UPDATE users SET guild_id = NULL WHERE id = ?', [userId], function (err, result, fields) {
        if (err) reject(err);
        resolve(result);
    });
});

let setGuildIdFromUser = (userId, guildId) => new Promise((resolve, reject) => {
    getUserById(userId).then((user) => {
        user.guild_id = guildId;
        updateUser(user).then((user) => {
            resolve(user);
        });
    });
});


module.exports = {
    getUserByUuid,
    getLoginAccessUsers,
    setLoginEnabled,
    getUsers,
    getUserById,
    createUser,
    getUserTableColumns,
    deleteUser,
    getGuildMembers,
    removeGuildIdFromUser,
    setGuildIdFromUser
}
