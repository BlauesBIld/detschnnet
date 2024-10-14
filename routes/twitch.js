const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const fs = require('fs');
const nightBotController = require('../controllers/nightbotController');
const twitchController = require('../controllers/twitchController');
const userCountersController = require('../controllers/userCountersController');
const generalCountersController = require('../controllers/generalCountersController');
const riotController = require('../controllers/riotController');

const winston = require('winston');
const spotifyController = require("../controllers/spotifyController");
const authenticationService = require("../services/authentication");

const twitchLogger = winston.createLogger({
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({filename: 'logs/twitch.log'})
    ]
});

const hinaWhitelist = ["hinatari_"];


// Notification request headers
const TWITCH_MESSAGE_ID = 'Twitch-Eventsub-Message-Id'.toLowerCase();
const TWITCH_MESSAGE_TIMESTAMP = 'Twitch-Eventsub-Message-Timestamp'.toLowerCase();
const TWITCH_MESSAGE_SIGNATURE = 'Twitch-Eventsub-Message-Signature'.toLowerCase();
const MESSAGE_TYPE = 'Twitch-Eventsub-Message-Type'.toLowerCase();

// Notification message types
const MESSAGE_TYPE_VERIFICATION = 'webhook_callback_verification';
const MESSAGE_TYPE_NOTIFICATION = 'notification';
const MESSAGE_TYPE_REVOCATION = 'revocation';

// Prepend this string to the HMAC that's created from the message
const HMAC_PREFIX = 'sha256=';

let recentlyChattedUsers = {"Silverline": Date.now};

const hinaRegex = new RegExp("^hina\\S{4,}", "i");

/*console.log("Check for hina username 'hina1234': " + hinaRegex.test("hina1234"));
console.log("Check for hina username 'hina2731645123687': " + hinaRegex.test("hina2731645123687"));
console.log("Check for hina username 'hina_ho1cust2': " + hinaRegex.test("hina_ho1cust2"));
console.log("Check for hina username 'hina48939834983443893498': " + hinaRegex.test("hina48939834983443893498"));
console.log("Check for hina username 'Hina48939834983443893498': " + hinaRegex.test("Hina48939834983443893498"));
console.log("Check for hina username 'ina1234': " + hinaRegex.test("ina1234"));
console.log("Check for hina username 'BlauesBild': " + hinaRegex.test("BlauesBild"));
console.log("Check for hina username 'platin_anwalt': " + hinaRegex.test("platin_anwalt"));
console.log("Check for hina username 'eventuallylost': " + hinaRegex.test("eventuallylost"));
console.log("Check for hina username 'Kami': " + hinaRegex.test("Kami"));
console.log("Check for hina username 'weirdo12345': " + hinaRegex.test("weirdo12345"));*/


router.get('/getLoLWinLoseRecordForStream/:streamer/:lolname', (req, res) => {
    twitchController.getStreamUpTime(req.params.streamer).then(body => {
        const responseBody = {
            "win": 0,
            "lose": 0,
            "winrate": "-"
        };
        console.log(JSON.stringify(body));
        console.log("---------------------");
        console.log(JSON.stringify(body.data));
        if (!body && !body.data && !body.data[0]) {
            res.status(200).send(responseBody);
        } else {
            let timeStamp = body.data[0].started_at;
            const gameName = req.params.lolname.split('-')[0];
            const tagLine = req.params.lolname.split('-')[1] === undefined ? 'EUW' : req.params.lolname.split('-')[1]
            riotController.getRiotDataByRiotId(gameName, tagLine).then(res => res.json()).then(riotData => {
                riotController.getSummonerDataByPuuid(riotData.puuid).then(res => res.json()).then(summonerData => {
                    riotController.getGameIdsFromStartTimeBySummonerData(summonerData, timeStamp).then(gameIds => {
                        riotController.getMatchResults(summonerData, gameIds).then(matchDetails => {
                            matchDetails.forEach(match => {
                                if (match.resultWinLose === "Win") {
                                    responseBody.win++;
                                } else {
                                    responseBody.lose++;
                                }
                            });
                            responseBody.winrate = (responseBody.win / (responseBody.win + responseBody.lose) * 100).toFixed(0) + "%";
                            res.status(200).json(responseBody);
                        });
                    });
                });
            });
        }
    });
});

router.get('/saveTwitchConnection', authenticationService.authenticateJWT, (req, res) => {
    if (req.query.error) {
        console.log("ERROR!!!: " + req.query.error);
    } else {
        twitchController.getAndSaveTokensForStreamer(req.user.username, req.query.code).then((body) => {
            twitchLogger.info('New TWITCH access token saved! code: ' + req.query.code + ' access token: ' + body.access_token + ' refresh token: ' + body.refresh_token);
            res.redirect('/streamer');
        }).catch(err => {
            console.log(err);
            res.status(500).json(err);
        });
    }
});

