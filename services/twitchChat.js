const tmi = require('tmi.js');
const twitchRouter = require('../routes/twitch.js');

const channel = process.env.TWITCH_CHAT_CHANNEL || 'silverline';

const options = {
    connection: {
        reconnect: true,
        secure: true
    },
    channels: [
        channel
    ]
}

const blacklist = ['Nightbot', 'StreamElements', 'Streamlabs', 'Moobot', 'CreatisBot'];

const client = new tmi.client(options);

client.on('message', onMessageHandler);
client.on('connected', onConnectedHandler);
client.on('disconnected', onDisconnectedHandler);
client.on('join', onJoinHandler);

client.connect().then(r => console.log(r))
    .catch(e => console.error('Failed to connect to Twitch chat:', e));

function onMessageHandler(target, context, msg, self) {
    if (self) { return; }

    const displayName = context['display-name'] || context.username;

    if (!displayName) return;
    if (blacklist.map(name => name.toLowerCase()).includes(displayName.toLowerCase())) return;

    twitchRouter.addRecentlyChattedUser(displayName);
}

function onConnectedHandler(addr, port) {
    console.log(`* Connected to ${addr}:${port}`);
}

function onDisconnectedHandler(reason) {
    console.log(`* Disconnected from Twitch chat: ${reason}`);
}

function onJoinHandler(channel, username, self) {
    if (self) {
        console.log(`* Joined Twitch chat channel ${channel}`);
    }
}

module.exports = client;
