require('dotenv').config(); // allows us to use .env file
const {Pool} = require('pg');

const config = new Pool({
    host: "127.0.0.1",
    port: 5432,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

function isProduction() {
    return process.env.ENV === 'prod' || process.env.NODE_ENV === 'production';
}

function logDatabaseError(message, err) {
    const details = {
        code: err.code,
        severity: err.severity,
        message: err.message
    };

    console.error(message, details);
}

config.on('error', (err) => {
    logDatabaseError('Postgres idle connection was closed by the server. The pool will open a new connection on the next query.', err);
});

async function warmupDatabaseConnection() {
    try {
        await config.query('SELECT 1');
        console.log('Database connected!');
    } catch (err) {
        logDatabaseError('Initial database connection failed.', err);

        if (isProduction()) {
            throw err;
        }
    }
}

warmupDatabaseConnection().catch((err) => {
    console.error('Database warmup crashed:', err);
});

module.exports = {config};
