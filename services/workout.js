const workoutModel = require('../models/workoutModel');

async function getAllUsers() {
    return workoutModel.getAllUsers();
}

async function getUserById(userId) {
    return workoutModel.getUserById(userId);
}

async function getTodayRoundsForUser(userId) {
    const count = await workoutModel.getTodayRoundsForUser(userId);
    return Number(count);
}

async function createTrainingSession(userId) {
    return workoutModel.createTrainingSession(userId);
}

async function getTodayTrainingSession(userId) {
    return workoutModel.getTodayTrainingSession(userId);
}

async function getOrCreateTodayTrainingSession(userId) {
    const existingSession = await workoutModel.getTodayTrainingSession(userId);

    console.log(existingSession);

    if (existingSession) {
        return existingSession.id;
    }

    return workoutModel.createTrainingSession(userId);
}

async function getRoundCountForSession(sessionId) {
    const count = await workoutModel.getRoundCountForSession(sessionId);
    return Number(count);
}

async function completeNextRound(sessionId) {
    const session = await workoutModel.getTrainingSessionById(sessionId);

    if (!session) {
        throw new Error(`Training session ${sessionId} not found`);
    }

    const previousRound = await workoutModel.getLastCompletedRound(sessionId);

    const nextRoundNumber = previousRound
        ? previousRound.round_number + 1
        : 1;

    const durationSeconds = previousRound
        ? getSecondsBetween(previousRound.completed_at)
        : getSecondsBetween(session.started_at);

    await workoutModel.insertCompletedRound(
        sessionId,
        nextRoundNumber,
        durationSeconds
    );
}

function getSecondsBetween(fromDate, toDate = new Date()) {
    return Math.max(0, Math.floor((toDate.getTime() - new Date(fromDate).getTime()) / 1000));
}

async function getCurrentWeekOverview() {
    const rows = await workoutModel.getCurrentWeekOverviewRows();

    const groupedByDay = new Map();

    for (const row of rows) {
        const dayKey = row.day;

        if (!groupedByDay.has(dayKey)) {
            groupedByDay.set(dayKey, {
                date: dayKey,
                users: []
            });
        }

        groupedByDay.get(dayKey).users.push({
            id: row.user_id,
            name: row.user_name,
            rounds: row.rounds
        });

        console.log(groupedByDay.get(dayKey));
    }

    return Array.from(groupedByDay.values());
}

module.exports = {
    getAllUsers,
    getUserById,
    getTodayRoundsForUser,
    createTrainingSession,
    getTodayTrainingSession,
    getOrCreateTodayTrainingSession,
    getRoundCountForSession,
    completeNextRound,
    getCurrentWeekOverview
};