router.get('/saveNightBotConnection', authenticationService.authenticateJWT, (req, res) => {
    if (req.query.error) {
        console.log(req.query.error);
    } else {
        nightBotController.getAndSaveTokensForStreamer(req.user.username, req.query.code).then((body) => {
            twitchLogger.info('New NIGHTBOT access token saved! code: ' + req.query.code + ' access token: ' + body.access_token + ' refresh token: ' + body.refresh_token);
            res.redirect('/streamer');
        }).catch(err => {
            console.log(err);
            res.status(500).json(err);
        });
    }
});

router.get('/getCountersFromUser/:streamer/:username', (req, res) => {
    userCountersController.getCountersForUserByStreamer(req.params.username, req.params.streamer).then(counters => {
        let countersForUser = {};
        countersForUser['username'] = req.params.username;
        for (let key in counters) {
            countersForUser[counters[key].name] = counters[key].value;
        }
        if (counters) {
            res.status(200).send(countersForUser);
        } else {
            res.status(404).send("User not found");
        }
    })
});

router.get('/getCountersForStreamer/:streamer', (req, res) => {
    generalCountersController.getCountersForStreamer(req.params.streamer).then(counters => {
        if (counters) {
            res.status(200).send(counters);
        } else {
            res.status(404).send("No counters found for streamer");
        }
    });
});

router.post('/', (req, res) => {
    let secret = getSecret();
    let message = getHmacMessage(req);
    let hmac = HMAC_PREFIX + getHmac(secret, message);


    if (true === verifyMessage(hmac, req.headers[TWITCH_MESSAGE_SIGNATURE])) {
        console.log("signatures match");

        let notification = JSON.parse(req.rawBody);

        if (MESSAGE_TYPE_NOTIFICATION === req.headers[MESSAGE_TYPE]) {
            if (notification.subscription.type === 'stream.online') {
                twitchLogger.info(`${notification.event.broadcaster_user_name} started streaming`);
                recentlyChattedUsers = {"Silverline": Date.now};
            } else if (notification.subscription.type === 'channel.follow') {
                try {
                    if (hinaRegex.test(notification.event.user_name) && !hinaWhitelist.includes(notification.event.user_name)) {
                        twitchLogger.info(`${notification.event.user_name} followed the channel and is now banned`);
                        twitchController.banUser("chiara", notification.event.user_id).then(res => {
                            if (res.status === 401) {
                                twitchController.refreshUserAccessToken("chiara").then(res => {
                                    twitchController.banUser("chiara", notification.event.user_id).then(res => {
                                        console.log(res.json());
                                    });
                                });
                            }
                            return res.json();
                        }).then(body => {
                            console.log(body);
                        });
                    }
                } catch (e) {
                    console.log(e);
                }
            } else if (notification.subscription.type === 'channel.channel_points_custom_reward_redemption.add') {
                addToUserCounter(notification.event.user_name, 'chiara', 'gurken_spent', notification.event.reward.cost).then(() => {
                    if (notification.event.reward.id === '9a42f970-5cbc-49f7-a10d-a7b32d4f92d7') {
                        if (getRandomInt(500) < 20) {
                            sendGoldenGurkenMessage('chiara', notification);
                        } else {
                            sendGurkenMessage('chiara', notification);
                        }
                        twitchLogger.info(`${notification.event.user_name} redeemed a gurken-reward`);
                    }
                });
            }
            res.sendStatus(204);
        } else if (MESSAGE_TYPE_VERIFICATION === req.headers[MESSAGE_TYPE]) {
            res.status(200).send(notification.challenge);
        } else if (MESSAGE_TYPE_REVOCATION === req.headers[MESSAGE_TYPE]) {
            res.sendStatus(204);

            console.log(`${notification.subscription.type} notifications revoked!`);
            console.log(`reason: ${notification.subscription.status}`);
            console.log(`condition: ${JSON.stringify(notification.subscription.condition, null, 4)}`);
        } else {
            res.sendStatus(204);
            console.log(`Unknown message type: ${req.headers[MESSAGE_TYPE]}`);
        }
    } else {
        console.log('403');    // Signatures didn't match.
        res.sendStatus(403);
    }
})

function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}

function getSecret() {
    return 'dejansSuperCoolSecret';
}

function getHmacMessage(request) {
    return request.headers[TWITCH_MESSAGE_ID] +
        request.headers[TWITCH_MESSAGE_TIMESTAMP] +
        request.rawBody;

}


function getHmac(secret, message) {
    return crypto.createHmac('sha256', secret)
        .update(message)
        .digest('hex');
}

function verifyMessage(hmac, verifySignature) {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(verifySignature));
}

function addRecentlyChattedUser(user) {
    recentlyChattedUsers[user] = Date.now();
    recentlyChattedUsers['Silverline'] = Date.now();
}

