
define([
	'minpubsub',
	'../../common/helpers',
	'../io',
	'../defaults',
	'./judges-sidebar',
	'./config-panel',
	'./match-panel',
	'./result-panel'
	
], function (PubSub, Helpers, IO, defaults, JudgesSidebar, ConfigPanel, MathPanel, ResultPanel) {
	
	function RingView(ring) {
		this.ring = ring;
		this.root = document.getElementById('ring');
		
		// Initialise sidebar and panels
		this.judgesSidebar = new JudgesSidebar(this.ring);
		this.configPanel = new ConfigPanel(this.ring, defaults.match);
		this.matchPanel = new MathPanel(this.ring);
		this.resultPanel = new ResultPanel(this.ring);
		
		// Subscribe to events
		Helpers.subscribeToEvents(this, {
			io: {
				newCornerJudge: this._onNewCornerJudge,
				cornerJudgeStateChanged: this._onCornerJudgeStateChanged
			},
			ring: {
				full: this._onRingFull,
				matchInProgress: this._onMatchInProgress
			},
			match: {
				created: this._onMatchCreated
			},
			judge: {
				authorised: this._onJudgeAuthorised
			},
			judgesSidebar: {
				judgeDetached: this._onJudgeDetached
			},
			configPanel: {
				newMatchBtn: this._onNewMatchBtn
			},
			matchPanel: {
				matchResultBtn: this._onMatchResultBtn
			},
			resultPanel: {
				matchConfigBtn: this._onMatchConfigBtn,
				newMatchBtn: this._onNewMatchBtn
			}
		});
		
		// Add judge slots
		for (var i = 0, len = defaults.judgesPerRing; i < len; i += 1) {
			this.ring.addSlot(i);
		}
	}
	
	RingView.prototype = {
		
		_publish: function (subTopic) {
			PubSub.publish('ringView.' + subTopic, [].slice.call(arguments, 1));
		},
		
		_onNewCornerJudge: function (judge) {
			console.log("New corner judge (id=" + judge.id + ")");
			this.ring.newJudge(judge.id, judge.name, false, judge.connected);
		},
		
		_onRingFull: function (judgeId) {
			console.log("Ring full");
			IO.cornerJudgeRejected(judgeId, "Ring full");
		},
		
		_onMatchInProgress: function (judgeId) {
			console.log("Cannot join ring: match in progress");
			IO.cornerJudgeRejected(judgeId, "Match in progress");
		},
		
		_onJudgeAuthorised: function (id) {
			console.log("Judge authorised (id=" + id + ")");
			IO.cornerJudgeAuthorised(id);
		},
		
		_onJudgeDetached: function (id) {
			console.log("Judge detached (id=" + id + ")");
			this.ring.judgeDetached(id);
		},
		
		_onCornerJudgeStateChanged: function (judge) {
			console.log("Setting judge connection state (connected=" + judge.connected + ")");
			this.ring.judgeStateChanged(judge.id, judge.connected);
		},
		
		_showPanel: function (panel) {
			this.configPanel.root.classList.toggle('hidden', panel !== this.configPanel);
			this.matchPanel.root.classList.toggle('hidden', panel !== this.matchPanel);
			this.resultPanel.root.classList.toggle('hidden', panel !== this.resultPanel);
		},
		
		_onNewMatchBtn: function (btn) {
			btn.blur();
			this.ring.newMatch(this.configPanel.getConfig());
		},
		
		_onMatchCreated: function () {
			// Ask judges to reset their scoreboard
			this.ring.resetScoreboards();
			
			// Show match panel
			this._showPanel(this.matchPanel);
		},
		
		_onMatchConfigBtn: function () {
			// Show config panel
			this._showPanel(this.configPanel);
		},
		
		_onMatchResultBtn: function () {
			// Show result panel
			this._showPanel(this.resultPanel);
		}
		
	};
	
	return RingView;
	
});
