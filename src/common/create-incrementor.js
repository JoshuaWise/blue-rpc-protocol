'use strict';

/*
	Returns a function that returns a positive 32-bit unsigned integer, which
	gets incremented on each call, wrapping back to 1 when necessary.
 */

module.exports = () => {
	let nextId = 1;

	return () => {
		const id = nextId;
		nextId = ((nextId + 1) >>> 0) || 1;
		return id;
	};
};
