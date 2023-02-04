'use strict';

// TODO: rewrite
// Parses a raw string/buffer into a Scratch-RPC response, or null if the
// response is invalid.
module.exports = (stringOrBuffer) => {
	let msg;
	try {
		msg = JSON.parse(String(stringOrBuffer));
	} catch (_) {
		return null;
	}
	if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
		return null;
	}
	if (typeof msg.result !== 'object' || Array.isArray(msg.result)) {
		return null;
	}
	if (typeof msg.error !== 'object' || Array.isArray(msg.error)) {
		return null;
	}
	if (!((msg.result === null) ^ (msg.error === null))) {
		return null;
	}
	if (typeof msg.id !== 'string' || !msg.id) {
		return null;
	}
	return {
		id: msg.id,
		result: msg.result,
		error: msg.error,
	};
};
