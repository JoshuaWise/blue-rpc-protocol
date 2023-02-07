'use strict';
const Message = require('./message');

/*
	Returns whether the given message is a valid Scratch-RPC message.
 */

module.exports = (msg) => {
	if (!Array.isArray(msg)) return false;

	const msgType = msg[0];
	if (!Number.isInteger(msgType)) return false;
	if (msgType === 10) return false;
	if (msgType < 0) return false;

	const validator = validators.get(msgType);
	return !validator || validator(msg);
};

const validators = new Map([
	[Message.REQUEST, (msg) => {
		if (msg.length !== 4) return false;
		if (!Number.isInteger(msg[1])) return false;
		if (typeof msg[2] !== 'string') return false;
		return true;
	}],
	[Message.NOTIFICATION, (msg) => {
		if (msg.length !== 3) return false;
		if (typeof msg[1] !== 'string') return false;
		return true;
	}],
	[Message.RESPONSE_SUCCESS, (msg) => {
		if (msg.length !== 3) return false;
		if (!Number.isInteger(msg[1])) return false;
		return true;
	}],
	[Message.RESPONSE_FAILURE, (msg) => {
		if (msg.length !== 3) return false;
		if (!Number.isInteger(msg[1])) return false;
		if (!(msg[2] instanceof Error)) return false;
		return true;
	}],
	[Message.CANCELLATION, (msg) => {
		if (msg.length !== 2) return false;
		if (!Number.isInteger(msg[1])) return false;
		return true;
	}],
	[Message.STREAM_CHUNK_DATA, (msg) => {
		if (msg.length !== 3) return false;
		if (!Number.isInteger(msg[1])) return false;
		if (!(msg[2] instanceof Uint8Array)) return false;
		return true;
	}],
	[Message.STREAM_CHUNK_END, (msg) => {
		if (msg.length !== 2) return false;
		if (!Number.isInteger(msg[1])) return false;
		return true;
	}],
	[Message.STREAM_CHUNK_ERROR, (msg) => {
		if (msg.length !== 3) return false;
		if (!Number.isInteger(msg[1])) return false;
		if (!(msg[2] instanceof Error)) return false;
		return true;
	}],
	[Message.STREAM_CANCELLATION, (msg) => {
		if (msg.length !== 2) return false;
		if (!Number.isInteger(msg[1])) return false;
		return true;
	}],
	[Message.STREAM_SIGNAL, (msg) => {
		if (msg.length !== 4) return false;
		if (!Number.isInteger(msg[1])) return false;
		if (!Number.isInteger(msg[2])) return false;
		if (!Number.isInteger(msg[3])) return false;
		return true;
	}],
]);
