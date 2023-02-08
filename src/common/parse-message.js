'use strict';
const M = require('../common/message');
const validateMessage = require('./validate-message');

/*
	Parses a raw WebSocket message and validates all requirements by
	Scratch-RPC, throwing an error if there was a problem.
 */

module.exports = (rawMsg, encoder, allowedMessageTypes, streamIds, requestIds) => {
	if (typeof rawMsg === 'string') {
		throw createError({
			code: 1003,
			reason: 'Text frames not allowed',
			message: 'received forbidden text frame',
		});
	}

	let msg, streams;
	try {
		({ result: msg, streams } = encoder.decode(rawMsg));
	} catch (err) {
		throw createError({
			code: 1008,
			reason: err.msgpackExtensionType ? err.message : 'Invalid MessagePack',
			message: `received invalid MessagePack (${err.message})`,
		});
	}

	let msgType;
	if (!validateMessage(msg) || !(allowedMessageTypes[msgType = msg[0]] || msgType > 10)) {
		throw createError({
			code: 1008,
			reason: 'Invalid message',
			message: 'received invalid Scratch-RPC message',
		});
	}

	if (msgType === M.REQUEST) {
		if (requestIds.has(msg[1])) {
			throw createError({
				code: 1008,
				reason: 'Illegal duplicate ID',
				message: 'received duplicate request ID',
			});
		}
	}

	if (streams.size) {
		if (msgType === M.STREAM_CHUNK_ERROR) {
			throw createError({
				code: 1008,
				reason: 'Stream nesting not allowed',
				message: 'received forbidden stream nesting',
			});
		}
		for (const streamId of streams.keys()) {
			if (streamIds.has(streamId)) {
				throw createError({
					code: 1008,
					reason: 'Illegal duplicate ID',
					message: 'received duplicate stream ID',
				});
			}
		}
	}

	return [msgType, msg.slice(1), streams];
};

// Parses a chunk of stream data, ensuring it contains no nested streams.
module.exports.parseStream = (rawData, encoder) => {
	let result, streams;
	try {
		({ result, streams } = encoder.decode(rawData));
	} catch (err) {
		throw createError({
			code: 1008,
			reason: err.msgpackExtensionType ? err.message : 'Invalid MessagePack',
			message: `received invalid MessagePack (${err.message})`,
		});
	}
	if (streams.size) {
		throw createError({
			code: 1008,
			reason: 'Stream nesting not allowed',
			message: 'received forbidden stream nesting',
		});
	}
	return result;
};

function createError({ code, reason, message }) {
	const err = new Error(message);
	err.code = code;
	err.reason = reason;
	return err;
}
