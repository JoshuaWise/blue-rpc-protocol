'use strict';

/*
	KnownError is the opposite of an unexpected error. You can throw it within
	BlueRPC method handlers to indicate that a known failure condition has
	occurred. Unlike other types of errors, custom properties will not be
	stripped.
 */

module.exports = class KnownError extends Error {
	constructor(message, props) {
		super(message);
		Object.assign(this, props);
	}

	get name() {
		return 'KnownError';
	}
};
