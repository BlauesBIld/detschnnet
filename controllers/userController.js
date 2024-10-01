const userModel = require('../models/userModel');
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");

function getUsers(req, res, next) {
    const loggedInUser = jwt.verify(req.cookies['accessToken'], process.env.ACCESS_TOKEN_SECRET);

    userModel.getUsers()
        .then((users) => {
            userModel.getUserById(loggedInUser.id)
                .then((loggedInUser) => {
                    res.render('users', {users: users, loggedInUser: req.user});
                });
        }).catch((err) => {
        res.status(404);
        next(err);
    });
}

function getUserById(req, res, next) {
    const id = req.params.id;

    userModel.getUserById(parseInt(id)).then((user) => {
        if (user.avatarPath === undefined || user.avatarPath === '' || !fs.existsSync('public/avatars/' + user.avatarPath)) {
            user.avatarPath = 'default.png';
        }

        if (user.guild_id === null) {
            res.render('user', {user, loggedInUser: req.user});
        } else {
            guildModel.getGuildById(parseInt(user.guild_id)).then((guild) => {
                res.render('user', {user, loggedInUser: req.user, guild});
            });
        }
    }).catch((err) => {
        res.status(404);
        next(err);
    });
}

function editUser(req, res, next) {
    const loggedInUser = jwt.verify(req.cookies['accessToken'], process.env.ACCESS_TOKEN_SECRET);

    if (parseInt(req.params.id) !== loggedInUser.id && loggedInUser.role !== 'admin') {
        throw new Error('You are not allowed to access this page!');
    }
    userModel.getUserById(parseInt(req.params.id))
        .then((user) => {
            if (user.avatarPath === undefined || user.avatarPath === '' || !fs.existsSync('public/avatars/' + user.avatarPath)) {
                user.avatarPath = 'default.png';
            }
            res.render('editUser', {user});
        })
        .catch((err) => {
            res.status(500);
            next(err);
        });
}

function updateUser(req, res, next) {
    userModel.updateUser(req.body, req.files)
        .then((user) => {
            guildModel.getGuildById(parseInt(user.guild_id)).then((guild) => {
                res.render('user', {user, loggedInUser: req.user, guild});
            });
        })
        .catch((err) => {
            res.status(500);
            next(err);
        });
}

function addUser(req, res, next) {
    userModel.getUserTableColumns()
        .then((column) => {
            res.render('addUser', {column})
        })
        .catch((err) => {
            res.status(500);
            next(err);
        });
}

function createUser(req, res, next) {
    userModel.createUser(req.body, req.files)
        .then((userId) => {
            res.status(201).json(userId);
        })
        .catch((err) => {
            res.status(500);
            console.log(err);
        });
}

function deleteUser(req, res, next) {
    userModel.deleteUser(parseInt(req.params.id))
        .then(() => {
            if (req.user.role === 'admin') {
                userModel.getUsers()
                    .then((users) => {
                        res.render('users', {users, loggedInUser: req.user});
                    });
            } else if (parseInt(req.params.id) === req.user.id) {
                res.redirect('/logout');
            }
        })
        .catch((err) => {
            res.status(500);
            next(err);
        });
}

function loginUser(req, res, next) {
    try {
        res.render('login');
    } catch (err) {
        res.status(500);
        next(err);
    }
}

function registerUser(req, res, next) {
    userModel.getUserTableColumns()
        .then(column => res.render('register', {column}))
        .catch((err) => {
            res.status(500);
            next(err);
        });
}

function registeredUser(req, res, next) {
    userModel.createUser(req.body, req.files)
        .then((user) => {
            // res.render('index', {title: 'Express', loggedInUser: user});
            res.redirect('/login');
        })
        .catch((err) => {
            res.status(500);
            next(err);
        });
}

function setGuildForUser(req, res, next) {
    userModel.setGuildIdFromUser(parseInt(req.params.id), parseInt(req.params.guildId)).then(() => {
        userModel.getUserById(parseInt(req.params.id)).then((user) => {
            res.cookie('loggedInUser', user);
            res.redirect('/users/' + req.params.id);
        });
    });
}

module.exports = {
    getUsers,
    getUserById,
    editUser,
    updateUser,
    addUser,
    createUser,
    deleteUser,
    loginUser,
    registerUser,
    registeredUser,
    setGuildForUser
}
