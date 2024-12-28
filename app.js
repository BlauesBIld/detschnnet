const express = require('express');
const app = express();
const port = 13061;
const path = require('path');
const ejs = require('ejs');
const db = require('./services/database.js');
const twitchChat = require('./services/twitchChat.js');

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

const methodOverride = require('method-override');
app.use(methodOverride('_method'));

const bodyParser = require('body-parser');
app.use(bodyParser.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));
app.use(bodyParser.urlencoded({ extended: true }));

const cors = require('cors');
app.use(cors());

const fileUpload = require('express-fileupload');
app.use(fileUpload({createParentPath: true}));

const cookieParser = require('cookie-parser');
app.use(cookieParser());

const fs = require('fs');
const morgan = require('morgan');
const accessLogStream = fs.createWriteStream(path.join(__dirname, './logs/requests.log'), { flags: 'a+' })
app.use(morgan('combined', { stream: accessLogStream }))
app.use(morgan('short'))

const indexRouter = require('./routes/index');
const twitchRouter = require('./routes/twitch');
const riotRouter = require('./routes/riot');
const spotifyRouter = require('./routes/spotify');
const gamesRouter = require('./routes/games');
const streamerRouter = require('./routes/streamer');
const openAiRouter = require('./routes/openai');
const {hash} = require("bcrypt");

app.use('/', indexRouter);
app.use('/twitch', twitchRouter.router);
app.use('/riot', riotRouter);
app.use('/spotify', spotifyRouter);
app.use('/games', gamesRouter);
app.use('/streamer', streamerRouter);
app.use('/atd', openAiRouter);

app.use(express.static(__dirname + '/public'));

function errorHandler(err, req, res, next) {
    res.render('error', {error: err});
}
app.use(errorHandler);

app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});