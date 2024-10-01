const tmi = require('tmi.js');
const twitchRouter = require('../routes/twitch.js');

const options = {
    channels: [
        'SilverLine'
    ]
}

const blacklist = ['Nightbot', 'StreamElements', 'Streamlabs', 'Moobot', 'CreatisBot'];

const client = new tmi.client(options);

client.on('message', onMessageHandler);
client.on('connected', onConnectedHandler);

client.connect().then(r => console.log(r))
    .catch(e => console.log(e));

function onMessageHandler(target, context, msg, self) {
    if (self) { return; }

    if(blacklist.includes(context['display-name'])) return;

    twitchRouter.addRecentlyChattedUser(context['display-name']);
}

function onConnectedHandler(addr, port) {
    console.log(`* Connected to ${addr}:${port}`);
}