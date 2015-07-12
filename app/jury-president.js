'use strict';

// Dependencies
var util = require('util');
var config = require('../config/config.json');
var assert = require('./lib/assert');
var User = require('./user').User;
var MatchStates = require('./enum/match-states');
var MatchRounds = require('./enum/match-rounds');

var INBOUND_SPARK_EVENTS = [
	'selectRing', 'addSlot', 'removeSlot', 'authoriseCJ', 'rejectCJ', 'removeCJ',
	'configureMatch', 'setConfigItem', 'createMatch', 'continueMatch', 'endMatch',
	'startMatchState', 'endMatchState', 'toggleInjury', 'incrementPenalty', 'decrementPenalty'
];


/**
 * Jury President.
 * @param {String} id
 * @param {Spark} spark - the spark or `null` if the user is being restored from the database
 * @param {Boolean} connected
 */
function JuryPresident(id, spark, connected) {
	// Call parent constructor and assert arguments
	User.apply(this, arguments);
}

// Inherit from User
util.inherits(JuryPresident, User);


/**
 * Register event handlers on the spark.
 * @param {Spark} spark
 */
JuryPresident.prototype.initSpark = function (spark) {
	// Call parent function
	User.prototype.initSpark.call(this, spark, INBOUND_SPARK_EVENTS);
};


/* ==================================================
 * Custom handlers for inbound spark events.
 * (By default, such events are forwarded with EventEmitter.)
 * ================================================== */

/**
 * Select a ring (i.e. open).
 * @param {Object} data
 * 		  {Number} data.index - the index of the ring, as a positive integer
 */
JuryPresident.prototype._onSelectRing = function (data) {
	assert.object(data, 'data');
	assert.integerGte0(data.index, 'data.index');
	
	this.emit('openRing', this, data.index);
};

/**
 * Configure the next match.
 */
JuryPresident.prototype._onConfigureMatch = function () {
	// Simply show the configuration panel
	this._send('ringView.showPanel', { panel: 'configPanel' });
};


/* ==================================================
 * Outbound spark events
 * ================================================== */

/**
 * The state of a ring has changed.
 * @param {Array} ringStates
 */
JuryPresident.prototype.ringStateChanged = function (ringStates) {
	assert.array(ringStates, 'ringStates');
	this._send('ringListView.updateList', {
		isJP: true,
		rings: ringStates
	});
};

/**
 * The ring has been opened.
 * @param {Ring} ring
 */
JuryPresident.prototype.ringOpened = function (ring) {
	assert.provided(ring, 'ring');
	
	this._send('io.setPageTitle', {
		title: "Jury President | Ring " + (ring.index + 1)
	});
	
	this.matchConfigUpdated(ring.matchConfig);
	this._send('judgesSidebar.updateSlotList', {
		slotCount: ring.slotCount,
		cornerJudges: ring.getCJStates()
	});
	
	this._send('ringView.showPanel', { panel: 'configPanel' });
	this._send('root.showView', { view: 'ringView' });
};

/**
 * A Corner Judge slot has been added or removed, or the state of a Corner Judge has changed.
 * @param {Integer} slotCount
 * @param {Array} cjStates
 */
JuryPresident.prototype.slotsUpdated = function (slotCount, cjStates) {
	assert.integerGt0(slotCount, 'slotCount');
	assert.array(cjStates, 'cjStates');
	
	this._send('judgesSidebar.updateSlotList', {
		slotCount: slotCount,
		cornerJudges: cjStates
	});
};

/**
 * A Corner Judge slot could not be removed from the ring.
 * @param {String} reason - the reason for the error
 */
JuryPresident.prototype.slotNotRemoved = function (reason) {
	assert.string(reason, 'reason');
	this._send('io.alert', { reason: reason });
};

/**
 * The match configuration has been updated.
 * @param {Object} matchConfig
 */
JuryPresident.prototype.matchConfigUpdated = function (matchConfig) {
	assert.object(matchConfig, 'matchConfig');
	this._send('configPanel.updateConfig', {
		configItems: matchConfig,
		timeStep: config.matchConfig.timeStep
	});
};

/*
 * The state of the match has changed.
 * @param {Ring} ring
 * @param {Match} match
 * @param {String} transition
 * @param {String} fromState
 * @param {String} toState
 */