function getSpecificAmountOfLastChatters(amount) {
    let users = Object.keys(recentlyChattedUsers).map(key => {
        return [key, recentlyChattedUsers[key]];
    })

    users.sort(function (first, second) {
        return second[1] - first[1];
    });

    return users.slice(0, amount);
}

async function addToGeneralCounter(streamer, counterName, amount = 1) {
    await generalCountersController.addToCounterForStreamer(streamer, counterName, amount);
}

async function addToUserCounter(username, streamer, counterName, amount = 1) {
    const userCounter = await userCountersController.getSingleUserCounterForUserByStreamer(username, streamer, counterName);
    if (!userCounter) {
        await userCountersController.addNewUserCounter(username, streamer, counterName);
    }
    await userCountersController.addAmountToUserCounter(username, streamer, counterName, amount);
}

function getRandomUserFromRecentChatters() {
    let users = getSpecificAmountOfLastChatters(20);

    let randomIndex = getRandomInt(users.length);

    return users[randomIndex][0];
}

async function sendGurkenMessage(streamer, notification) {
    let randomUser = getRandomUserFromRecentChatters();

    if (getRandomInt(100) < 10) {
        randomUser = notification.event.user_name;
    }

    await addToGeneralCounter(streamer, 'gurken');
    await addToUserCounter(notification.event.user_name, streamer, 'gurken_thrown');
    await addToUserCounter(randomUser, streamer, 'gurken_received');

    let message = "";

    let counter = (await generalCountersController.getSingleCounterForStreamer(streamer, 'gurken')).value;

    if (randomUser === notification.event.user_name) {
        message = `@${notification.event.user_name} bewirft sich selbst mit einer Gurke! Es wurden insgesamt ${counter} Gurken verschwendet.`;
    } else {
        message = `@${notification.event.user_name} bewirft @${randomUser} mit einer Gurke! Es wurden insgesamt ${counter} Gurken verschwendet.`;
    }

    await nightBotController.sendMessageInChannel('chiara', message).then(res => {
        if (res.status === 401) {
            nightBotController.refreshAccessToken().then(res => {
                if (res.status === 200) {
                    nightBotController.sendMessageInChannel('chiara', message);
                }
            });
        }
    }).catch(err => {
        console.log(err);
    });
}


