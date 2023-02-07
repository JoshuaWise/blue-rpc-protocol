'use strict';
const HEARTBEAT_INTERVAL = 5000;
const HEARTBEAT_TRIES = 3;

/*
	Starts a new heartbeat. The callback will be invoked with `true` to warn
	about periods of inactivity, and it will be invoked with `false` to signal
	heartbeat failure.
 */

class Heartbeat {
	constructor(callback) {
		const noActivity = () => {
			if (++this._pingCount > HEARTBEAT_TRIES) {
				this._stopped = true;
				callback(false);
			} else {
				this._timer = setTimeout(noActivity, HEARTBEAT_INTERVAL);
				callback(true);
			}
		};

		this._stopped = false;
		this._pingCount = 0;
		this._timer = setTimeout(noActivity, HEARTBEAT_INTERVAL);
		this._noActivity = noActivity;
	}

	// Invoke this when activity occurs to reset the heartbeat.
	reset() {
		if (!this._stopped) {
			this._pingCount = 0;
			clearTimeout(this._timer);
			this._timer = setTimeout(this._noActivity, HEARTBEAT_INTERVAL);
		}
	}

	// Abort the heartbeat and clean up.
	stop() {
		this._stopped = true;
		clearTimeout(this._timer);
	}
}
