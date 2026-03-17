const workoutPlan = require('../data/workoutPlan');

function getViennaDateParts(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Vienna',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'long'
    });

    const parts = formatter.formatToParts(date);
    const values = {};

    for (const part of parts) {
        if (part.type !== 'literal') {
            values[part.type] = part.value;
        }
    }

    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
        weekday: values.weekday.toLowerCase()
    };
}

function toUtcMidnightFromViennaParts(parts) {
    return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function getWeeksSinceStart(startDate, referenceDate = new Date()) {
    if (!startDate) {
        return 0;
    }

    const referenceParts = getViennaDateParts(referenceDate);
    const startParts = getViennaDateParts(new Date(startDate));

    const referenceUtc = toUtcMidnightFromViennaParts(referenceParts);
    const startUtc = toUtcMidnightFromViennaParts(startParts);

    const daysDiff = Math.floor((referenceUtc - startUtc) / (1000 * 60 * 60 * 24));
    return Math.max(0, Math.floor(daysDiff / 7));
}

function getProgressionLevel(startDate, referenceDate = new Date()) {
    const weeksSinceStart = getWeeksSinceStart(startDate, referenceDate);
    return Math.floor(weeksSinceStart / 2);
}

function applyProgressionToExercise(exercise, progressionLevel) {
    if (!exercise.progression) {
        return exercise;
    }

    const repIncrease = progressionLevel * 2;

    if (exercise.type === 'reps') {
        return {
            ...exercise,
            displayValue: `${exercise.base + repIncrease}`
        };
    }

    if (exercise.type === 'reps-range') {
        return {
            ...exercise,
            displayValue: `${exercise.baseMin + repIncrease}–${exercise.baseMax + repIncrease}`
        };
    }

    if (exercise.type === 'per-side') {
        return {
            ...exercise,
            displayValue: `${exercise.base + repIncrease} ${exercise.unit}`
        };
    }

    if (exercise.type === 'per-side-seconds') {
        return {
            ...exercise,
            displayValue: `${exercise.base} sec ${exercise.unit}`
        };
    }

    if (exercise.type === 'seconds') {
        return {
            ...exercise,
            displayValue: `${exercise.base} sec`
        };
    }

    return exercise;
}

function getRoundIncrease(progressionLevel) {
    return progressionLevel > 0 && progressionLevel % 2 === 0 ? 1 : 0;
}

function buildWorkoutForDate(date, startDate) {
    const dateParts = getViennaDateParts(date);
    const dayKey = dateParts.weekday;
    const baseWorkout = workoutPlan[dayKey];
    const progressionLevel = getProgressionLevel(startDate, date);

    return {
        dayKey,
        dayLabel: dayKey.charAt(0).toUpperCase() + dayKey.slice(1),
        title: baseWorkout.title,
        difficulty: baseWorkout.difficulty,
        workoutTime: baseWorkout.workoutTime,
        rounds: baseWorkout.rounds + getRoundIncrease(progressionLevel),
        restSeconds: baseWorkout.restSeconds,
        notes: baseWorkout.notes,
        progressionLevel,
        exercises: baseWorkout.exercises.map(exercise => {
            const progressed = applyProgressionToExercise(exercise, progressionLevel);

            if (!progressed.displayValue) {
                if (progressed.type === 'seconds') {
                    progressed.displayValue = `${progressed.base} sec`;
                } else if (progressed.type === 'per-side-seconds') {
                    progressed.displayValue = `${progressed.base} sec ${progressed.unit}`;
                } else if (progressed.type === 'per-side') {
                    progressed.displayValue = `${progressed.base} ${progressed.unit}`;
                } else if (progressed.type === 'reps') {
                    progressed.displayValue = `${progressed.base}`;
                }
            }

            return progressed;
        })
    };
}

function getTodayWorkout(startDate) {
    return buildWorkoutForDate(new Date(), startDate);
}

function getTargetRoundsForDate(date, startDate) {
    return buildWorkoutForDate(date, startDate).rounds;
}

function getPartialThreshold(targetRounds) {
    if (targetRounds <= 0) {
        return 0;
    }

    return Math.max(1, Math.floor(targetRounds * 0.6));
}

function getProgressState(completedRounds, targetRounds) {
    if (targetRounds <= 0) {
        return 'rest';
    }

    if (completedRounds >= targetRounds) {
        return 'full';
    }

    if (completedRounds >= getPartialThreshold(targetRounds)) {
        return 'partial';
    }

    return 'incomplete';
}

module.exports = {
    getTodayWorkout,
    buildWorkoutForDate,
    getTargetRoundsForDate,
    getPartialThreshold,
    getProgressState
};