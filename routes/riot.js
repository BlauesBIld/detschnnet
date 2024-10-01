const express = require('express');
const router = express.Router();
const winston = require('winston');
const fs = require('fs');

const riotController = require('../controllers/riotController.js');

const riotLogger = winston.createLogger({
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({filename: 'logs/riot.log'})
    ]
});

router.get('/league/:summonername', (req, res) => {
    const gameName = req.params.summonername.split('-')[0];
    const tagLine = req.params.summonername.split('-')[1] === undefined ? 'EUW' : req.params.summonername.split('-')[1]
    riotController.getRiotDataByRiotId(gameName, tagLine).then(res => res.json()).then(riotData => {
        riotController.getSummonerDataByPuuid(riotData.puuid).then(res => res.json()).then(summonerData => {
            riotLogger.info('Request for summoner data by name: ' + req.params.summonername);
            riotController.getLeagueDataBySummonerId(summonerData.id).then(res => res.json()).then(leagueData => {
                riotLogger.info('Request for league data by summoner id: ' + summonerData.id + ' (' + summonerData.gameName + '#' + summonerData.tagLine + ')');
                leagueData = leagueData.filter(league => league.queueType === 'RANKED_SOLO_5x5');
                body = {
                    'name': gameName,
                    'rank': leagueData[0].tier + ' ' + leagueData[0].rank,
                    'lp': leagueData[0].leaguePoints + ' LP',
                    'wins': leagueData[0].wins,
                    'losses': leagueData[0].losses,
                    'winrate': Math.round(leagueData[0].wins / (leagueData[0].wins + leagueData[0].losses) * 100) + '%',
                }
                res.status(200).json(body);
            }).catch(err => {
                riotLogger.error('Error while requesting league data by summoner id: ' + summonerData.id + ' (' + summonerData.name + ')' + ' error: ' + err.message);
                console.log(err);
                res.status(500).json(err);
            });
        }).catch(err => {
            riotLogger.error('Error while requesting summoner data by name: ' + riotData.puuid + ' (' + riotData.gameName + '#' + riotData.tagline + ')' + ' error: ' + err.message);
            console.log(err);
            res.status(500).json(err);
        });
    }).catch(err => {
        riotLogger.error('Error while requesting riot data by name: ' + req.params.summonername + ' error: ' + err.message);
        console.log(err);
        res.status(500).json(err);
    });
});

module.exports = router


