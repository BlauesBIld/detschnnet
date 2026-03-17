const express = require('express');
const router = express.Router();
const workoutController = require('../controllers/workoutController');

router.get('/', workoutController.getDashboard);
router.get('/select-user', workoutController.getSelectUser);
router.post('/select-user', workoutController.postSelectUser);
router.get('/train', workoutController.getTrain);
router.post('/done-round', workoutController.postDoneRound);

module.exports = router;