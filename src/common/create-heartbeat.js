'use strict';
const HEARTBEAT_INTERVAL = 5000;
const HEARTBEAT_TRIES = 3;

/*
	Starts a new heartbeat. The returned function should be called to signal
	any form of activity. The `callback`` parameter will be invoked with `true`
	to warn about periods of inactivity, and it will be invoked with `false` to
	signal a heartbeat failure. An AbortSignal is required.
 */

module.exports = (callback, abortSignal) => {
	if (abortSignal.aborted) {
		return () => {};
	}

	let pingCount = 0;
	let timer = setTimeout(noActivity, HEARTBEAT_INTERVAL);

	// After a period of inactivity, assess the state of the heartbeat.
	function noActivity() {
		if (++pingCount > HEARTBEAT_TRIES) {
			callback(false);
		} else {
			callback(true);
			timer = setTimeout(noActivity, HEARTBEAT_INTERVAL);
		}
	}

	// If the heartbeat is aborted, clean up.
	abortSignal.addEventListener('abort', () => {
		clearTimeout(timer);
	});

	// The caller can invoke this to signal activity, which resets the heartbeat.
	return () => {
		if (!abortSignal.aborted && !(pingCount > HEARTBEAT_TRIES)) {
			pingCount = 0;
			clearTimeout(timer);
			timer = setTimeout(noActivity, HEARTBEAT_INTERVAL);
		}
	};
};
