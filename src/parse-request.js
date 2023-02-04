'use strict';

// TODO: rewrite
// Parses a raw string/buffer into a Scratch-RPC request, or null if the
// request is invalid.
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
	if (typeof msg.method !== 'string' || !msg.method) {
		return null;
	}
	if (!Array.isArray(msg.params)) {
		return null;
	}
	if (msg.id !== null && (typeof msg.id !== 'string' || !msg.id)) {
		return null;
	}
	return {
		id: msg.id,
		method: msg.method,
		params: msg.params,
	};
};
