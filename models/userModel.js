const db = require('../services/database.js').config;
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt')
require('body-parser');

let getUsers = () => new Promise((resolve, reject) => {
    db.query('SELECT * FROM users', function (err, result, fields) {
        if (err) reject(err);
        resolve(result.rows);
    });
});

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

let createUser = (userData, reqFiles) => new Promise(async (resolve, reject) => {
    let pictureName = "";
    if(reqFiles) pictureName = uuidv4() + "." + reqFiles.avatar.name.split('.').pop();

    var hashedPassword = await bcrypt.hash(userData.password, 10);
    userData.password = hashedPassword;
    userData.uuid = uuidv4();
    let sql = "INSERT INTO users (uuid, username, password_hash, user_role) VALUES ($1, $2, $3, $4)";

    let values = [userData.uuid, userData.username, userData.password, userData.role];

    createUserInDatabase(sql, values, reject, resolve, userData);
});

function createUserInDatabase(sql, values, reject, resolve, userData) {
    db.query(sql, values, function (err, result, fields) {
        if (err) {
            console.log(err);
            reject(err)
        } else {
            console.log("1 record inserted");
            resolve(userData.uuid);
        }
    });
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
    getUsers,
    getUserById,
    createUser,
    getUserTableColumns,
    deleteUser,
    getGuildMembers,
    removeGuildIdFromUser,
    setGuildIdFromUser
}
