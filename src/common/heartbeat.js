'use strict';

/*
	Starts a new heartbeat. The callback will be invoked at regular intervals,
	being passed a number counting down how many more times the callback will be
	invoked before heartbeat failure occurs. Upon heartbeat failure, the
	callback will be invoked with -1. The heartbeat can be reset to indefinitely
	prevent/postpone heartbeat failure. The `interval` argument indicates how
	long to wait between heartbeats (in milliseconds), and the `tries` argument
	indicates how many consecutive non-failure heartbeats will be tolerated.
 */

module.exports = class Heartbeat {
	constructor(interval, tries, callback) {
		const onHeartbeat = () => {
			if (++this._count > tries) {
				clearInterval(this._timer);
				callback(-1);
			} else {
				callback(tries - this._count);
			}
		};

		this._count = 0;
		this._timer = setInterval(onHeartbeat, interval);
	}

	// Invoke this when activity occurs to reset the heartbeat.
	reset() {
		this._count = 0;
	}

	// Abort the heartbeat and clean up.
	stop() {
		clearInterval(this._timer);
	}
};
