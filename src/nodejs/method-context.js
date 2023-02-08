'use strict';

/*
	Exposes metadata about a Scratch-RPC method invocation.
 */

module.exports = class MethodContext {
	constructor(abortSignal, requestId, connection) {
		this.signal = abortSignal;
		this.requestId = requestId;
		this.connection = connection;
		Object.freeze(this);
	}

	get isNotification() {
		return this.requestId === null;
	}

	get isAborted() {
		return this.signal.aborted;
	}
};
