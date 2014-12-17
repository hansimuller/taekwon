
// Modules
var assert = require('./lib/assert');
var logger = require('./lib/log')('tournament');
var db = require('./lib/db');
var async = require('async');
var Spark = require('primus').Spark;
var Ring = require('./ring').Ring;
var User = require('./user').User;
var JuryPresident = require('./jury-president').JuryPresident;
var CornerJudge = require('./corner-judge').CornerJudge;


/**
 * Tournament; the root of the application.
 * @param {String} id
 * @param {Primus} primus
 * @param {Object} db - the NeDB datastores
 * @param {Object} data - if provided, used to restore an existing tournament
 * 		  {Array}  data.ringIds
 * 		  {Array}  data.users
 */
function Tournament(id, primus) {
	assert.provided(primus, 'primus');
	assert.object(db, 'db');
	
	this.id = id;
	this.primus = primus;
	
	this.rings = [];
	this.users = {};
	
	// Bind socket events
	primus.on('connection', this._onConnection.bind(this));
	primus.on('disconnection', this._onDisconnection.bind(this));
}


Tournament.prototype = {
	
	/**
	 * New socket connection.
	 * @param {Spark} spark
	 */
	_onConnection: function (spark) {
		assert.provided(spark, 'spark');
		
		var request = spark.request;
		assert(request, "`spark.request` is " + request);

		var sessionId = request.sessionId;
		assert(sessionId, "session ID is invalid (cookies not transmitted)");
		assert.string(sessionId, 'sessionId');

		// Look for an existing user with this session ID
		var user = this.users[sessionId];
		
		if (!user) {
			// Request identification from new user
			logger.debug("New user with ID=" + sessionId);
			this._waitForId(spark, sessionId);
		} else {
			// If existing user, check whether its previous spark is still open
			logger.debug("Existing user with ID=" + sessionId);
			if (user.spark && user.spark.readyState === Spark.OPEN) {
				// Inform client that a session conflict has been detected
				logger.debug("> Session conflict detected");
				spark.emit('wsError', {
					reason: "Session already open"
				});
				spark.end();
			} else {
				// Ask user to confirm its identity
				logger.debug("> Confirming identity...");
				this._confirmIdentity(spark, sessionId, user);
			}
		}
	},
	
	/**
	 * Socket disconnection.
	 * @param {Spark} spark
	 */
	_onDisconnection: function (spark) {
		assert.provided(spark, 'spark');
		
		var request = spark.request;
		assert(request, "`spark.request` is " + request);
		
		var sessionId = request.sessionId;
		assert(sessionId, "session ID is invalid (cookies not transmitted)");
		assert.string(sessionId, 'sessionId');
		
		// Look for the user with this session ID
		var user = this.users[sessionId];

		// If the user exists (has been successfully identified), notify it of the disconnection
		if (user) {
			logger.debug("User with ID=" + sessionId + " disconnected.");
			user.disconnected();
		}
	},
	
	/**
	 * Request and wait for user identification.
	 * @param {Spark} spark
	 * @param {String} sessionId
	 */
	_waitForId: function (spark, sessionId) {
		assert.provided(spark, 'spark');
		assert.string(sessionId, 'sessionId');
		
		// Listen for identification
		['juryPresident', 'cornerJudge'].forEach(function (evt) {
			spark.on(evt, this._onId.bind(this, spark, sessionId, evt));
		}, this);

		// Inform user that we're waiting for an identification
		logger.debug("> Waiting for identification...");
		spark.emit('waitingForId');
	},

	/**
	 * Identification received.
	 * @param {Spark} spark
	 * @param {String} sessionId
	 * @param {String} identity - 'cornerJudge' or 'juryPresident'
	 * @param {Object} data
	 * 		  {String} data.password - the master password
	 */
	_onId: function (spark, sessionId, identity, data) {
		assert.provided(spark, 'spark');
		assert.string(sessionId, 'sessionId');
		
		// If another user has logged in with the same sessionID since the 'waitingForId' 
		// notification was sent, inform client that a session conflict has been detected
		if (this.users[sessionId]) {
			logger.debug("> Session conflict detected");
			spark.emit('wsError', {
				reason: "Session already open"
			});
			spark.end();
			return;
		}
		
		assert.string(identity, 'identity');
		assert.object(data, 'data');
		
		var user;
		var userDoc = {
			_id: sessionId,
			identity: identity
		};
		
		switch (identity) {
			case 'juryPresident':
				// Check password
				assert(typeof process.env.MASTER_PWD === 'string',
					   "environment configuration `MASTER_PWD` must be a string");
				if (data.password === process.env.MASTER_PWD) {
					// Initialise Jury President
					user = new JuryPresident(this, this.primus, spark, sessionId);
				}
				break;
			case 'cornerJudge':
				// Check name
				assert.string(data.name, 'data.name', true);
				if (data.name.length > 0) {
					// Initialise Corner Judge
					user = new CornerJudge(this, this.primus, spark, sessionId, data.name);
					userDoc.name = data.name;
					userDoc.authorised = false;
				}
				break;
			default:
				assert(false, "`identity` must be 'cornerJudge' or 'juryPresident'");
		}
		
		if (user) {
			// Store user
			this.users[sessionId] = user;
			
			// Notify client of success
			logger.debug("> " + identity + " identified");
			spark.emit('idSuccess');
			
			// Send ring states right away
			spark.emit('ringStates', this.getRingStates());
			
			// Save user to database
			this.db.users.insert(userDoc, function (err, newDoc) {
				this.db.cb(err);
				if (newDoc) {
					this.db.tournaments.update({ _id: this.id }, { $addToSet: { userIds: sessionId } },
											   function (err) {
						this.db.cb(err);
						logger.info('newUser', userDoc);
					}.bind(this));
				}
			}.bind(this));
		} else {
			// Notify client of failure
			logger.debug("> " + identity + " identified but rejected");
			spark.emit('idFail');
		}
	},
		
	/**
	 * Ask a user to confirm its identity.
	 * @param {Spark} spark
	 * @param {String} sessionId
	 * @param {User} user
	 */
	_confirmIdentity: function (spark, sessionId, user) {
		assert.provided(spark, 'spark');
		assert.string(sessionId, 'sessionId');
		assert.instanceOf(user, 'user', User, 'User');
		
		// Listen for identity confirmation
		spark.on('identityConfirmation', this._onIdentityConfirmation.bind(this, spark, sessionId, user));
		
		// Send identity confirmation request
		logger.debug("> Waiting for identity confirmation...");
		spark.emit('confirmIdentity');
	},
	
	/**
	 * Identity confirmation received.
	 * @param {Spark} spark
	 * @param {String} sessionId
	 * @param {User} user
	 * @param {Object} data
	 * 		  {String} data.identity - the user's identity ('juryPresident' or 'cornerJudge')
	 */
	_onIdentityConfirmation: function (spark, sessionId, user, data) {
		assert.provided(spark, 'spark');
		assert.string(sessionId, 'sessionId');
		assert(this.users[sessionId] === user, "user has already switched role");
		assert.instanceOf(user, 'user', User, 'User');
		assert.object(data, 'data');
		assert.string(data.identity, 'data.identity');
		assert(data.identity === 'juryPresident' || data.identity === 'cornerJudge',
			   "`data.identity` must be 'juryPresident' or 'cornerJudge'");
		
		// Check whether user is switching role
		var isJP = data.identity === 'juryPresident';
		if (isJP && user instanceof JuryPresident || !isJP && user instanceof CornerJudge) {
			// Not switching; restore session
			logger.debug("> Identity confirmed: " + data.identity + ". Restoring session...");
			user.restoreSession(spark);
		} else {
			// Switching; remove user from system and request identification from new user
			logger.debug("> User has changed identity. Starting new identification process...");
			user.exit();
			delete this.users[sessionId];
			this._waitForId(spark, sessionId);
		}
	},
	
	/**
	 * Retore the tournament's users.
	 * @param {Array} ids
	 * @param {Function} cb - a function called when the restoration is complete
	 */
	restoreUsers: function (ids, cb) {
		assert.array(ids, 'ids');
		assert.function(cb, 'cb');
		
		async.each(ids, function (id, cb) {
			// Find the ring with the given ID in the database
			this.db.users.findOne({ _id: id }, function (err, doc) {
				this.db.cb(err);
				
				// If the user was found, restore it
				if (doc) {
					var user;
					switch(doc.identity) {
						case 'juryPresident':
							// Initialise Jury President
							user = new JuryPresident(this, this.primus, null, id);
							break;
						case 'cornerJudge':
							// Initialise Corner Judge
							user = new CornerJudge(this, this.primus, null, id, doc.name);
							user.authorised = !!doc.authorised;
							user.connected = false;
							break;
					}

					// Add the user to the tournament
					this.users[user.id] = user;
					logger.debug("User restored (" + doc.identity + ", ID=" + user.id + ")");
				} else {
					logger.debug("User missing from database (ID=" + id + ")");
				}
				
				cb();
			}.bind(this));
		}.bind(this), cb);
	},
	
	/**
	 * Initialise the tournament's rings.
	 * @param {Number} count - the number of rings, as an integer greater than 0
	 * @param {Function} cb - a function called when the initialisation is complete
	 */
	initialiseRings: function (count, cb) {
		assert.integerGt0(count, 'count');
		assert.function(cb, 'cb');
		
		// Retrieve the number of corner judge slots per ring
		var slotCount = parseInt(process.env.CJS_PER_RING, 10);
		assert(!isNaN(slotCount) && slotCount > 0 && slotCount % 1 === 0,
			   "environment configuration `CJS_PER_RING` must be a positive integer");
		
		// Initialise the ring documents that will be stored in the database
		var ringDocs = [];
		for (var i = 0; i < count; i += 1) {
			ringDocs.push({
				index: i,
				jpId: null,
				cjIds: [],
				slotCount: slotCount
			});
		}
		
		// Insert the ring documents in the database
		this.db.rings.insert(ringDocs, function (err, newDocs) {
			this.db.cb(err);
			if (newDocs) {
				// If all documents were added successfully to the database, initialise the rings
				var ids = [];
				newDocs.forEach(function (doc) {
					ids.push(doc._id);
					this.rings.push(new Ring(this, doc._id, doc.index, slotCount));
				}, this);
				
				// Store the ring IDs in the database
				this.db.tournaments.update({ _id: this.id }, { $set: { ringIds: ids } }, cb);
				
				logger.debug("Rings initialised (IDs=" + ids + ")");
			}
		}.bind(this));
	},
	
	/**
	 * Restore the tournament's rings.
	 * @param {Array} - an array of ring IDs to restore
	 * @param {Function} cb - a function called when the restoration is complete
	 */
	restoreRings: function (ids, cb) {
		assert.arra(ids, 'ids');
		assert.function(cb, 'cb');
		
		async.each(ids, function (id, cb) {
			// Find the ring with the given ID in the database
			this.db.rings.findOne({ _id: id }, function (err, doc) {
				this.db.cb(err);
				
				if (doc) {
					// If the ring was found, restore it
					var ring = new Ring(this, doc._id, doc.index, doc.slotCount);
					this.rings[doc.index] = ring;
	
					// Restore the ring's Jury President
					if (doc.jpId) {
						var jp = this.users[doc.jpId];
						if (jp) {
							ring.juryPresident = jp;
							jp.ring = ring;
						}
						
					}
					
					// Restore the ring's Corner Judges
					if (doc.cjIds) {
						doc.cjIds.forEach(function (id) {
							var cj = this.users[id];
							if (cj) {
								ring.cornerJudges.push(this.users[id]);
								cj.ring = ring;
							}
						});
					}
					
					logger.debug("Ring restored (ID=" + id + ")");
				} else {
					logger.debug("Ring missing from database (ID=" + id + ")");
				}
				
				cb();
			}.bind(this));
		}.bind(this), cb);
	},
	
	/**
	 * Get ring at given index.
	 * @param {Number} index - the index of the ring, as a positive integer
	 * @return {Ring}
	 */
	getRing: function (index) {
		assert.integerGte0(index, 'index');
		
		var ring = this.rings[index];
		assert(ring, "no ring at index=" + index);
		
		return ring;
	},
	
	/**
	 * Build and return an array of the rings' states.
	 * @return {Array}
	 */
	getRingStates: function () {
		return this.rings.reduce(function (arr, ring) {
			arr.push(ring.getState());
			return arr;
		}, []);
	},
	
	/**
	 * Broadcast to all users that the state of a ring (open/closed) has changed.
	 * @param {Ring} ring
	 */
	ringStateChanged: function (ring) {
		assert.instanceOf(ring, 'ring', Ring, 'Ring');
		
		// Retrieve the state of the ring
		var state = ring.getState();
		
		this.primus.forEach(function (spark) {
			spark.emit('ringStateChanged', state);
		}.bind(this));
		
		// Update the database
		var jpId = state.open ? ring.juryPresident.id : null;
		this.db.rings.update({ _id: ring.id }, { $set: { jpId: jpId } }, this.db.cb);
	},
	
	/**
	 * The authorisation state of a Corner Judge has changed.
	 * @param {CornerJudge} cj
	 */
	cjAuthorisationStateChanged: function (cj) {
		assert.instanceOf(cj, 'cj', CornerJudge, 'CornerJudge');
		
		// Update the database
		this.db.users.update({ _id: cj.id }, { $set: { authorised: cj.authorised } }, this.db.cb);
	}
	
};


exports.Tournament = Tournament;
