
// TODO: Fix session restoration
// TODO: Implement judges sidebar controls (buttons to add/remove judges)
// TODO: Use Full Screen API
// TODO: Fix issue: judges get duplicated in sidebar and match panel when connection with server is cut 

/* Core set-up */

// Import core modules
var express = require('express');
var http = require('http');
var socket = require('socket.io');
var cookie = require('cookie');
var cookieParser = require('cookie-parser');
var session = require('express-session');

// Import app modules
var Config = require('./app/config');
var JuryPresident = require('./app/jury-president').JuryPresident;
var CornerJudge = require('./app/corner-judge').CornerJudge;
var Ring = require('./app/ring').Ring;

// Keep track of clients
var clients = {};

// Initialise Express
var app = express();
var server = http.Server(app);

// Express middlewares
app.use(express.static(__dirname + '/public'));
app.use(cookieParser(Config.cookieSecret));
app.use(session({
	name: Config.cookieKey,
	secret: Config.cookieSecret,
	saveUninitialized: true,
	resave: true,
	cookie: {
		maxAge: 1000 * 60 * 60 * 24 // one day
	}
}));

// Initialise Socket.IO
var io = socket(server);
//io.set('origins', 'http://taekwon.do:80');

// Configure Socket.IO
io.use(function (socket, next) {
	var req = socket.request;
	
	if (!req.headers.cookie) {
		next(new Error("No cookie transmitted."));
	}

	// Parse and store cookies
	req.cookie = cookie.parse(req.headers.cookie);
	// Decode Express session ID
	req.sessionId = cookieParser.signedCookie(req.cookie[Config.cookieKey], Config.cookieSecret);

	next();
});


// Start server
server.listen(80);


/* Routes */

// Corner Judge
app.get('/', function (request, response) {
	response.sendfile('corner-judge.html', {root: './public'});
});

// Jury President
app.get('/jury', function (request, response) {
	response.sendfile('jury-president.html', {root: './public'});
});


/* Socket events */

io.sockets.on('connection', function (socket) {
	var req = socket.request;
	var session = req.session;
	var sessionId = req.sessionId;
	var client = clients[sessionId];
	var isJury = socket.handshake.headers.referer.indexOf('/jury') !== -1;
	console.log("New socket connection with session ID: " + sessionId + ".");
	
	// If returning client, restore session automatically
	if (typeof client !== "undefined") {
		// Check that client hasn't switched role (from CornerJudge to JuryPresident and vice versa)
		if (isJury && client instanceof JuryPresident ||
			!isJury && client instanceof CornerJudge) {
			// Restore session
			client.restoreSession(socket);
		} else {
			// Client has switched role; remove its old instance from the system and wait for ID
			// TODO: implement exit functions of JP and CJ
			client.exit();
			waitForId(socket, sessionId);
		}
	} else {
		waitForId(socket, sessionId);
	}
});

/* Request and wait for client identification */
function waitForId(socket, sessionId) {
	// Listen for jury president and corner judge identification
	socket.on('juryPresident', onJPConnection.bind(this, socket, sessionId));
	socket.on('cornerJudge', onCJConnection.bind(this, socket, sessionId));

	// Inform client that we're waiting for an identification
	socket.emit('waitingForId');
	console.log("Waiting for identification...");
}

/* Handle new Jury President connection */
function onJPConnection(socket, sessionId, password) {
	// Check password
	if (password === Config.masterPwd) {
		// Initialise JuryPresident
		clients[sessionId] = new JuryPresident(io, socket, sessionId);
		console.log("> Jury president accepted: valid password");
	} else {
		// Send failure message to client
		console.log("> Jury president rejected: wrong password");
		socket.emit('idFail');
	}
}

/* Handle new Corner Judge connection */
function onCJConnection(socket, sessionId, name) {
	// Initialise CornerJudge
	clients[sessionId] = new CornerJudge(io, socket, sessionId, name);
	console.log("> Corner judge identified: " + name);
}
