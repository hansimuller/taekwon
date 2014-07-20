
define([
	'minpubsub',
	'handlebars',
	'../../common/helpers',
	'../io',
	'../model/match-states',
	'../model/timer'

], function (PubSub, Handlebars, Helpers, IO, MatchStates, Timer) {
	
	function MatchPanel(ring) {
		this.ring = ring;
		this.match = null;
		this.root = document.getElementById('match-panel');
		
		// Subscribe to events
		Helpers.subscribeToEvents(this, {
			io: {
				cornerJudgeScored: this._onCornerJudgeScored
			},
			ring: {
				slotAdded: this._onSlotAdded,
				slotRemoved: this._onSlotRemoved,
				judgeAttached: this._onJudgeAttached,
				judgeDetached: this._onJudgeDetached
			},
			match: {
				created: this._onMatchCreated,
				ended: this._onMatchEnded,
				stateChanged: this._onStateChanged,
				stateStarted: this._onStateStarted,
				stateEnded: this._onStateEnded,
				injuryStarted: this._onInjuryStarted,
				injuryEnded: this._onInjuryEnded,
				scoringStateChanged: this._onScoringStateChanged,
				judgeScoresUpdated: this._onJudgeScoresUpdated
			},
			timer: {
				tick: this._onTimerTick
			}
		});
		
		// Time keeping
		this.timeKeeping = this.root.querySelector('.time-keeping');
		this.roundTimer = {
			timer: new Timer('round'),
			min: this.timeKeeping.querySelector('.tk-timer--round > .tk-timer-min'),
			sec: this.timeKeeping.querySelector('.tk-timer--round > .tk-timer-sec')
		};
		
		this.injuryTimer = {
			timer: new Timer('injury'),
			min: this.timeKeeping.querySelector('.tk-timer--injury > .tk-timer-min'),
			sec: this.timeKeeping.querySelector('.tk-timer--injury > .tk-timer-sec')
		};
		
		// Match state management
		// TODO: bindEvents helper
		this.stateStartBtn = this.root.querySelector('.sm-btn--start');
		this.stateEndBtn = this.root.querySelector('.sm-btn--end');
		this.matchResultBtn = this.root.querySelector('.sm-btn--result');
		this.injuryBtn = this.root.querySelector('.sm-btn--injury');
		
		this.stateStartBtn.addEventListener('click', this._onStateStartBtn.bind(this));
		this.stateEndBtn.addEventListener('click', this._onStateEndBtn.bind(this));
		this.matchResultBtn.addEventListener('click', this._publish.bind(this, 'matchResultBtn'));
		this.injuryBtn.addEventListener('click', this._onInjuryBtn.bind(this));
		
		// Scoring
		this.scoring = this.root.querySelector('.scoring');
		this.scoringInner = this.scoring.querySelector('.sc-inner');
		this.judgeScoringTemplate = Handlebars.compile(document.getElementById('sc-judge-tmpl').innerHTML);
		
		this.judgeScores = [];
		this.judgeScoresById = {};
		
		// Penalties
		this.penalties = this.root.querySelector('.penalties');
		// Loop through penalty items
		[].forEach.call(this.root.querySelectorAll('.pe-item'), function (item) {
			// Use event delegation
			item.addEventListener('click', this._onPenaltyItem.bind(this, item));
			
			// TODO: Control penalty buttons state
		}, this);
	}
	
	MatchPanel.prototype = {
		
		_publish: function (subTopic) {
			PubSub.publish('matchPanel.' + subTopic, [].slice.call(arguments, 1));
		},
		
		_onTimerTick: function (name, value) {
			var timer = this[name + 'Timer'];
			var sec = value % 60
			timer.sec.textContent = (sec < 10 ? '0' : '') + sec;
			timer.min.textContent = Math.floor(value / 60);
		},

		_onStateStartBtn: function (evt) {
			evt.target.blur();
			this.match.startState();
		},

		_onStateEndBtn: function (evt) {
			evt.target.blur();
			this.match.endState();
		},

		_onInjuryBtn: function (evt) {
			evt.target.blur();
			this.match.startEndInjury();
		},
		
		_onMatchCreated: function (match) {
			console.log("Match created");
			this.match = match;
			this._updateStateBtns(null, false);
			this.matchResultBtn.classList.add('hidden');
			this.stateStartBtn.classList.remove('hidden');
			this.stateEndBtn.classList.remove('hidden');
			this._resetPenalties();
		},

		_onStateChanged: function (state) {
			var stateStr = state.toLowerCase().replace('-', ' ');
			console.log("State changed: " + stateStr);

			// Reset round timer
			this.roundTimer.timer.reset((state === MatchStates.BREAK ? this.match.config.breakTime :
								(state === MatchStates.GOLDEN_POINT ? 0 : this.match.config.roundTime)));

			// Update text of start and end buttons
			this.stateStartBtn.textContent = "Start " + stateStr;
			this.stateEndBtn.textContent = "End " + stateStr;

			// Mark start button as major on non-BREAK states
			this.stateStartBtn.classList.toggle('btn--major', state !== MatchStates.BREAK);
			this.stateEndBtn.classList.toggle('btn--major', state !== MatchStates.BREAK);
		},

		_onStateStarted: function (state) {
			console.log("State started: " + state);
			this._updateStateBtns(state, true);

			this.roundTimer.timer.start(state !== MatchStates.GOLDEN_POINT, false);

			if (state !== MatchStates.BREAK) {
				this.match.setScoringState(true);
			}
			
			if (state === MatchStates.TIE_BREAKER || state === MatchStates.GOLDEN_POINT) {
				this._resetPenalties();
			}
		},

		_onStateEnded: function (state) {
			console.log("State ended: " + state);
			this._updateStateBtns(state, false);
			this.roundTimer.timer.stop();

			if (state !== MatchStates.BREAK) {
				this.match.setScoringState(false);
			}
		},

		_updateStateBtns: function (state, starting) {
			// State start/end buttons
			Helpers.enableBtn(this.stateEndBtn, starting);
			Helpers.enableBtn(this.stateStartBtn, !starting);

			// Enable injury button when a non-BREAK state is starting
			Helpers.enableBtn(this.injuryBtn, starting && state !== MatchStates.BREAK);
		},

		_onMatchEnded: function () {
			console.log("Match ended");
			this.stateStartBtn.classList.add("hidden");
			this.stateEndBtn.classList.add("hidden");
			this.matchResultBtn.classList.remove("hidden");
			this.roundTimer.timer.reset(0);
		},

		_onInjuryStarted: function () {
			Helpers.enableBtn(this.stateEndBtn, false);
			this.injuryBtn.textContent = "End injury";
			this.timeKeeping.classList.add('tk_injury');

			this.injuryTimer.timer.reset(this.match.config.injuryTime);
			this.injuryTimer.timer.start(true, true);
			this.roundTimer.timer.stop();

			this.match.setScoringState(false);
		},

		_onInjuryEnded: function (state) {
			Helpers.enableBtn(this.stateEndBtn, true);
			this.injuryBtn.textContent = "Start injury";
			this.timeKeeping.classList.remove('tk_injury');

			this.injuryTimer.timer.stop();
			this.roundTimer.timer.start(state !== MatchStates.GOLDEN_POINT, true);

			this.match.setScoringState(true);
		},
		
		_onSlotAdded: function (index) {
			var elem = document.createElement('div');
			elem.className = 'sc-judge';
			elem.innerHTML = this.judgeScoringTemplate({ index: index + 1 });
			this.scoringInner.appendChild(elem);
			
			this.judgeScores.push({
				root: elem,
				name: elem.querySelector('.sc-judge-name'),
				hong: elem.querySelector('.sc-hong'),
				chong: elem.querySelector('.sc-chong')
			});
		},
		
		_onSlotRemoved: function (index) {
			this.scoringInner.removeChild(this.judgeScores[index].root);
			this.judgeScores.splice(index, 1);
		},
		
		_onJudgeAttached: function (judge) {
			var js = this.judgeScores[judge.index];
			js.name.textContent = judge.name;
			this.judgeScoresById[judge.id] = js;
		},
		
		_onJudgeDetached: function (judge) {
			this.judgeScores[judge.index].name.textContent = "Judge #" + (judge.index + 1);
			delete this.judgeScoresById[judge.id];
		},
		
		_onScoringStateChanged: function (enabled) {
			IO.enableScoring(enabled);
		},
		
		_onCornerJudgeScored: function (score) {
			console.log("Judge scored (points=" + score.points + ")");
			this.match.score(score.judgeId, score.competitor, score.points);
		},
		
		_onJudgeScoresUpdated: function (judgeId, scores) {
			var js = this.judgeScoresById[judgeId];
			js.hong.textContent = scores[0];
			js.chong.textContent = scores[1];
		},
		
		_resetPenalties: function () {
			[].forEach.call(this.penalties.querySelectorAll('.pe-value'), function (elem) {
				elem.textContent = 0;
			}, this);
		},
		
		_onPenaltyItem: function (item, evt) {
			var elem = evt.target;
			if (!elem || elem.nodeName !== 'BUTTON') {
				return;
			}
			
			elem.blur();
			var type = item.dataset.type;
			var competitor = item.dataset.competitor;
			var value;
			
			// Increment or decrement time
			if (elem.classList.contains('pe-inc')) {
				value = this.match.incrementPenalty(type, competitor);
			} else if (elem.classList.contains('pe-dec')) {
				value = this.match.decrementPenalty(type, competitor);
			}
			
			// Display new value
			item.querySelector('.pe-value').textContent = value;
		}
		
	};
	
	return MatchPanel;
	
});
