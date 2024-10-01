require('dotenv').config(); // allows us to use .env file
const { Pool } = require('pg');
const fs = require('fs');

const config = new Pool({
    host: "127.0.0.1",
    port: 5432,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

config.connect(function(err) {
    //if (err) throw err;
    console.log("Database connected!");
});

module.exports = {config};