JuryPresident.prototype.matchStateChanged = function (ring, match, transition, fromState, toState) {
	assert.ok(ring, "`ring` must be provided");
	assert.ok(match, "`match` must be provided");
	assert.string(transition, 'transition');
	assert.string(fromState, 'fromState');
	assert.string(toState, 'toState');
	
	// Perform various UI operations depending on the new state
	switch (toState) {
		case MatchStates.ROUND_IDLE:
			this._send('matchPanel.setRoundLabel', { label: match.round.current });
			this._send('roundTimer.reset', {
				value: match.round.is(MatchRounds.GOLDEN_POINT) ? 0 : match.config.roundTime
			});
			
			this._updateState(toState);
			this._send('matchPanel.updateScoreboards', { scoreboards: match.getCurrentScoreboards() });
			this._send('matchPanel.updatePenalties', {
				penalties: match.getCurrentPenalties(),
				enabled: false
			});
			
			this._send('ringView.showPanel', { panel: 'matchPanel' });
			break;
			
		case MatchStates.ROUND_STARTED:
			if (fromState !== MatchStates.INJURY) {
				this._send('matchPanel.updatePenalties', {
					penalties: match.getCurrentPenalties(),
					enabled: true
				});
				
				this._send('roundTimer.start', {
					countDown: !match.round.is(MatchRounds.GOLDEN_POINT),
					delay: false
				});
			} else {
				this._send('injuryTimer.stop');
				this._send('matchPanel.toggleInjuryTimer', { show: false });
				this._send('roundTimer.unpause', { delay: true });
			}
			
			this._updateState(toState);
			break;
			
		case MatchStates.ROUND_ENDED:
			this._send('roundTimer.stop');
			this._send('matchPanel.disablePenaltyBtns');
			break;
			
		case MatchStates.BREAK_IDLE:
			this._send('roundTimer.reset', { value: match.config.breakTime });
			this._send('matchPanel.setRoundLabel', { label: 'Break' });
			this._updateState(toState);
			
			if (fromState === MatchStates.RESULTS) {
				this._send('ringView.showPanel', { panel: 'matchPanel' });
			}
			break;
			
		case MatchStates.BREAK_STARTED:
			this._send('roundTimer.start', {
				countDown: true,
				delay: false
			});
			
			this._updateState(toState);
			break;
			
		case MatchStates.BREAK_ENDED:
			this._send('roundTimer.stop');
			break;
			
		case MatchStates.INJURY:
			this._send('roundTimer.pause');
			this._send('injuryTimer.reset', { value: match.config.injuryTime });
			this._send('matchPanel.toggleInjuryTimer', { show: true });
			this._send('injuryTimer.start', {
				countDown: true,
				delay: true
			});
			
			this._updateState(toState);
			break;
			
		case MatchStates.RESULTS:
		case MatchStates.MATCH_ENDED:
			if (toState === MatchStates.MATCH_ENDED) {
				this._send('resultPanel.showEndBtns');
			} else {
				this._send('resultPanel.showContinueBtns');
			}
			
			this._send('resultPanel.setWinner', { winner: match.winner });
			this._send('resultPanel.updateScoreboard', {
				periods: match.periods,
				penalties: match.penalties,
				scoreboards: match.scoreboards,
			});
			
			if (fromState !== MatchStates.RESULTS) {
				this._send('ringView.showPanel', { panel: 'resultPanel' });
			}
			break;
	}
};

/**
 * Update state in match panel.
 * @param {String} state
 */
JuryPresident.prototype._updateState = function (state) {
	assert.string(state, 'state');
	this._send('matchPanel.updateState', {
		state: {
			isIdle: MatchStates.isIdle(state),
			isStarted: MatchStates.isStarted(state),
			isBreak: MatchStates.isBreak(state),
			isInjury: MatchStates.isInjury(state),
			canStartInjury: state === MatchStates.ROUND_STARTED
		}
	});
};

/**
 * The match's scoreboards have been updated.
 * @param {Array} scoreboards
 */
JuryPresident.prototype.matchScoreboardsUpdated = function (scoreboards) {
	assert.array(scoreboards, 'scoreboards');
	this._send('matchPanel.updateScoreboards', { scoreboards: scoreboards });
};

/**
 * The penalties have been updated.
 * @param {Object} penalties
 */
JuryPresident.prototype.penaltiesUpdated = function (penalties) {
	assert.object(penalties, 'penalties');
	
	this._send('matchPanel.updatePenalties', {
		penalties: penalties,
		enabled: true
	});
};

/**
 * A Corner Judge has exited the system.
 * @param {CornerJudge} cj
 */
JuryPresident.prototype.cjExited = function (cj) {
	assert.provided(cj, 'cj');
};

module.exports.JuryPresident = JuryPresident;
