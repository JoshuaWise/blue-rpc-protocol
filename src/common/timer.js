'use strict';

/*
	Starts a new timer, invoking the callback after the duration has passed.
	The timer can be reset or stopped.

	In Node.js, the timer will not prevent the process from exiting.
 */

module.exports = class Timer {
	constructor(duration, callback) {
		this._duration = duration;
		this._callback = callback;
		this._timer = setTimeout(callback, duration);
		this._timer.unref && this._timer.unref();
	}

	// Restarts the timer back to its initial duration.
	reset() {
		clearTimeout(this._timer);
		this._timer = setTimeout(this._callback, this._duration);
		this._timer.unref && this._timer.unref();
	}

	// Cancel the timer and clean up.
	stop() {
		clearTimeout(this._timer);
	}
};
