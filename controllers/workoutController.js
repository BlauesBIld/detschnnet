const workoutService = require('../services/workout');
const {
    getTodayWorkout,
    getTargetRoundsForDate,
    getProgressState
} = require('../utils/workoutPlanHelper');


async function getDashboard(req, res, next) {
    try {
        const userId = req.session.userId;

        if (!userId) {
            return res.redirect('/workout/select-user');
        }

        const [todayRounds, users, weeklyOverview, selectedUser] = await Promise.all([
            workoutService.getTodayRoundsForUser(userId),
            workoutService.getAllUsers(),
            workoutService.getCurrentWeekOverview(),
            workoutService.getUserById(userId)
        ]);

        const todayWorkout = getTodayWorkout(selectedUser?.workout_start_date);
        const todayTargetRounds = todayWorkout.rounds;
        const todayProgressState = getProgressState(todayRounds, todayTargetRounds);

        const enrichedWeeklyOverview = weeklyOverview.map(day => {
            const dayDate = new Date(`${day.date}T12:00:00`);

            return {
                ...day,
                users: day.users.map(user => {
                    const fullUser = users.find(x => x.id === user.id);
                    const targetRounds = getTargetRoundsForDate(dayDate, fullUser?.workout_start_date);
                    const isRestDay = targetRounds <= 0;

                    return {
                        ...user,
                        targetRounds,
                        isRestDay,
                        progressState: getProgressState(user.rounds, targetRounds)
                    };
                })
            };
        });

        res.render('workout/dashboard', {
            todayRounds,
            todayWorkout,
            todayTargetRounds,
            todayProgressState,
            users,
            selectedUserId: userId,
            weeklyOverview: enrichedWeeklyOverview
        });
    } catch (error) {
        next(error);
    }
}

async function getSelectUser(req, res, next) {
    try {
        const users = await workoutService.getAllUsers();

        res.render('workout/select-user', {
            users
        });
    } catch (error) {
        next(error);
    }
}

function postSelectUser(req, res) {
    const {userId} = req.body;

    req.session.userId = Number(userId);
    req.session.trainingSessionId = null;

    res.redirect('/workout');
}

async function getTrain(req, res, next) {
    try {
        const userId = req.session.userId;

        if (!userId) {
            return res.redirect('/workout/select-user');
        }

        const sessionId = await workoutService.getOrCreateTodayTrainingSession(userId);
        req.session.trainingSessionId = sessionId;

        const [roundCount, todayRounds, users, selectedUser] = await Promise.all([
            workoutService.getRoundCountForSession(sessionId),
            workoutService.getTodayRoundsForUser(userId),
            workoutService.getAllUsers(),
            workoutService.getUserById(userId)
        ]);

        const todayWorkout = getTodayWorkout(selectedUser?.workout_start_date);
        const todayTargetRounds = todayWorkout.rounds;

        const todayProgressState = getProgressState(todayRounds, todayTargetRounds);
        const sessionProgressState = getProgressState(roundCount, todayTargetRounds);

        res.render('workout/train', {
            roundCount,
            todayRounds,
            todayWorkout,
            todayTargetRounds,
            todayProgressState,
            sessionProgressState,
            users,
            selectedUserId: userId
        });
    } catch (error) {
        next(error);
    }
}

async function postDoneRound(req, res, next) {
    try {
        const sessionId = req.session.trainingSessionId;

        if (!sessionId) {
            return res.redirect('/workout');
        }

        await workoutService.completeNextRound(sessionId);

        res.redirect('/workout/train');
    } catch (error) {
        next(error);
    }
}

module.exports = {
    getDashboard,
    getSelectUser,
    postSelectUser,
    getTrain,
    postDoneRound
};