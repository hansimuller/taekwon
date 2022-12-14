'use strict';

// Load environment variables
require('dotenv').config({ path: 'config/.env' });

// Dependencies
var express = require('express');
var http = require('http');
var nunjucks = require('nunjucks');
var asyncSeries = require('async/series');

var config = require('./config/config.json');
var assert = require('./app/lib/assert');
var log = require('./app/lib/log');
var DB = require('./app/lib/db');
var Tournament = require('./app/tournament').Tournament;


// Create logger
var logger = log.createLogger('app', "App");


/*
 * Initialise Express and the web server
 */
var app = express();
var server = http.Server(app);

// Configure Nunjucks
nunjucks.configure(['templates', 'templates/partials'], {
	autoescape: true,
	express: app
});

// Set the view engine
app.set('view engine', 'njk');

// Serve static files from the `public` folder
app.use(express.static(__dirname + '/public'));

// Pass server-side configuration to client
app.locals.baseUrl = process.env.BASE_URL;
app.locals.port = process.env.PORT;

// Assert relevant configuration options
assert.ok(config.maxScore >= 3 && config.maxScore <= 5, "maximum score must be 3, 4 or 5 (current: " + config.maxScore + ")");

// Corner Judge route
app.get('/', function (req, res) {
	var identity = 'corner-judge';
	res.render(identity, {
		identity: identity,
		title: "Juez de Esquina",
		metaViewport: 'width=device-width, initial-scale=1, user-scalable=no',
		maxScore: config.maxScore
	});
});

// Jury President route
app.get('/mesa', function (req, res) {
	var identity = 'jury-president';
	res.render(identity, {
		identity: identity,
		title: "Jefe de Mesa",
		metaViewport: 'width=device-width, initial-scale=1'
	});
});

// Scoreboard Monitor route
app.get('/monitor', function (req, res) {
	var identity = 'scoreboard-monitor';
	res.render(identity, {
		identity: identity,
		title: "Marcador",
		metaViewport: 'width=device-width, initial-scale=1'
	});
});


/*
 * Initialise tournament
 */
var tournament;

if (process.argv.indexOf('--force') !== -1) {
	// If `--force` argument is present, create a new tournament
	createTournament();
} else {
	// Get timestamp for the start of today
	var now = new Date();
	var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	
	// Look for an open tournament in the database
	DB.findOpenTournament(startOfToday, function (doc) {
		if (doc) {
			// Initialise log module using the existing tournament's ID
			log.init(doc._id);

			// If a tournament was found, restore it
			tournament = new Tournament(doc._id);

			// Restore its users and rings
			asyncSeries([
				tournament.restoreUsers.bind(tournament),
				tournament.restoreRings.bind(tournament)
			], function () {
				// The tournament has been restored and is ready to receive Web Socket connections
				tournament.ready(server);
				logger.info('tournamentRestored', { tournament: doc });
			});
		} else {
			// No open tournament found; create a new tournament
			createTournament();
		}
	});
}


/**
 * Create a new tournament.
 */
function createTournament() {
	DB.insertTournament(function (newDoc) {
		if (newDoc) {
			// Initialise log module using the new tournament's ID
			log.init(newDoc._id);

			// Initialise the new tournament
			tournament = new Tournament(newDoc._id);
			tournament.createRings(config.ringCount, function () {
				// The tournament has been initialised and is ready to receive Web Socket connections
				tournament.ready(server);
				logger.info('tournamentStarted', { tournament: newDoc });
			});
		}
	});
}
