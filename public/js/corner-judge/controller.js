
// TODO: combine rejection events (ring is full, not authorised, match in progress, does not exist)
define([
	'minpubsub',
	'../common/helpers',
	'./io',
	'./widget/name-view',
	'../common/ring-list-view',
	'./widget/round-view'

], function (PubSub, Helpers, IO, NameView, RingListView, RoundView) {
	
	function Controller() {
		// Initialise socket connection with server
		IO.init();
		
		// Subscribe to events
		Helpers.subscribeToEvents(this, {
			io: {
				waitingForId: this._onWaitingForId,
				idSuccess: this._onIdSuccess,
				idFail: this._onIdFail,
				confirmIdentity: this._onConfirmIdentity,
				ringStates: this._onRingStates,
				ringStateChanged: this._onRingStateChanged,
				waitingForAuthorisation: this._onWaitingForAuthorisation,
				ringJoined: this._onRingJoined,
				ringNotJoined: this._onRingNotJoined,
				ringIsFull: this._onRingIsFull,
				matchInProgress: this._onMatchInProgress,
				juryPresidentStateChanged: this._onJuryPresidentStateChanged,
				scoringStateChanged: this._onScoringStateChanged,
				removedFromRing: this._onRemovedFromRing,
				ringClosed: this._onRingClosed,
				restoreSession: this._onRestoreSession
			},
			nameView: {
				nameSubmitted: this._onNameSubmitted
			},
			ringListView: {
				ringSelected: this._onRingSelected
			},
			roundView: {
				score: this._onScore
			}
		});
		
		// Flags
		this.isJPConnected = false;
		this.isScoringEnabled = false;
		
		// Initialise views
		this.nameView = new NameView();
		this.ringListView = new RingListView();
		// Authorisation view doesn't need to be defined as a separate module
		this.authorisationView = {
			root: document.getElementById('authorisation')
		};
		this.roundView = new RoundView();
		
		// Retrieve backdrop elements
		this.backdropWrap = document.getElementById('backdrop-wrap');
		this.disconnectedBackdrop = document.getElementById('disconnected-backdrop');
		this.waitingBackdrop = document.getElementById('waiting-backdrop');
	}
	
	Controller.prototype = {

		_swapView: function(oldView, newView) {
			newView.root.classList.remove('hidden');
			if (oldView) {
				oldView.root.classList.add('hidden');
			}
		},

		_updateBackdrops: function() {
			// Toggle backdrops
			this.disconnectedBackdrop.classList.toggle('hidden', this.isJPConnected);
			this.waitingBackdrop.classList.toggle('hidden', !this.isJPConnected || this.isScoringEnabled);

			// Determine whether backdrop wrapper should be shown or hidden
			var hideWrapper = this.roundView.root.classList.contains('hidden') 
					|| this.isJPConnected
					&& (!this.isJPConnected || this.isScoringEnabled);
			
			// Toggle backdrop wrapper
			this.backdropWrap.classList.toggle('hidden', hideWrapper);
		},
		
		_onWaitingForId: function() {
			console.log("Server waiting for identification");
			this._swapView(null, this.nameView);
			this.nameView.init();
		},

		_onNameSubmitted: function(name) {
			console.log("Sending identification (name=\"" + name + "\")");
			IO.sendId(name);
		},

		_onIdSuccess: function() {
			console.log("Identification succeeded");
		},

		_onIdFail: function() {
			console.log("Identification failed");
			this.nameView.invalidName();
		},

		_onConfirmIdentity: function () {
			console.log("Server waiting for identity confirmation");
			IO.sendIdentityConfirmation();
		},

		_onRingStates: function(states) {
			console.log("Ring states received (count=\"" + states.length + "\")");
			this.ringListView.init(states);
			this._swapView(this.nameView, this.ringListView);
		},

		_onRingStateChanged: function(state) {
			console.log("Ring state changed (index=\"" + state.index + "\")");
			this.ringListView.updateRingBtn(state.index, state.open);
		},

		_onRingSelected: function(index) {
			console.log("Joining ring (index=" + index + ")");
			IO.joinRing(index);
		},
		
		_onWaitingForAuthorisation: function (index) {
			console.log("Waiting for authorisation to join ring");
			this._swapView(this.ringListView, this.authorisationView);
		},

		_onRingJoined: function(data) {
			console.log("Joined ring (index=" + data.ringIndex + ")");

			// Show round view
			this._swapView(this.authorisationView, this.roundView);

			// Update scoring and JP states and toggle backdrops
			this.isScoringEnabled = data.scoringEnabled;
			this.isJPConnected = data.jpConnected;
			this._updateBackdrops();
			
			// Update page title to show ring number
			document.title = "Corner Judge | Ring " + (data.ringIndex + 1);
		},

		_onRingNotJoined: function(index) {
			console.log("Ring not joined (index=" + index + ")");
			this.ringListView.updateInstr("Not authorised to join ring");
			this._swapView(this.authorisationView, this.ringListView);
		},

		_onRingIsFull: function(index) {
			console.log("Ring is full (index=" + index + ")");
			this.ringListView.updateInstr("Ring is full");
			this._swapView(this.authorisationView, this.ringListView);
		},

		_onMatchInProgress: function(index) {
			console.log("Match in progress (index=" + index + ")");
			this.ringListView.updateInstr("Match in progress");
			this._swapView(this.authorisationView, this.ringListView);
		},

		_onJuryPresidentStateChanged: function(connected) {
			console.log("Jury president " + (connected ? "connected" : "disconnected"));
			this.isJPConnected = connected;
			this._updateBackdrops();
		},

		_onScoringStateChanged: function(enabled) {
			console.log("Scoring " + (enabled ? "enabled" : "disabled"));
			this.isScoringEnabled = enabled;
			this._updateBackdrops();
		},

		_onScore: function(competitor, points) {
			console.log("Scoring " + points + " points for " + competitor);
			IO.score(competitor, points);
		},

		_onRemovedFromRing: function(index) {
			console.log("Removed from ring (index=" + index + ")");
			this.ringListView.updateInstr("Removed from ring");
			this._swapView(this.roundView, this.ringListView);
			this._updateBackdrops();
		},
		
		_onRingClosed: function () {
			this.ringListView.updateInstr("Ring closed");
			this._swapView(this.roundView, this.ringListView);
			// TODO: here and above: when judge hasn't been authorised yet, the view to hide is this.authorisationView
			this._updateBackdrops();
		},

		_onRestoreSession: function(data) {
			console.log("Restoring session");

			// Init ring list view with ring state data
			this.ringListView.init(data.ringStates);

			// If no ring was joined yet, show ring list view
			if (data.ringIndex === -1) {
				this._swapView(null, this.ringListView);

			// If a ring was joined, but JP had not authorised the request yet, show authorisation view
			} else if (!data.authorised) {
				this._swapView(null, this.authorisationView);

			// If JP was authorised by CJ to join a ring, show round view
			} else {
				this._onRingJoined(data);
			}

			IO.sessionRestored();
		}

	};
	
	return Controller;
	
});
