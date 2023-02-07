'use strict';

/*
	These functions validate the various message types in Scratch-RPC.
 */

exports.AnyMessage = (msg) => {
	if (!Array.isArray(msg)) return false;
	if (!Number.isInteger(msg[0])) return false;
	if (msg[0] === 10) return false;
	if (msg[0] < 0) return false;
	return true;
};

exports.Request = (msg) => {
	if (msg.length !== 4) return false;
	if (!Number.isInteger(msg[1])) return false;
	if (typeof msg[2] !== 'string') return false;
	return true;
};

exports.Notification = (msg) => {
	if (msg.length !== 3) return false;
	if (typeof msg[1] !== 'string') return false;
	return true;
};

exports.ResponseSuccessful = (msg) => {
	if (msg.length !== 3) return false;
	if (!Number.isInteger(msg[1])) return false;
	return true;
};

exports.ResponseFailure = (msg) => {
	if (msg.length !== 3) return false;
	if (!Number.isInteger(msg[1])) return false;
	if (!(msg[2] instanceof Error)) return false;
	return true;
};

exports.Cancellation = (msg) => {
	if (msg.length !== 2) return false;
	if (!Number.isInteger(msg[1])) return false;
	return true;
};

exports.StreamChunkData = (msg) => {
	if (msg.length !== 3) return false;
	if (!Number.isInteger(msg[1])) return false;
	if (!(msg[2] instanceof Uint8Array)) return false;
	return true;
};

exports.StreamChunkEnd = (msg) => {
	if (msg.length !== 2) return false;
	if (!Number.isInteger(msg[1])) return false;
	return true;
};

exports.StreamChunkError = (msg) => {
	if (msg.length !== 3) return false;
	if (!Number.isInteger(msg[1])) return false;
	if (!(msg[2] instanceof Error)) return false;
	return true;
};

exports.StreamCancellation = (msg) => {
	if (msg.length !== 2) return false;
	if (!Number.isInteger(msg[1])) return false;
	return true;
};

exports.StreamSignal = (msg) => {
	if (msg.length !== 4) return false;
	if (!Number.isInteger(msg[1])) return false;
	if (!Number.isInteger(msg[2])) return false;
	if (!Number.isInteger(msg[3])) return false;
	return true;
};
