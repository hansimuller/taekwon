
document.addEventListener("DOMContentLoaded", function domReady() {
	"use strict";
	
	/**
	 * 'IO' module for everything related to scoket communication.
	 */
	var IO = (function () {
		
		var socket;
		
		var init = function () {
			console.log("Connecting to server");
			socket = io.connect();
			
			// Bind events
			socket.on('waitingForId', onWaitingForId);
			socket.on('idSuccess', onIdSuccess);
			socket.on('idFail', onIdFail);
			socket.on('ringAllocations', onRingAllocations);
			socket.on('ringAllocationChanged', onRingAllocationChanged);
			socket.on('ringCreated', onRingCreated);
			socket.on('ringAlreadyExists', onRingAlreadyExists);
			socket.on('authoriseCornerJudge', onAuthoriseCornerJudge);
			socket.on('cornerJudgeStateChanged', onCornerJudgeStateChanged);
		};
		
		
		var onWaitingForId = function () {
			console.log("Server waiting for identification");
			View.showElem(Views.PWD, 'views');
		};
		
		var sendId = function (password) {
			console.log("Sending identification (password=\"" + password + "\")");
			socket.emit('juryPresident', password);
		};
		
		var onIdSuccess = function (showRingsView) {
			console.log("Identification succeeded");
			View.pwdResult(true);
				
			// If in process of restoring session, rings view may need to be skipped
			if (showRingsView) {
				View.showElem(Views.RINGS, 'views');
			}
		};
		
		var onIdFail = function () {
			console.log("Identification failed");
			View.pwdResult(false);
		};
		
		var onRingAllocations = function (allocations) {
			console.log("Ring allocations: " + allocations);
			View.onRingAllocations(allocations);
		};
		
		var onRingAllocationChanged = function (allocation) {
			console.log("Ring allocation changed (allocation=\"" + allocation + "\")");
			View.onRingAllocationChanged(allocation, allocation.index - 1);
		};
		
		var createRing = function (index) {
			console.log("Creating ring (index=" + index + ")");
			socket.emit('createRing', index);
		};
		
		var onRingCreated = function (ringId) {
			console.log("Ring created (id=" + ringId + ")");
			View.showElem(Views.MATCH, 'views');
		};
		
		var onRingAlreadyExists = function (ringId) {
			console.log("Ring already exists (id=" + ringId + ")");
		};
		
		var onAuthoriseCornerJudge = function (cornerJudge) {
			console.log("Authorising corner judge (id=" + cornerJudge.id + ")");
			View.onAuthoriseCornerJudge(cornerJudge, false);
		};
		
		var authoriseCornerJudge = function (cornerJudgeId, authorise) {
			if (authorise) {
				console.log("Corner judge accepted (id=" + cornerJudgeId + ")");
				socket.emit('cornerJudgeAccepted', cornerJudgeId);
			} else {
				console.log("Corner judge rejected (id=" + cornerJudgeId + ")");
				socket.emit('cornerJudgeRejected', cornerJudgeId);
			}
		};
			
		var onCornerJudgeStateChanged = function (cornerJudge) {
			console.log("Corner judge " + (cornerJudge.connected ? "connected" : "disconnected") + " (id=" + cornerJudge.id + ")");
			View.onCornerJudgeStateChanged(cornerJudge);
		};
		
		var enableScoring = function (enable) {
			console.log((enable ? "Enable" : "Disable") + " scoring");
			socket.emit('enableScoring', enable);
		};
	
		
		return {
			init: init,
			sendId: sendId,
			createRing: createRing,
			authoriseCornerJudge: authoriseCornerJudge,
			enableScoring: enableScoring
		};
		
	}());
	
	
	/**
	 * Enum of the views
	 */
	var Views = {
		PWD: 'pwd-view',
		RINGS: 'rings-view',
		MATCH: 'match-view'
	};
	
	/**
	 * Enum of the panels
	 */
	var Panels = {
		CONFIG: 'config-panel',
		MATCH: 'match-panel',
		RESULT: 'result-panel'
	};
	
	/**
	 * Enum of the competitors
	 */
	var Competitors = {
		HONG: 'hong',
		CHONG: 'chong'
	};
	
	
	/**
	 * 'View' module for everything related to the interface.
	 */
	var View = (function () {
		
		var init = function () {
			cacheElements();
			bindEvents();
			
			// Initialise FastClick to remove 300ms delay on mobile devices
			FastClick.attach(document.body);
		};
		
		
		var sets = {},
			pwdAction, pwdInstr, pwdField,
			ringsList, ringsBtns,
			matchView, matchNewBtns,
			judgesList, judges, judgesById;
		
		
		var cacheElements = function () {
			sets.views = document.getElementsByClassName('view');
			sets.panels = document.getElementsByClassName('panel');
			
			pwdAction = document.getElementById('pwd-action');
			pwdInstr = document.getElementById('pwd-instr');
			pwdField = document.getElementById('pwd-field');
			
			ringsList = document.getElementById('rings-list');
            ringsBtns = ringsList.getElementsByTagName('button');
			
			matchView = document.getElementById('match-view');
			matchNewBtns = matchView.getElementsByClassName('match-new');
			
			judges = [];
			judgesById = {};
			judgesList = document.getElementById('judges-list');
			[].forEach.call(judgesList.getElementsByClassName('judge'), function (item, index) {
				judges[index] = {
					id: null,
					name: null,
					slot: index,
					rootLi: item,
					nameH3: item.getElementsByClassName('judge-name')[0],
					stateSpan: item.getElementsByClassName('judge-state')[0],
					btnsUl: item.getElementsByClassName('judge-btns')[0],
					acceptBtn: item.getElementsByClassName('judge-accept')[0],
					rejectBtn: item.getElementsByClassName('judge-reject')[0]
				};
			});
		};
		
		var bindEvents = function () {
			pwdField.addEventListener('keypress', onPwdField);
            [].forEach.call(ringsBtns, function (btn, index) {
                btn.addEventListener('click', onRingsBtn.bind(null, index));
            });
            [].forEach.call(matchNewBtns, function (btn, index) {
                btn.addEventListener('click', onMatchNewBtn);
            });
		};
		
		var onPwdField = function (evt) {
			// If Enter key was pressed...
			if (evt.which === 13 || evt.keyCode === 13) {
				if (pwdField.value.length > 0) {
					// Send identification to server
					IO.sendId(pwdField.value);
				} else {
					pwdResult(false);
				}
			}
		};
        
        var pwdResult = function (correct, showRingsView) {
            if (correct) {
                pwdField.removeEventListener('keypress', onPwdField);
            } else {
                // Reset field
                pwdField.value = "";
                // Update instructions
                pwdInstr.textContent = pwdInstr.textContent.replace("required", "incorrect");
                // Shake field
                shakeField(pwdField);
            }
        };
		
		var onRingAllocations = function (allocations) {
            allocations.forEach(onRingAllocationChanged);
		};
		
		var onRingAllocationChanged = function (allocation, index) {
            if (allocation.allocated) {
                ringsBtns[index].setAttribute("disabled", "disabled");
            } else {
                ringsBtns[index].removeAttribute("disabled");
            }
		};
		
		var onRingsBtn = function (index, evt) {
            if (!evt.target.hasAttribute("disabled")) {
                IO.createRing(index);
            } else {
                alert("This ring has already been selected by another Jury President.");
            }
		};
		
		var findFreeCornerJudgeSlot = function () {
			var slot = 0;
			while (judges[slot].id !== null && slot < 4) {
				slot++;
			}
			return (slot < 4 ? slot : null);
		};
		
		var onAuthoriseCornerJudge = function (cornerJudge, alreadyAuthorised) {
			// Find next available slot
			var slot = findFreeCornerJudgeSlot();
			if (slot !== null) {
				var judge = judges[slot];
				judge.id = cornerJudge.id;
				judgesById[judge.id] = judge;
				judge.name = cornerJudge.name;
				
				// Set name
				judge.nameH3.textContent = cornerJudge.name;
				
				// Show/hide accept/reject buttons and state span
				judge.btnsUl.classList.toggle("hidden", alreadyAuthorised);
				judge.stateSpan.classList.toggle("hidden", !alreadyAuthorised);
				
				if (alreadyAuthorised) {
					return judge;
				} else {
					// Listen to jury president's decision
					judge.acceptFn = onJudgeBtn.bind(null, judge, true);
					judge.rejectFn = onJudgeBtn.bind(null, judge, false);
					judge.acceptBtn.addEventListener('click', judge.acceptFn);
					judge.rejectBtn.addEventListener('click', judge.rejectFn);
				}
			}
		};
		
		var onJudgeBtn = function (judge, accept) {
			IO.authoriseCornerJudge(judge.id, accept);
			
			// Hide buttons and show state span
			judge.btnsUl.classList.add("hidden");
			judge.stateSpan.classList.remove("hidden");
			
			// Remove listeners
			judge.acceptBtn.removeEventListener('click', judge.acceptFn);
			judge.rejectBtn.removeEventListener('click', judge.rejectFn);
			judge.acceptFn = null;
			judge.rejectFn = null;
			
			if (!accept) {
				judge.nameH3.textContent = "Judge #" + (judge.slot + 1);
				judge.stateSpan.textContent = "Waiting for connection";
				
				delete judgesById[judge.id];
				judge.id = null;
				judge.name = null;
			} else {
				judge.stateSpan.textContent = "Connected";
			}
		};
		
		var onCornerJudgeStateChanged = function (cornerJudge) {
			// Retrieve judge from ID
			var judge = judgesById[cornerJudge.id];
			
			if (!judge) {
				// Dealing with reconnection of jury president
				judge = onAuthoriseCornerJudge(cornerJudge, true);
			}
			
			if (cornerJudge.connected) {
				// Set name and hide connection lost message
				judge.nameH3.textContent = cornerJudge.name;
				judge.stateSpan.textContent = "Connected";
			} else {
				// Show connection lost message
				judge.stateSpan.textContent = "Connection lost. Waiting for reconnection...";
			}
		};
		
		//var enabled = false;
		var onMatchNewBtn = function () {
			//enabled = !enabled;
			//IO.enableScoring(enabled);
			
			showElem(Panels.MATCH, 'panels');
		};
		
		
		// Show element with given ID and hide all other elements in set with given name
		var showElem = function (elemId, setName) {
			[].forEach.call(sets[setName], function (elem) {
				if (elem.id === elemId) {
					elem.classList.remove("hidden");
				} else {
					elem.classList.add("hidden");
				}
			});
		};
		
        
		var onShakeEnd = function (evt) {
            // Remove shake class in case another shake animation needs to be performed
			evt.target.classList.remove("shake");
            // Remove listener
			evt.target.removeEventListener('animationend', onShakeEnd);
		};
		
		var shakeField = function (field) {
            // Listen to end of shake animation
            field.addEventListener('animationend', onShakeEnd);
            // Start shake animation
            field.classList.add("shake");
		};
		
		
		return {
			init: init,
            pwdResult: pwdResult,
            onRingAllocations: onRingAllocations,
            onRingAllocationChanged: onRingAllocationChanged,
			onAuthoriseCornerJudge: onAuthoriseCornerJudge,
			onCornerJudgeStateChanged: onCornerJudgeStateChanged,
			showElem: showElem
		};
		
	}());
	
	IO.init();
	View.init();
    
    // DEBUG
    setTimeout(function () {
		IO.sendId('tkd')
	}, 200);
	
});
