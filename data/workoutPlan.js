const workoutPlan = {
    monday: {
        title: 'Upper Body',
        difficulty: 'Hard',
        workoutTime: '20–30 minutes',
        rounds: 4,
        restSeconds: 90,
        notes: [],
        exercises: [
            {name: 'Push-ups', type: 'reps', base: 20, progression: true},
            {name: 'Pull-ups (or rows)', type: 'reps-range', baseMin: 8, baseMax: 10, progression: true},
            {name: 'Bench dips', type: 'reps', base: 15, progression: true},
            {name: 'Plank', type: 'seconds', base: 60, progression: false}
        ]
    },
    tuesday: {
        title: 'Legs + Core',
        difficulty: 'Moderate',
        workoutTime: '20–30 minutes',
        rounds: 4,
        restSeconds: 60,
        notes: [],
        exercises: [
            {name: 'Squats', type: 'reps', base: 25, progression: true},
            {name: 'Walking lunges', type: 'per-side', base: 12, progression: true, unit: 'each leg'},
            {name: 'Glute bridges', type: 'reps', base: 20, progression: true},
            {name: 'Leg raises', type: 'reps', base: 15, progression: true},
            {name: 'Plank', type: 'seconds', base: 45, progression: false}
        ]
    },
    wednesday: {
        title: 'Military Endurance Circuit',
        difficulty: 'Hard',
        workoutTime: '20–30 minutes',
        rounds: 5,
        restSeconds: '60–90',
        notes: ['This burns a lot of calories.'],
        exercises: [
            {name: 'Push-ups', type: 'reps', base: 15, progression: true},
            {name: 'Squats', type: 'reps', base: 20, progression: true},
            {name: 'Mountain climbers', type: 'reps', base: 30, progression: true},
            {name: 'Sit-ups', type: 'reps', base: 20, progression: true},
            {name: 'Burpees', type: 'reps', base: 8, progression: true}
        ]
    },
    thursday: {
        title: 'Recovery / Core',
        difficulty: 'Easy',
        workoutTime: '20–30 minutes',
        rounds: 3,
        restSeconds: null,
        notes: ['Then 10–15 minutes walking or stretching.'],
        exercises: [
            {name: 'Plank', type: 'seconds', base: 60, progression: false},
            {name: 'Side plank', type: 'per-side-seconds', base: 30, progression: false, unit: 'each side'},
            {name: 'Bird dogs', type: 'per-side', base: 12, progression: true, unit: 'each side'},
            {name: 'Dead bugs', type: 'reps', base: 15, progression: true}
        ]
    },
    friday: {
        title: 'Full Body',
        difficulty: 'Hard',
        workoutTime: '20–30 minutes',
        rounds: 4,
        restSeconds: 90,
        notes: [],
        exercises: [
            {name: 'Pull-ups', type: 'reps', base: 8, progression: true},
            {name: 'Push-ups', type: 'reps', base: 20, progression: true},
            {name: 'Jump squats', type: 'reps', base: 15, progression: true},
            {name: 'Hanging leg raises', type: 'reps', base: 12, progression: true},
            {name: 'Plank', type: 'seconds', base: 60, progression: false}
        ]
    },
    saturday: {
        title: 'Conditioning',
        difficulty: 'Moderate',
        workoutTime: '20–30 minutes',
        rounds: 4,
        restSeconds: 60,
        notes: [],
        exercises: [
            {name: 'Burpees', type: 'reps', base: 10, progression: true},
            {name: 'Lunges', type: 'per-side', base: 15, progression: true, unit: 'each leg'},
            {name: 'Push-ups', type: 'reps', base: 15, progression: true},
            {name: 'Mountain climbers', type: 'reps', base: 40, progression: true},
            {name: 'Wall sit', type: 'seconds', base: 60, progression: false}
        ]
    },
    sunday: {
        title: 'Rest',
        difficulty: 'Rest',
        workoutTime: null,
        rounds: 0,
        restSeconds: null,
        notes: ['Rest day. Light walking is fine.'],
        exercises: []
    }
};

module.exports = workoutPlan;