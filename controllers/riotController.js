
const twitchController = require('./twitchController');

const RIOT_API_KEY = process.env.RIOT_API_KEY;

const getSummonerDataByPuuid = (puuid) => fetch('https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/' + encodeURIComponent(puuid) + '?api_key=' + RIOT_API_KEY);
const getRiotDataByRiotId = (summonerName, tagline) => fetch('https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/' + encodeURIComponent(summonerName) + '/' + encodeURIComponent(tagline) + '?api_key=' + RIOT_API_KEY);

const getMatchesByPUUID = (puuid, startTime) => {
    const endTime = Math.floor(new Date().getTime() / 1000);
    const startTimeInSeconds = Math.floor(new Date(startTime).getTime() / 1000);

    return fetch(`https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?startTime=${startTimeInSeconds}&endTime=${endTime}&api_key=${RIOT_API_KEY}`);
};

const getLeagueDataBySummonerPuuid = (puuid) => fetch('https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/' + encodeURIComponent(puuid) + '?api_key=' + RIOT_API_KEY);

async function getGameIdsFromStartTimeBySummonerData(summonerData, startTime) {
    try {
        const puuid = summonerData.puuid;

        const startTimeMs = new Date(startTime).getTime();

        const matchesResponse = await getMatchesByPUUID(puuid, startTimeMs);
        if (!matchesResponse.ok) throw new Error('Failed to fetch matches');
        const matches = await matchesResponse.json();

        return matches;
    } catch (error) {
        console.error('Error fetching games from start time:', error);
        return null;
    }
}

const getMatchDetailsByMatchId = (matchId) => {
    return fetch(`https://europe.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}?api_key=${RIOT_API_KEY}`);
};

async function getMatchResults(summonerData, matchIds) {
    try {
        let matchDetails = [];
        for (const matchId of matchIds) {
            const matchDetailsResponse = await getMatchDetailsByMatchId(matchId);
            if (!matchDetailsResponse.ok) throw new Error('Failed to fetch match details');
            let currentMatchDetail = await matchDetailsResponse.json();
            currentMatchDetail.resultWinLose = getWinLoseResult(currentMatchDetail, summonerData.puuid);
            matchDetails.push(currentMatchDetail);
        }
        return matchDetails;
    } catch (error) {
        console.error('Error fetching match result:', error);
        return null;
    }
}
function getWinLoseResult(matchDetails, participantPuuid) {
    const participant = matchDetails.info.participants.find(p => p.puuid === participantPuuid);

    if (!participant) {
        console.error('Participant not found');
        return null;
    }

    const participantTeamId = participant.teamId;

    const team = matchDetails.info.teams.find(t => t.teamId === participantTeamId);

    if (!team) {
        console.error('Team not found');
        return null;
    }

    const result = team.win? 'Win' : 'Lose';

    return result;
}

module.exports = {
    getRiotDataByRiotId,
    getLeagueDataBySummonerPuuid,
    getGameIdsFromStartTimeBySummonerData,
    getMatchResults,
    getSummonerDataByPuuid
}