async function sendGoldenGurkenMessage(streamer, notification) {
    let randomUser = getRandomUserFromRecentChatters();

    if (getRandomInt(100) < 10) {
        randomUser = notification.event.user_name;
    }

    await addToGeneralCounter(streamer, 'gurken');
    await addToGeneralCounter(streamer, 'goldenGurken');
    await addToUserCounter(notification.event.user_name, streamer, 'golden_gurken_thrown');
    await addToUserCounter(randomUser, streamer, 'golden_gurken_received');

    let message = "";
    let counter = (await generalCountersController.getSingleCounterForStreamer(streamer, 'goldenGurken')).value;

    const selfMesages = [
        `🥒 In einem überraschenden Akt der Selbstbewurfung schnappt sich @${notification.event.user_name} eine glänzende goldene Gurke und wirft sie mutig auf sich selbst! Ein atemberaubender Moment, während die goldene Gurkenzählung auf ${counter} steigt!`,
        `🥒 Mit einem verschmitzten Lächeln beschließt @${notification.event.user_name}, sich selbst mit einer strahlenden goldenen Gurke zu bewerfen! Ein einzigartiger Augenblick, der die Gesamtzahl der goldenen Gurken auf ${counter} hebt!`,
        `🥒 In einer unerwarteten Wendung der Ereignisse wirft sich @${notification.event.user_name} selbstbewusst mit einer leuchtenden goldenen Gurke ab! Ein selbstsicherer Wurf, der die goldenen Gurkenanzahl auf ${counter} erhöht!`,
        `🥒 @${notification.event.user_name} überrascht alle, indem er/sie sich selbst mit einer funkelnden goldenen Gurke bewirft! Ein Akt der Eigeninitiative, der die goldene Gurkenstatistik auf ${counter} anhebt!`,
        `🥒 Ein jubelnder Ausruf hallt wider, als @${notification.event.user_name} sich selbst mit einer strahlenden goldenen Gurke bewirft! Die Menge ist beeindruckt, und die Anzahl der goldenen Gurken steigt auf ${counter}!`,
        `🥒 Mit einem Augenzwinkern entscheidet sich @${notification.event.user_name}, sich selbst mit einer glitzernden goldenen Gurke zu bewerfen! Ein Moment der Einzigartigkeit, während die goldene Gurkenmenge auf ${counter} wächst!`,
        `🥒 Selbstbewurf in Perfektion: @${notification.event.user_name} nutzt eine glänzende goldene Gurke, um sich selbst zu treffen! Die Zuschauer sind erstaunt über den selbstgerichteten Wurf, der die goldene Gurkenanzahl auf ${counter} setzt!`,
        `🥒 Eine ungeahnte Wendung geschieht, als @${notification.event.user_name} beschließt, sich selbst mit einer leuchtenden goldenen Gurke zu bewerfen! Ein wagemutiger Akt, der die Anzahl der goldenen Gurken auf ${counter} erhöht!`,
        `🥒 Im Zeichen des Selbstbewusstseins wirft sich @${notification.event.user_name} zielsicher mit einer funkelnden goldenen Gurke selbst ab! Ein außergewöhnlicher Moment, der die goldene Gurkenstatistik auf ${counter} steigen lässt!`,
        `🥒 Mit einem Schmunzeln holt @${notification.event.user_name} eine strahlende goldene Gurke hervor und wirft sie sich selbst zu! Ein Akt der Einzigartigkeit, der die goldene Gurkenmenge auf ${counter} anhebt!`];

    const otherMessages = [
        `🥒 Ein magischer Wirbel erscheint, und plötzlich fliegt eine strahlende goldene Gurke aus ihm hervor! @${notification.event.user_name} schleudert sie in Richtung von @${randomUser}, der/sie völlig überrascht wird! 🌟 Insgesamt wurden bereits ${counter} glänzende goldene Gurken in die Schlacht geworfen!`,
        `🥒 Mit einem Hauch von Glitzer wirft @${notification.event.user_name} eine leuchtende goldene Gurke in die Menge, direkt auf @${randomUser} gerichtet! Alle schauen fasziniert zu, während ${counter} glänzende goldene Gurken bisher verschwendet wurden!`,
        `🥒 Ohrenbetäubender Applaus ertönt, als @${notification.event.user_name} eine kostbare goldene Gurke hoch in die Luft wirft. Sie landet bei @${randomUser} mit einem sanften Glanz und fügt sich zu den bisher verschwendeten ${counter} glänzenden goldenen Gurken hinzu!`,
        `🥒 Ein seltsamer Wirbelwind sorgt für Staunen, während @${notification.event.user_name} eine schimmernde goldene Gurke herbeizaubert. Gezielt auf @${randomUser} geworfen, gesellt sie sich zu den bisher verschwendeten ${counter} glänzenden goldenen Gurken!`,
        `🥒 @${notification.event.user_name} hebt die Stimmung mit einer überraschenden Wendung, indem er/sie eine lebendige goldene Gurke enthüllt. Mit einem geschickten Wurf landet sie bei @${randomUser}, während die goldene Gurkenanzahl auf ${counter} steigt!`,
        `🥒 Aus den Tiefen des Chat-Dschungels taucht plötzlich eine majestätische goldene Gurke auf, die von @${notification.event.user_name} enthüllt wird. Präzise auf @${randomUser} gezielt, gesellt sie sich nun zun den bisher geworfenen ${counter} glänzenden goldenen Gurke hinzu!`,
        `🥒 Ein Funkeln erhellt den Bildschirm, als @${notification.event.user_name} eine zauberhafte goldene Gurke hervorbringt. Sie segelt durch die Luft und landet bei @${randomUser}, während die Gesamtzahl auf ${counter} glänzende goldene Gurke ansteigt!`,
        `🥒 Im Einklang mit den Geheimnissen des Universums zaubert @${notification.event.user_name} eine schillernde goldene Gurke hervor. Der gezielte Wurf auf @${randomUser} lässt die Anzahl auf ${counter} glänzende goldene Gurke anwachsen!`,
        `🥒 Ein triumphaler Klang erklingt, als @${notification.event.user_name} eine leuchtende goldene Gurke in die Höhe wirft. Zielgenau landet sie bei @${randomUser}, und die Reihen der glänzenden goldenen Gurken werden auf ${counter} erhöht!`,
        `🥒 Wie aus dem Nichts erscheint eine geheimnisvolle goldene Gurke in der Hand von @${notification.event.user_name}. Mit einem geschickten Wurf trifft sie @${randomUser}, und die leuchtende goldene Gurke gesellt sich zu den bisher geworfenen ${counter} glänzenden goldenen Gurken hinzu!`]

    if (randomUser === notification.event.user_name) {
        message = selfMesages[Math.floor(Math.random() * selfMesages.length)];
    } else {
        message = otherMessages[Math.floor(Math.random() * otherMessages.length)];
    }

    await nightBotController.sendMessageInChannel('chiara', message).then(res => {
        if (res.status === 401) {
            nightBotController.refreshAccessToken().then(res => {
                if (res.status === 200) {
                    nightBotController.sendMessageInChannel('chiara', message);
                }
            });
        }
    }).catch(err => {
        console.log(err);
    });
}

module.exports = {
    router,
    addRecentlyChattedUser
};