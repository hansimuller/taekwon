
var Ring = require('./ring').Ring;
var MatchState = require('./match-state').MatchState;


function CornerJudge(io, socket, id, name) {
	this.io = io;
	this.socket = socket;
	this.connected = true;
	
	this.id = id;
	this.name = name;
	this.ring = null;
	this.authorised = false;
	
	// Send ring allocations and success events to client
	socket.emit('ringAllocations', Ring.getRingAllocations());
	socket.emit('idSuccess', true);
	
	// Listen to client events
	this.initSocket();
}

CornerJudge.prototype.initSocket = function () {
	this.socket.on('disconnect', this.onDisconnect.bind(this));
	this.socket.on('joinRing', this.onJoinRing.bind(this));
};


CornerJudge.prototype.onJoinRing = function (index) {
	this.debug("Joining ring with index=" + index);
	
	var ring = require('./ring').Ring.get(index);
	
	if (!ring) {
		this.debug("> Ring does not exist");
		this.socket.emit('ringDoesNotExist', index);
	} else if (ring.cornerJudges.length >= 4) {
		this.debug("> Ring is full");
		this.socket.emit('ringIsFull', index);
	} else {
		this.debug("> Requesting authorisation from Jury President");
		this.ring = ring;
		ring.juryPresident.authoriseCornerJudge(this);
	}
};

CornerJudge.prototype.ringJoined = function (ring) {
	this.debug("> Ring joined");
	this.authorised = true;
	this.socket.emit('ringJoined', ring.index);
};

CornerJudge.prototype.ringNotJoined = function (ring) {
	this.debug("> Ring not joined (rejected by Jury President)");
	this.ring = null;
	this.socket.emit('ringNotJoined', ring.index);
}


CornerJudge.prototype.restoreSession = function (newSocket) {
	this.debug("Restoring session...");
	
	this.socket = newSocket;
	this.connected = true;
	this.initSocket();
	
	var hasRing = this.ring !== null;
	
	// Send success event to client
	// If CJ doesn't have a ring, client must show the ring allocation view
	this.socket.emit('idSuccess', !hasRing);
	
	if (!this.authorised) {
		// If CJ not auhtorised, send ring allocations
		this.socket.emit('ringAllocations', Ring.getRingAllocations());
		// If CJ has ring, it is waiting for authorisation
		if (hasRing) {
			this.socket.emit('waitingForAuthorisation');
			// Let jury president know that corner judge is now reconnected
			this.ring.juryPresident.cornerJudgeStateChanged(this);
		}
	} else {
		// If CJ is authorised, client must show the match view
		this.socket.emit('ringJoined', this.ring.index);
		// Add new socket to ring's room
		this.socket.join(this.ring.roomId);
		// Let jury president know that corner judge is now reconnected
		this.ring.juryPresident.cornerJudgeStateChanged(this);
		
		if (this.ring.match) {
			this.socket.emit('matchStateChanged', this.ring.match.state);
		}
	}
	
	this.debug("> Session restored");
}

CornerJudge.prototype.onDisconnect = function () {
	this.debug("Disconnected");
	this.connected = false;
	
	if (this.ring) {
		this.ring.juryPresident.cornerJudgeStateChanged(this);
	}
};

CornerJudge.prototype.debug = function (msg) {
	console.log("[Corner Judge] " + msg);
};


exports.CornerJudge = CornerJudge;
