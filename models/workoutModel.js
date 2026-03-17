const db = require('../services/database.js').config;

async function getAllUsers() {
    const result = await db.query(`
        SELECT id, name, workout_start_date
        FROM workout.users
        ORDER BY name
    `);

    return result.rows;
}

async function getUserById(userId) {
    const result = await db.query(`
        SELECT id, name, workout_start_date
        FROM workout.users
        WHERE id = $1
    `, [userId]);

    return result.rows[0] || null;
}

async function getTodayRoundsForUser(userId) {
    const result = await db.query(`
        SELECT COUNT(*)::int AS count
        FROM workout.completed_rounds cr
                 INNER JOIN workout.training_sessions ts
                            ON ts.id = cr.training_session_id
        WHERE ts.user_id = $1
          AND ts.session_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Vienna')::date
    `, [userId]);

    return result.rows[0]?.count ?? 0;
}

async function createTrainingSession(userId) {
    const result = await db.query(`
        INSERT INTO workout.training_sessions (user_id, session_date)
        VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Vienna')::date)
        RETURNING id
    `, [userId]);

    return result.rows[0].id;
}

async function getTrainingSessionById(sessionId) {
    const result = await db.query(`
        SELECT id,
               user_id,
               session_date::text AS session_date,
               started_at,
               ended_at
        FROM workout.training_sessions
        WHERE id = $1
    `, [sessionId]);

    return result.rows[0] || null;
}

async function getRoundCountForSession(sessionId) {
    const result = await db.query(`
        SELECT COUNT(*)::int AS count
        FROM workout.completed_rounds
        WHERE training_session_id = $1
    `, [sessionId]);

    return result.rows[0]?.count ?? 0;
}

async function getLastCompletedRound(sessionId) {
    const result = await db.query(`
        SELECT id, round_number, completed_at, duration_seconds
        FROM workout.completed_rounds
        WHERE training_session_id = $1
        ORDER BY round_number DESC
        LIMIT 1
    `, [sessionId]);

    return result.rows[0] || null;
}

async function insertCompletedRound(trainingSessionId, roundNumber, durationSeconds) {
    await db.query(`
        INSERT INTO workout.completed_rounds (training_session_id,
                                              round_number,
                                              duration_seconds)
        VALUES ($1, $2, $3)
    `, [trainingSessionId, roundNumber, durationSeconds]);
}

async function getTodayTrainingSession(userId) {
    const result = await db.query(`
        SELECT id,
               user_id,
               session_date::text AS session_date,
               started_at,
               ended_at
        FROM workout.training_sessions
        WHERE user_id = $1
          AND session_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Vienna')::date
          AND ended_at IS NULL
        ORDER BY started_at DESC
        LIMIT 1
    `, [userId]);

    return result.rows[0] || null;
}

async function getCurrentWeekOverviewRows() {
    const result = await db.query(`
        WITH local_today AS (SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Vienna')::date AS today),
             overview_days AS (SELECT generate_series(
                                              (SELECT today FROM local_today) - interval '5 day',
                                              (SELECT today FROM local_today) + interval '1 day',
                                              interval '1 day'
                                      )::date AS day),
             user_day_grid AS (SELECT od.day,
                                      u.id   AS user_id,
                                      u.name AS user_name
                               FROM overview_days od
                                        CROSS JOIN workout.users u),
             round_totals AS (SELECT ts.user_id,
                                     ts.session_date   AS day,
                                     COUNT(cr.id)::int AS rounds
                              FROM workout.training_sessions ts
                                       LEFT JOIN workout.completed_rounds cr
                                                 ON cr.training_session_id = ts.id
                              WHERE ts.session_date >= (SELECT today FROM local_today) - interval '5 day'
                                AND ts.session_date <= (SELECT today FROM local_today)
                              GROUP BY ts.user_id, ts.session_date)
        SELECT udg.day::text               AS day,
               udg.user_id,
               udg.user_name,
               COALESCE(rt.rounds, 0)::int AS rounds
        FROM user_day_grid udg
                 LEFT JOIN round_totals rt
                           ON rt.user_id = udg.user_id
                               AND rt.day = udg.day
        ORDER BY udg.day ASC, udg.user_name ASC
    `);

    return result.rows;
}

module.exports = {
    getAllUsers,
    getUserById,
    getTodayRoundsForUser,
    createTrainingSession,
    getTrainingSessionById,
    getRoundCountForSession,
    getLastCompletedRound,
    insertCompletedRound,
    getTodayTrainingSession,
    getCurrentWeekOverviewRows
};