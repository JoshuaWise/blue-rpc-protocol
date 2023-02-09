'use strict';
const Stream = require('./stream');

/*
	Traverses the given object and destroys all streams nested within.
 */

module.exports = (obj) => {
	const visited = new Set();

	(function walk(obj) {
		if (typeof obj !== 'object') return;
		if (obj === null) return;
		if (obj instanceof Uint8Array) return;
		if (obj instanceof Stream.Class) {
			if (!Stream.isLocked(obj)) {
				Stream.cancel(obj);
			}
			return;
		}
		if (!visited.has(obj)) {
			visited.add(obj);
			Object.values(obj).forEach(walk);
		}
	})(obj);
};
