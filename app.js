const express = require('express');
const app = express();
const port = 13061;
const path = require('path');
const ejs = require('ejs');

//const {visitNotifierGeoipLite} = require("./services/visitNotifierGeoipLite");

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.set("trust proxy", true);

// Register notifier BEFORE routes
/*app.use(visitNotifierGeoipLite({
    paths: ["/", "/aboutme", "/games/SyncOrSink/index.html", "/games/SemanticWorldGeneration/index.html"],
    cooldownMs: 60_000,
}));*/

const methodOverride = require('method-override');
app.use(methodOverride('_method'));

const bodyParser = require('body-parser');
app.use(bodyParser.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));
app.use(bodyParser.urlencoded({extended: true}));

const cors = require('cors');
app.use(cors());

const fileUpload = require('express-fileupload');
app.use(fileUpload({createParentPath: true}));

const cookieParser = require('cookie-parser');
app.use(cookieParser());

const fs = require('fs');
const morgan = require('morgan');
const accessLogStream = fs.createWriteStream(path.join(__dirname, './logs/requests.log'), {flags: 'a+'});
app.use(morgan('combined', {stream: accessLogStream}));
app.use(morgan('short'));

const indexRouter = require('./routes/index');
const twitchRouter = require('./routes/twitch');
const riotRouter = require('./routes/riot');
const spotifyRouter = require('./routes/spotify');
const gamesRouter = require('./routes/games');
const streamerRouter = require('./routes/streamer');
const openAiRouter = require('./routes/openai');

app.use('/', indexRouter);
app.use('/twitch', twitchRouter.router);
app.use('/riot', riotRouter);
app.use('/spotify', spotifyRouter);
app.use('/games', gamesRouter);
app.use('/streamer', streamerRouter);
app.use('/atd', openAiRouter);

app.use(express.static(__dirname + '/public'));

// Error handler must be LAST
function errorHandler(err, req, res, next) {
    console.error(err);

    if (res.headersSent) {
        return next(err);
    }

    res.status(500).render('error', {
        error: process.env.NODE_ENV === 'production'
            ? {message: 'Something went wrong'}
            : err
    });
}

app.use(errorHandler);

app.listen(port, () => {
    console.log(`Listening at http://localhost:${port}`);
});
